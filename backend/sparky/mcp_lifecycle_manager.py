"""
MCP Lifecycle Manager for Sparky Agent.

Manages MCP server connections during FastAPI lifespan. Connections are established
at startup, maintained as live per-server MultiServerMCPClient instances, and
reconciled against user preferences during session init.

"""

import asyncio
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set

logger = logging.getLogger(__name__)

# Valid transport types
VALID_TRANSPORTS = {"streamable_http", "stdio"}


@dataclass
class MCPServerConfig:
    """Validated MCP server configuration."""

    name: str
    transport: str  # "streamable_http" | "stdio"
    url: Optional[str] = None  # for streamable_http
    command: Optional[str] = None  # for stdio
    args: List[str] = field(default_factory=list)  # for stdio


@dataclass
class MCPToolEntry:
    """A tool discovered from an MCP server, held in memory."""

    name: str
    description: str
    input_schema: Dict[str, Any]
    server_name: str
    available: bool = True


@dataclass
class MCPServerConnection:
    """Represents a per-server MCP client and its discovered tools."""

    name: str
    config: MCPServerConfig
    client: Any  # MultiServerMCPClient — typed as Any to avoid import at module level
    tools: List[MCPToolEntry] = field(default_factory=list)
    connected: bool = True


class MCPLifecycleManager:
    """Manages MCP server connections during FastAPI lifespan."""

    def __init__(self) -> None:
        self.runtime_tool_set: Dict[str, MCPToolEntry] = {}
        self.server_connections: Dict[str, MCPServerConnection] = {}
        self.mcp_config: Dict[str, MCPServerConfig] = {}
        # Cache of live LangChain tool objects keyed by tool name.
        # Populated during connect_server, used by call_tool to avoid
        # rediscovering tools on every invocation.
        self._live_tools: Dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Config validation
    # ------------------------------------------------------------------

    def validate_config(self, raw_config: Dict[str, Any]) -> Dict[str, MCPServerConfig]:
        """Validate MCP config JSON.

        Accepts a dict where each key is a server name and the value contains
        connection details. Rejects entries with unsupported transports or
        non-Python stdio commands. Returns a dict of valid MCPServerConfig
        objects keyed by server name.

        """
        valid: Dict[str, MCPServerConfig] = {}

        for server_name, entry in raw_config.items():
            if not isinstance(entry, dict):
                logger.warning(
                    "MCP config entry '%s' is not a dict — skipping", server_name
                )
                continue

            transport = entry.get("transport")

            # --- transport validation ---
            if transport not in VALID_TRANSPORTS:
                logger.warning(
                    "MCP server '%s': unsupported transport '%s' — skipping",
                    server_name,
                    transport,
                )
                continue

            # --- streamable_http validation ---
            if transport == "streamable_http":
                url = entry.get("url")
                if not url:
                    logger.warning(
                        "MCP server '%s': streamable_http transport requires 'url' — skipping",
                        server_name,
                    )
                    continue
                valid[server_name] = MCPServerConfig(
                    name=server_name,
                    transport=transport,
                    url=url,
                )

            # --- stdio validation ---
            elif transport == "stdio":
                command = entry.get("command")
                if not command:
                    logger.warning(
                        "MCP server '%s': stdio transport requires 'command' — skipping",
                        server_name,
                    )
                    continue

                args = entry.get("args", [])
                if not isinstance(args, list):
                    args = []

                valid[server_name] = MCPServerConfig(
                    name=server_name,
                    transport=transport,
                    command=command,
                    args=args,
                )

        return valid

    # ------------------------------------------------------------------
    # Connection management
    # ------------------------------------------------------------------

    async def connect_server(
        self, name: str, config: MCPServerConfig
    ) -> Optional[MCPServerConnection]:
        """Establish connection to a single MCP server and discover its tools.

        Creates a dedicated MultiServerMCPClient for this server, calls get_tools()
        to discover available tools, and wraps them as MCPToolEntry instances.

        Returns MCPServerConnection on success, None on failure.

        """
        try:
            from langchain_mcp_adapters.client import MultiServerMCPClient

            # Build per-server config dict for MultiServerMCPClient
            if config.transport == "streamable_http":
                # Validate URL to prevent SSRF
                from tool_config_service import _validate_mcp_url

                _validate_mcp_url(config.url)
                client_config = {
                    name: {
                        "transport": "streamable_http",
                        "url": config.url,
                    }
                }
            else:  # stdio
                # Restrict stdio commands to an allowlist to prevent arbitrary command execution
                _ALLOWED_STDIO_COMMANDS = {"python", "python3", "uvx", "npx", "node"}
                import os as _os

                cmd_basename = _os.path.basename(config.command)
                if cmd_basename not in _ALLOWED_STDIO_COMMANDS:
                    logger.error(
                        "MCP server '%s': stdio command '%s' not in allowlist — refusing to connect",
                        name,
                        config.command,
                    )
                    return None
                # Block inline code execution flags to prevent RCE via args
                _DANGEROUS_ARGS = {"-c", "--eval", "-e", "--exec", "--import"}
                if any(a in _DANGEROUS_ARGS for a in config.args):
                    logger.error(
                        "MCP server '%s': dangerous arg detected in %s — refusing to connect",
                        name,
                        config.args,
                    )
                    return None
                client_config = {
                    name: {
                        "transport": "stdio",
                        "command": config.command,
                        "args": config.args,
                    }
                }

            client = MultiServerMCPClient(client_config)
            mcp_tools = await client.get_tools()

            tools: List[MCPToolEntry] = []
            for tool in mcp_tools:
                input_schema = self._extract_input_schema(tool)
                tools.append(
                    MCPToolEntry(
                        name=tool.name,
                        description=tool.description or "",
                        input_schema=input_schema,
                        server_name=name,
                        available=True,
                    )
                )
                # Cache the live LangChain tool for direct invocation in call_tool
                self._live_tools[tool.name] = tool

            logger.info(
                "Connected to MCP server '%s' (%s) — discovered %d tools",
                name,
                config.transport,
                len(tools),
            )

            return MCPServerConnection(
                name=name,
                config=config,
                client=client,
                tools=tools,
                connected=True,
            )

        except Exception as e:
            logger.error("Failed to connect to MCP server '%s': %s", name, e)
            return None

    async def startup(self) -> None:
        """Initialize the MCP lifecycle manager.

        MCPs are now loaded exclusively through DynamoDB via reconcile(),
        so startup simply initializes with an empty Runtime_Tool_Set.
        """
        logger.info(
            "MCP lifecycle manager started — tools loaded via DynamoDB reconciliation"
        )

    async def shutdown(self) -> None:
        """Gracefully close all MCP server connections.

        Logs warnings for any close failures but continues closing others.

        """
        for name, conn in self.server_connections.items():
            try:
                if hasattr(conn.client, "close"):
                    await conn.client.close()
                conn.connected = False
                logger.info("Closed MCP server connection: %s", name)
            except Exception as e:
                logger.warning("Error closing MCP server '%s': %s", name, e)

        self.server_connections.clear()
        self.runtime_tool_set.clear()
        self._live_tools.clear()
        logger.info("MCP shutdown complete")

    async def disconnect_server(self, name: str) -> None:
        """Close a specific server's client and mark its tools as unavailable."""
        conn = self.server_connections.get(name)
        if conn is None:
            logger.warning("Cannot disconnect unknown MCP server '%s'", name)
            return

        try:
            if hasattr(conn.client, "close"):
                await conn.client.close()
        except Exception as e:
            logger.warning("Error closing MCP server '%s': %s", name, e)

        conn.connected = False
        for tool_entry in conn.tools:
            tool_entry.available = False
            if tool_entry.name in self.runtime_tool_set:
                self.runtime_tool_set[tool_entry.name].available = False
            # Remove cached live tool reference so stale objects aren't used
            self._live_tools.pop(tool_entry.name, None)

        logger.info(
            "Disconnected MCP server '%s' — %d tools marked unavailable",
            name,
            len(conn.tools),
        )

    async def call_tool(self, tool_name: str, arguments: Dict[str, Any]) -> Any:
        """Route a tool call to the appropriate MCP server connection.

        Returns the tool result on success, or an error string if the tool
        is unavailable or the call fails.

        Distinguishes between tool-level errors (bad arguments, validation)
        and connection-level errors. Only connection failures mark the
        server as unavailable.

        """
        tool_entry = self.runtime_tool_set.get(tool_name)
        if tool_entry is None or not tool_entry.available:
            return f"Tool {tool_name} is temporarily unavailable"

        conn = self.server_connections.get(tool_entry.server_name)
        if conn is None or not conn.connected:
            return f"Tool {tool_name} is temporarily unavailable"

        try:
            # Use cached live tool reference; fall back to rediscovery if missing
            live_tool = self._live_tools.get(tool_name)
            if live_tool is None:
                tools = await conn.client.get_tools()
                for tool in tools:
                    if tool.name == tool_name:
                        live_tool = tool
                        self._live_tools[tool_name] = tool
                        break

            if live_tool is None:
                return f"Tool {tool_name} is temporarily unavailable"

            return await live_tool.ainvoke(arguments)

        except Exception as e:
            error_str = str(e)
            # MCP protocol errors (e.g. -32602 invalid params) are tool-level
            # issues, not connection failures — don't kill the whole server.
            is_tool_error = (
                "MCP error" in error_str or "validation" in error_str.lower()
            )

            if is_tool_error:
                logger.warning("MCP tool call '%s' returned an error: %s", tool_name, e)
                return f"Tool '{tool_name}' error: {error_str}"

            # Connection / transport errors — mark server unavailable
            logger.error(
                "MCP tool call '%s' failed (connection error): %s", tool_name, e
            )
            await self._mark_server_unavailable(tool_entry.server_name)
            return f"Tool {tool_name} is temporarily unavailable"

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _mark_server_unavailable(self, server_name: str) -> None:
        """Mark all tools from a server as unavailable after a connection error."""
        conn = self.server_connections.get(server_name)
        if conn is None:
            return

        conn.connected = False
        for tool_entry in conn.tools:
            tool_entry.available = False
            if tool_entry.name in self.runtime_tool_set:
                self.runtime_tool_set[tool_entry.name].available = False
            # Remove cached live tool reference so stale objects aren't used
            self._live_tools.pop(tool_entry.name, None)

        logger.warning(
            "MCP server '%s' marked unavailable — %d tools affected",
            server_name,
            len(conn.tools),
        )

    def get_runtime_tool_set(self) -> Dict[str, MCPToolEntry]:
        """Return the current Runtime_Tool_Set."""
        return self.runtime_tool_set

    async def reconcile(
        self,
        user_prefs: Dict[str, Any],
        runtime_tools: Dict[str, MCPToolEntry],
    ) -> List[Any]:
        """Incremental, diff-based reconciliation of user preferences against Runtime_Tool_Set.

        1. Diff MCP servers: compare pref server list vs currently connected servers.
           - New server in prefs not in runtime → connect ONLY that server (incremental add).
           - Server in runtime but disabled in prefs → exclude its tools (no disconnect, just filter).
           - Server in runtime and enabled in prefs → keep as-is (reuse connection).
        2. Apply per-tool toggles: filter individual tools based on enabled/disabled state.
           This is a pure filter operation — no MCP server reload needed.
        3. Tools not mentioned in prefs are treated as enabled by default.
        4. Prefs referencing non-existent servers/tools are ignored with a logged warning.

        Returns the Active_Tool_Set as LangChain StructuredTool instances.

        """
        active_tools: List[Any] = []
        pref_servers = user_prefs.get("mcp_servers", [])

        # Build lookup of pref servers by name for quick access
        pref_server_map: Dict[str, Dict[str, Any]] = {}
        for server_pref in pref_servers:
            name = server_pref.get("name")
            if name:
                pref_server_map[name] = server_pref

        # Track which runtime servers are covered by prefs
        connected_server_names: Set[str] = set(self.server_connections.keys())
        pref_server_names: Set[str] = set(pref_server_map.keys())

        # --- Phase 1: Handle new servers in prefs not yet connected (parallel) ---
        new_servers = pref_server_names - connected_server_names
        connect_tasks: List[tuple] = []  # (server_name, config) pairs
        for server_name in new_servers:
            server_pref = pref_server_map[server_name]
            if not server_pref.get("enabled", True):
                continue  # disabled in prefs, no need to connect

            # Build a raw config entry and validate it
            raw_entry: Dict[str, Any] = {
                "transport": server_pref.get("transport"),
            }
            if server_pref.get("url"):
                raw_entry["url"] = server_pref["url"]
            if server_pref.get("command"):
                raw_entry["command"] = server_pref["command"]
            if server_pref.get("args"):
                raw_entry["args"] = server_pref["args"]

            validated = self.validate_config({server_name: raw_entry})
            if server_name not in validated:
                logger.warning(
                    "Preference references MCP server '%s' with invalid config — ignoring",
                    server_name,
                )
                continue

            connect_tasks.append((server_name, validated[server_name]))

        # Connect all new servers in parallel
        if connect_tasks:
            results = await asyncio.gather(
                *(self.connect_server(name, cfg) for name, cfg in connect_tasks),
                return_exceptions=True,
            )
            for (server_name, _cfg), result in zip(connect_tasks, results):
                if isinstance(result, Exception):
                    logger.warning(
                        "Failed to connect new MCP server '%s' from preferences: %s — ignoring",
                        server_name,
                        result,
                    )
                    continue
                if result is None:
                    logger.warning(
                        "Failed to connect new MCP server '%s' from preferences — ignoring",
                        server_name,
                    )
                    continue

                # Register the new server and its tools into runtime
                self.server_connections[server_name] = result
                for tool_entry in result.tools:
                    self.runtime_tool_set[tool_entry.name] = tool_entry
                    runtime_tools[tool_entry.name] = tool_entry

        # --- Phase 2: Determine enabled servers ---
        enabled_servers: Set[str] = set()
        for server_name, conn in self.server_connections.items():
            if not conn.connected:
                continue
            if server_name in pref_server_map:
                if pref_server_map[server_name].get("enabled", True):
                    enabled_servers.add(server_name)
                # disabled in prefs → excluded (no disconnect)
            else:
                # Server not mentioned in prefs → enabled by default
                enabled_servers.add(server_name)

        # Warn about pref servers that don't exist and couldn't be connected
        for server_name in pref_server_names:
            if server_name not in self.server_connections:
                logger.warning(
                    "Preference references MCP server '%s' which is not in Runtime_Tool_Set — ignoring",
                    server_name,
                )

        # --- Phase 3: Build Active_Tool_Set with per-tool toggles ---
        for tool_name, tool_entry in runtime_tools.items():
            if not tool_entry.available:
                continue

            # Check if the tool's server is enabled
            if tool_entry.server_name not in enabled_servers:
                continue

            # Apply per-tool toggle from prefs
            server_pref = pref_server_map.get(tool_entry.server_name, {})
            tool_toggles = server_pref.get("tools", {})

            if tool_name in tool_toggles:
                tool_pref = tool_toggles[tool_name]
                if isinstance(tool_pref, dict) and not tool_pref.get("enabled", True):
                    continue
                elif isinstance(tool_pref, bool) and not tool_pref:
                    continue
            # Tool not in prefs → enabled by default

            # Use the live LangChain tool directly from the adapter cache
            live_tool = self._live_tools.get(tool_name)
            if live_tool is not None:
                active_tools.append(live_tool)
            else:
                logger.warning(
                    "Tool '%s' in runtime set but missing from live tools cache — skipping",
                    tool_name,
                )

        # Warn about pref tool toggles referencing non-existent tools
        for server_name, server_pref in pref_server_map.items():
            tool_toggles = server_pref.get("tools", {})
            for pref_tool_name in tool_toggles:
                if pref_tool_name not in runtime_tools:
                    logger.warning(
                        "Preference references tool '%s' on server '%s' which is not in Runtime_Tool_Set — ignoring",
                        pref_tool_name,
                        server_name,
                    )

        logger.info(
            "Reconciliation complete — %d tools in Active_Tool_Set",
            len(active_tools),
        )
        return active_tools

    @staticmethod
    def _extract_input_schema(tool: Any) -> Dict[str, Any]:
        """Extract input schema from a langchain tool object."""
        try:
            if hasattr(tool, "args_schema") and tool.args_schema is not None:
                if isinstance(tool.args_schema, dict):
                    return tool.args_schema
                elif hasattr(tool.args_schema, "model_json_schema"):
                    return tool.args_schema.model_json_schema()
                elif hasattr(tool.args_schema, "schema"):
                    return tool.args_schema.schema()
            return {"type": "object", "properties": {}}
        except Exception:
            return {"type": "object", "properties": {}}


# Module-level singleton instance
mcp_lifecycle_manager = MCPLifecycleManager()
