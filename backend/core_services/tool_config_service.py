"""
Tool Configuration Service for Core-Services.

Provides CRUD operations for managing user tool configurations in DynamoDB.
Configurations are stored with user_id (PK) and persona (SK) partitioning.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import boto3
from botocore.exceptions import ClientError

from config import TOOL_CONFIG_TABLE, REGION
from utils import logger
from tool_registry import (
    get_default_tool_config,
    get_tool_registry,
    get_registry_as_dict,
    can_enable_tool,
)

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
            response = self.table.get_item(Key={"user_id": user_id, "persona": persona})

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
            response = self.table.get_item(Key={"user_id": user_id, "persona": persona})
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
            self.table.put_item(Item=item)
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
            self.table.put_item(
                Item=item,
                ConditionExpression="attribute_not_exists(user_id) AND attribute_not_exists(persona)",
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
                response = self.table.get_item(
                    Key={"user_id": user_id, "persona": persona}
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

        Saves the server configuration to DynamoDB. Tool discovery is handled
        by sparky's MCPLifecycleManager at startup and during session reconciliation.

        Args:
            user_id: The authenticated user ID from JWT token
            server: MCP server configuration (name, url/command, transport)
            persona: The persona identifier (default: "generic")

        Returns:
            The saved server configuration

        """
        server_name = server.get("name", "unknown")
        transport = server.get("transport", "streamable_http")

        logger.debug(f"Adding MCP server '{server_name}' for user {user_id}")

        # Prepare server config for storage
        server_config = {
            "name": server_name,
            "transport": transport,
            "enabled": server.get("enabled", True),
            "tools": server.get("tools", {}),
            "status": server.get("status", "unknown"),
        }

        # Include transport-specific fields
        if transport == "streamable_http":
            server_config["url"] = server.get("url")
        elif transport == "stdio":
            server_config["command"] = server.get("command")
            server_config["args"] = server.get("args", [])

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

    def get_registry(self) -> Dict[str, dict]:
        """
        Get the tool registry as a dictionary.

        Returns:
            Dict containing all tool definitions
        """
        return get_registry_as_dict()

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


# Global service instance
tool_config_service = ToolConfigService()
