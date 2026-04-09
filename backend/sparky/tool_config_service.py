"""
Tool Configuration Service for Sparky Agent.

Provides CRUD operations for managing user tool configurations in DynamoDB.
Configurations are stored with user_id (PK) and persona (SK) partitioning.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import asyncio
import boto3
from botocore.exceptions import ClientError
import os
import logging
import ipaddress
import socket
from urllib.parse import urlparse
import httpx

from tool_registry import (
    get_default_tool_config,
    get_tool_registry,
    get_registry_as_dict,
    can_enable_tool,
)


# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Environment configuration
TOOL_CONFIG_TABLE = os.environ.get("TOOL_CONFIG_TABLE", "sparky-tool-config")
REGION = os.environ.get("REGION", "us-east-1")

# Default persona value
DEFAULT_PERSONA = "generic"


class ToolConfigService:
    """
    Service for managing tool configurations in DynamoDB.

    Provides operations for:
    - Getting user tool configuration
    - Saving user tool configuration
    - Initializing default configuration for new users
    - Adding/removing MCP servers
    - Getting the tool registry
    """

    def __init__(self, table_name: Optional[str] = None, region: Optional[str] = None):
        """
        Initialize ToolConfigService with DynamoDB table configuration.

        Args:
            table_name: DynamoDB table name. Defaults to TOOL_CONFIG_TABLE env var.
            region: AWS region. Defaults to REGION env var.
        """
        self.table_name = table_name or TOOL_CONFIG_TABLE
        self.region = region or REGION
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.table = self.dynamodb.Table(self.table_name)
        logger.debug(f"ToolConfigService initialized with table: {self.table_name}")

    async def get_config(
        self, user_id: str, persona: str = DEFAULT_PERSONA
    ) -> Optional[Dict[str, Any]]:
        """
        Get tool configuration for a user and persona.

        If no configuration exists, initializes default configuration.

        Args:
            user_id: The authenticated user ID from JWT token
            persona: The persona identifier (default: "generic")

        Returns:
            Dict containing the tool configuration with local_tools, mcp_servers,
            and updated_at fields. Returns None only on error.
        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.get_item(
                    Key={"user_id": user_id, "persona": persona}
                )
            )

            item = response.get("Item")

            if item:
                # Handle schema evolution - ensure all expected fields exist
                item = self._apply_schema_defaults(item)
                logger.debug(
                    f"Retrieved config for user: {user_id}, persona: {persona}"
                )
                return item
            else:
                # Initialize default config for new user
                logger.debug(
                    f"No config found, initializing for user: {user_id}, persona: {persona}"
                )
                return await self.initialize_user_config(user_id, persona)

        except ClientError as e:
            logger.error(f"Error getting config for user {user_id}: {e}")
            raise

    async def save_config(
        self, user_id: str, config: Dict[str, Any], persona: str = DEFAULT_PERSONA
    ) -> bool:
        """
        Save tool configuration for a user and persona.

        Validates that tools requiring configuration have valid config before
        allowing them to be enabled. Merges incoming config with existing config
        to preserve MCP tool metadata (description, input_schema) while updating
        enabled states.

        Args:
            user_id: The authenticated user ID from JWT token
            config: The tool configuration to save (local_tools, mcp_servers)
            persona: The persona identifier (default: "generic")

        Returns:
            True if save was successful

        Raises:
            ClientError: If DynamoDB operation fails
            ValueError: If tool validation fails
        """
        # Validate tool configurations before saving
        local_tools = config.get("local_tools", {})
        validation_errors = self.validate_tool_configurations(local_tools)
        if validation_errors:
            raise ValueError(
                f"Tool configuration validation failed: {'; '.join(validation_errors)}"
            )

        # Get existing config to preserve MCP tool metadata
        existing_config = None
        try:
            response = await asyncio.to_thread(
                lambda: self.table.get_item(
                    Key={"user_id": user_id, "persona": persona}
                )
            )
            existing_config = response.get("Item")
        except ClientError:
            pass  # No existing config, that's fine

        # Merge MCP servers to preserve tool metadata
        mcp_servers = config.get("mcp_servers", [])
        if existing_config and existing_config.get("mcp_servers"):
            mcp_servers = self._merge_mcp_server_configs(
                existing_config.get("mcp_servers", []), mcp_servers
            )

        updated_at = datetime.now(timezone.utc).isoformat()

        item = {
            "user_id": user_id,
            "persona": persona,
            "local_tools": local_tools,
            "mcp_servers": mcp_servers,
            "updated_at": updated_at,
        }

        try:
            await asyncio.to_thread(lambda: self.table.put_item(Item=item))
            logger.debug(f"Saved config for user: {user_id}, persona: {persona}")
            return True

        except ClientError as e:
            logger.error(f"Error saving config for user {user_id}: {e}")
            raise

    def _merge_mcp_server_configs(
        self,
        existing_servers: List[Dict[str, Any]],
        incoming_servers: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Merge incoming MCP server configs with existing ones.

        Preserves tool metadata (description, input_schema) from existing config
        while updating enabled states from incoming config.

        Args:
            existing_servers: List of existing MCP server configurations
            incoming_servers: List of incoming MCP server configurations

        Returns:
            Merged list of MCP server configurations
        """
        # Create lookup for existing servers by name
        existing_by_name = {s.get("name"): s for s in existing_servers}

        merged_servers = []
        for incoming in incoming_servers:
            server_name = incoming.get("name")
            existing = existing_by_name.get(server_name)

            if existing:
                # Merge: preserve metadata, update enabled states
                merged_server = {
                    "name": server_name,
                    "url": incoming.get("url", existing.get("url")),
                    "transport": incoming.get("transport", existing.get("transport")),
                    "enabled": incoming.get("enabled", existing.get("enabled", True)),
                    "status": existing.get("status", "available"),
                    "last_refresh": existing.get("last_refresh"),
                    "tools": self._merge_mcp_tools(
                        existing.get("tools", {}), incoming.get("tools", {})
                    ),
                }
                # Preserve error if exists
                if existing.get("error"):
                    merged_server["error"] = existing.get("error")
                merged_servers.append(merged_server)
            else:
                # New server, use as-is
                merged_servers.append(incoming)

        return merged_servers

    def _merge_mcp_tools(
        self, existing_tools: Dict[str, Any], incoming_tools: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Merge incoming MCP tools with existing ones.

        Preserves tool metadata (description, input_schema) from existing tools
        while updating enabled states from incoming tools.

        Args:
            existing_tools: Dict of existing tool configurations
            incoming_tools: Dict of incoming tool configurations

        Returns:
            Merged dict of tool configurations
        """
        merged = {}

        # Process all tools from existing (preserve metadata)
        for tool_name, existing_tool in existing_tools.items():
            incoming_tool = incoming_tools.get(tool_name, {})
            merged[tool_name] = {
                "name": existing_tool.get("name", tool_name),
                "description": existing_tool.get("description", ""),
                "input_schema": existing_tool.get("input_schema", {}),
                # Use incoming enabled state if provided, else existing
                "enabled": incoming_tool.get(
                    "enabled", existing_tool.get("enabled", False)
                ),
            }

        # Add any new tools from incoming that don't exist
        for tool_name, incoming_tool in incoming_tools.items():
            if tool_name not in merged:
                merged[tool_name] = incoming_tool

        return merged

    def validate_tool_configurations(self, local_tools: Dict[str, Any]) -> List[str]:
        """
        Validate all tool configurations.

        Checks that tools requiring configuration have valid config before
        being enabled.

        Args:
            local_tools: Dictionary of tool configurations

        Returns:
            List of validation error messages (empty if all valid)
        """
        errors = []

        for tool_id, tool_config in local_tools.items():
            enabled = tool_config.get("enabled", False)
            config = tool_config.get("config", {})

            # Only validate if tool is enabled
            if enabled:
                can_enable, error = can_enable_tool(tool_id, config)
                if not can_enable:
                    errors.append(f"{tool_id}: {error}")

        return errors

    def validate_single_tool(
        self, tool_id: str, tool_config: Dict[str, Any]
    ) -> tuple[bool, Optional[str]]:
        """
        Validate a single tool's configuration.

        Args:
            tool_id: The tool identifier
            tool_config: The tool's configuration (enabled, config)

        Returns:
            tuple: (is_valid, error_message)
        """
        enabled = tool_config.get("enabled", False)
        config = tool_config.get("config", {})

        # If not enabled, no validation needed
        if not enabled:
            return True, None

        return can_enable_tool(tool_id, config)

    async def initialize_user_config(
        self, user_id: str, persona: str = DEFAULT_PERSONA
    ) -> Dict[str, Any]:
        """
        Initialize default tool configuration for a new user.

        Populates the configuration with default tool states from the registry.

        Args:
            user_id: The authenticated user ID from JWT token
            persona: The persona identifier (default: "generic")

        Returns:
            Dict containing the initialized tool configuration
        """
        created_at = datetime.now(timezone.utc).isoformat()

        # Get default tool config from registry
        default_tools = get_default_tool_config()

        item = {
            "user_id": user_id,
            "persona": persona,
            "local_tools": default_tools,
            "mcp_servers": [],
            "updated_at": created_at,
        }

        try:
            # Use conditional write to prevent overwriting existing config
            await asyncio.to_thread(
                lambda: self.table.put_item(
                    Item=item,
                    ConditionExpression="attribute_not_exists(user_id) AND attribute_not_exists(persona)",
                )
            )
            logger.debug(f"Initialized config for user: {user_id}, persona: {persona}")
            return item

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")

            if error_code == "ConditionalCheckFailedException":
                # Config already exists - return existing
                logger.debug(
                    f"Config already exists for user: {user_id}, persona: {persona}"
                )
                response = await asyncio.to_thread(
                    lambda: self.table.get_item(
                        Key={"user_id": user_id, "persona": persona}
                    )
                )
                existing = response.get("Item")
                return self._apply_schema_defaults(existing) if existing else item
            else:
                logger.error(f"Error initializing config for user {user_id}: {e}")
                raise

    async def add_mcp_server(
        self, user_id: str, server: Dict[str, Any], persona: str = DEFAULT_PERSONA
    ) -> Dict[str, Any]:
        """
        Add an MCP server to user's configuration.

        Stores the server configuration in DynamoDB. Tool discovery is handled
        by MCPLifecycleManager during startup and session reconciliation —
        no extraction is performed here.

        Args:
            user_id: The authenticated user ID from JWT token
            server: MCP server configuration (name, url, transport)
            persona: The persona identifier (default: "generic")

        Returns:
            The server configuration as stored

        """
        server_name = server.get("name", "unknown")
        server_url = server.get("url")
        transport = server.get("transport", "streamable_http")

        logger.debug(f"Adding MCP server '{server_name}' for user {user_id}")

        # Prepare server config — tool discovery deferred to MCPLifecycleManager
        server_config = {
            "name": server_name,
            "url": server_url,
            "transport": transport,
            "enabled": server.get("enabled", True),
            "status": "available",
            "last_refresh": datetime.now(timezone.utc).isoformat(),
            "tools": {},
        }

        # Include optional stdio fields
        if transport == "stdio":
            if "command" in server:
                server_config["command"] = server["command"]
            if "args" in server:
                server_config["args"] = server["args"]

        # Save the server configuration
        try:
            config = await self.get_config(user_id, persona)

            if config is None:
                config = await self.initialize_user_config(user_id, persona)

            mcp_servers = config.get("mcp_servers", [])

            # Check if server with same name already exists
            existing_names = {s.get("name") for s in mcp_servers}
            if server_name in existing_names:
                # Update existing server
                mcp_servers = [
                    server_config if s.get("name") == server_name else s
                    for s in mcp_servers
                ]
            else:
                # Add new server
                mcp_servers.append(server_config)

            config["mcp_servers"] = mcp_servers
            await self.save_config(user_id, config, persona)

            return server_config

        except ClientError as e:
            logger.error(f"Error saving MCP server for user {user_id}: {e}")
            raise

    async def remove_mcp_server(
        self, user_id: str, server_name: str, persona: str = DEFAULT_PERSONA
    ) -> bool:
        """
        Remove an MCP server from user's configuration.

        Args:
            user_id: The authenticated user ID from JWT token
            server_name: Name of the MCP server to remove
            persona: The persona identifier (default: "generic")

        Returns:
            True if removal was successful
        """
        try:
            config = await self.get_config(user_id, persona)

            if config is None:
                logger.warning(
                    f"No config found for user {user_id} when removing MCP server"
                )
                return True  # Nothing to remove

            mcp_servers = config.get("mcp_servers", [])

            # Filter out the server to remove
            config["mcp_servers"] = [
                s for s in mcp_servers if s.get("name") != server_name
            ]

            return await self.save_config(user_id, config, persona)

        except ClientError as e:
            logger.error(f"Error removing MCP server for user {user_id}: {e}")
            raise

    async def refresh_mcp_server_tools(
        self, user_id: str, server_name: str, persona: str = DEFAULT_PERSONA
    ) -> Dict[str, Any]:
        """
        Refresh tools from an MCP server.

        In the new lifecycle architecture, tool discovery is handled by
        MCPLifecycleManager. This method updates the server's last_refresh
        timestamp and status. Actual tool re-discovery happens during
        session reconciliation with refresh=true.

        Args:
            user_id: The authenticated user ID from JWT token
            server_name: Name of the MCP server to refresh
            persona: The persona identifier (default: "generic")

        Returns:
            The updated server configuration

        Raises:
            ValueError: If server not found in configuration
            ClientError: If DynamoDB operation fails

        """
        logger.debug(f"Refreshing MCP server '{server_name}' for user {user_id}")

        # Get current configuration
        config = await self.get_config(user_id, persona)
        if config is None:
            raise ValueError(f"No configuration found for user {user_id}")

        mcp_servers = config.get("mcp_servers", [])

        # Find the server to refresh
        server_config = None
        server_index = None
        for i, server in enumerate(mcp_servers):
            if server.get("name") == server_name:
                server_config = server
                server_index = i
                break

        if server_config is None:
            raise ValueError(f"MCP server '{server_name}' not found in configuration")

        # Update refresh timestamp — actual tool re-discovery deferred to MCPLifecycleManager
        server_config["last_refresh"] = datetime.now(timezone.utc).isoformat()

        # Update the server in the list
        mcp_servers[server_index] = server_config
        config["mcp_servers"] = mcp_servers

        # Save updated configuration
        await self.save_config(user_id, config, persona)

        return server_config

    def get_registry(self) -> Dict[str, dict]:
        """
        Get the tool registry as a dictionary.

        Returns:
            Dict containing all tool definitions
        """
        return get_registry_as_dict()

    async def load_mcp_tools(
        self, server_config: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Load tools from an MCP server.

        Connects to the MCP server and fetches the list of available tools.
        Supports streamable_http transport type.

        Args:
            server_config: MCP server configuration containing:
                - name: Server name
                - url: Server URL
                - transport: Transport type ("streamable_http" or "stdio")

        Returns:
            List of tool definitions from the MCP server, each containing:
                - name: Tool name
                - description: Tool description
                - enabled: Default enabled state (True)

        Raises:
            ValueError: If transport type is not supported
            httpx.HTTPError: If connection to MCP server fails
        """
        server_name = server_config.get("name", "unknown")
        server_url = server_config.get("url")
        transport = server_config.get("transport", "streamable_http")

        if not server_url:
            raise ValueError(f"MCP server '{server_name}' missing URL")

        if transport != "streamable_http":
            raise ValueError(
                f"Unsupported transport type '{transport}' for MCP server '{server_name}'. "
                "Only 'streamable_http' is currently supported."
            )

        logger.debug(f"Loading tools from MCP server: {server_name} at {server_url}")

        try:
            tools = await self._fetch_mcp_tools_http(server_url, server_name)
            logger.debug(f"Loaded {len(tools)} tools from MCP server: {server_name}")
            return tools

        except Exception as e:
            logger.error(f"Failed to load tools from MCP server '{server_name}': {e}")
            raise

    async def _fetch_mcp_tools_http(
        self, server_url: str, server_name: str
    ) -> List[Dict[str, Any]]:
        """
        Fetch tools from an MCP server using HTTP transport.

        Uses the MCP protocol to list available tools from the server.

        Args:
            server_url: The MCP server URL
            server_name: The server name for logging

        Returns:
            List of tool definitions
        """
        # Validate URL to prevent SSRF attacks
        _validate_mcp_url(server_url)

        # MCP servers typically expose a tools/list endpoint
        # The exact endpoint may vary based on MCP server implementation
        tools_url = server_url.rstrip("/")

        async with httpx.AsyncClient(timeout=30.0) as client:
            # Try to initialize MCP session and list tools
            # MCP protocol uses JSON-RPC 2.0 format
            request_payload = {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {},
            }

            response = await client.post(
                tools_url,
                json=request_payload,
                headers={
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
            )

            response.raise_for_status()
            result = response.json()

            # Parse MCP response
            if "error" in result:
                error = result["error"]
                raise ValueError(
                    f"MCP server error: {error.get('message', 'Unknown error')}"
                )

            tools_data = result.get("result", {}).get("tools", [])

            # Convert MCP tool format to our internal format
            tools = []
            for tool in tools_data:
                tools.append(
                    {
                        "name": tool.get("name", "unknown"),
                        "description": tool.get("description", ""),
                        "enabled": True,  # Default to enabled
                    }
                )

            return tools

    async def get_enabled_tools_for_session(
        self, user_id: str, persona: str = DEFAULT_PERSONA
    ) -> Dict[str, Any]:
        """
        Get all enabled tools for a chat session.

        Collects all enabled local tools and all enabled MCP tools from
        available servers. Skips tools from unavailable MCP servers.

        Args:
            user_id: The authenticated user ID from JWT token
            persona: The persona identifier (default: "generic")

        Returns:
            Dict containing:
                - local_tools: List of enabled local tool definitions
                - mcp_tools: List of enabled MCP tool definitions
                - skipped_servers: List of unavailable server names that were skipped

        """
        try:
            config = await self.get_config(user_id, persona)

            if config is None:
                logger.warning(
                    f"No config found for user {user_id}, returning empty tools"
                )
                return {"local_tools": [], "mcp_tools": [], "skipped_servers": []}

            enabled_local_tools = []
            enabled_mcp_tools = []
            skipped_servers = []

            # Collect enabled local tools
            local_tools = config.get("local_tools", {})
            registry = get_tool_registry()

            for tool_id, tool_settings in local_tools.items():
                if tool_settings.get("enabled", False):
                    # Get tool definition from registry
                    tool_def = registry.get(tool_id)
                    if tool_def:
                        enabled_local_tools.append(
                            {
                                "id": tool_id,
                                "name": tool_def.name,
                                "description": tool_def.description,
                                "tool_type": "local",
                                "config": tool_settings.get("config", {}),
                            }
                        )
                        logger.debug(f"Added enabled local tool: {tool_id}")

            # Collect enabled MCP tools from available servers
            mcp_servers = config.get("mcp_servers", [])

            for server in mcp_servers:
                server_name = server.get("name", "unknown")
                server_status = server.get("status", "available")
                server_enabled = server.get("enabled", True)

                # Skip disabled servers
                if not server_enabled:
                    logger.debug(f"Skipping disabled MCP server: {server_name}")
                    continue

                # Skip unavailable servers
                if server_status == "unavailable":
                    logger.warning(f"Skipping unavailable MCP server: {server_name}")
                    skipped_servers.append(server_name)
                    continue

                # Collect enabled tools from this server (using cached tools from DynamoDB)
                server_tools = server.get("tools", {})
                for tool_name, tool_data in server_tools.items():
                    if tool_data.get("enabled", False):
                        enabled_mcp_tools.append(
                            {
                                "name": tool_name,
                                "description": tool_data.get("description", ""),
                                "input_schema": tool_data.get("input_schema", {}),
                                "tool_type": "mcp",
                                "server_name": server_name,
                                "server_url": server.get("url"),
                                "transport": server.get("transport", "streamable_http"),
                            }
                        )
                        logger.debug(
                            f"Added enabled MCP tool: {tool_name} from {server_name}"
                        )

            logger.debug(
                f"Session tools for user {user_id}: "
                f"{len(enabled_local_tools)} local, {len(enabled_mcp_tools)} MCP, "
                f"{len(skipped_servers)} servers skipped"
            )

            return {
                "local_tools": enabled_local_tools,
                "mcp_tools": enabled_mcp_tools,
                "skipped_servers": skipped_servers,
            }

        except Exception as e:
            logger.error(f"Error getting enabled tools for session: {e}")
            raise

    def _apply_schema_defaults(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Apply default values for missing fields due to schema evolution.

        Args:
            config: The stored configuration

        Returns:
            Configuration with missing fields populated with defaults
        """
        # Ensure local_tools exists
        if "local_tools" not in config:
            config["local_tools"] = get_default_tool_config()

        # Ensure mcp_servers exists
        if "mcp_servers" not in config:
            config["mcp_servers"] = []

        # Ensure updated_at exists
        if "updated_at" not in config:
            config["updated_at"] = datetime.now(timezone.utc).isoformat()

        # Merge any new tools from registry that aren't in user config
        config = self.merge_registry_tools(config)

        return config

    def merge_registry_tools(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """
        Merge new tools from registry into existing user configuration.

        Adds any new tools from the registry that aren't in the user's config,
        while preserving all existing user preferences (enabled states and
        config values). This ensures that when the registry is updated with
        new tools, users automatically get access to them without losing
        their existing settings.

        Args:
            config: The user's existing tool configuration

        Returns:
            Updated configuration with new tools merged in

        """
        local_tools = config.get("local_tools", {})
        registry = get_tool_registry()
        merged_count = 0

        for tool_id, tool_def in registry.items():
            if tool_id not in local_tools:
                # New tool from registry - add with default settings
                # User preferences are preserved because we only add missing tools
                local_tools[tool_id] = {
                    "enabled": tool_def.enabled_by_default,
                    "config": {},
                }
                merged_count += 1
                logger.debug(f"Merged new tool from registry: {tool_id}")

        if merged_count > 0:
            logger.debug(f"Merged {merged_count} new tool(s) from registry")

        config["local_tools"] = local_tools
        return config


def _validate_mcp_url(url: str) -> None:
    """Validate an MCP server URL to prevent SSRF attacks.

    Rejects non-HTTPS schemes, loopback, link-local, and private network addresses.
    """
    parsed = urlparse(url)
    if parsed.scheme not in ("https", "http"):
        raise ValueError(
            f"Unsupported URL scheme: {parsed.scheme}. Only http/https allowed."
        )

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL is missing a hostname.")

    # Reject obvious internal hostnames
    _blocked_hostnames = {"localhost", "metadata.google.internal"}
    if hostname.lower() in _blocked_hostnames:
        raise ValueError(f"MCP server URL targets a blocked hostname: {hostname}")

    # Resolve hostname and reject internal/private IP ranges
    try:
        resolved = socket.getaddrinfo(
            hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
        for _family, _type, _proto, _canonname, sockaddr in resolved:
            ip = ipaddress.ip_address(sockaddr[0])
            if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved:
                raise ValueError(f"MCP server URL resolves to a blocked address: {ip}")
    except socket.gaierror as e:
        raise ValueError(f"Cannot resolve MCP server hostname '{hostname}': {e}")


# Global service instance
tool_config_service = ToolConfigService()
