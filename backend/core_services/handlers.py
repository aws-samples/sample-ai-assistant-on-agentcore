"""
Request Handlers for Core-Services.

Provides handler functions for synchronous API operations including:
- Chat history management (list, delete, generate description)
- Tool configuration (get, save, registry)
- MCP server management (add, delete, load, refresh)
- Search functionality
- Skills management (list, get, create, update, delete)

"""

import asyncio
from typing import Dict, Any, Optional
from fastapi.responses import JSONResponse

from botocore.exceptions import ClientError
from utils import logger, CORS_HEADERS, error_envelope
from config import bedrock_client, MODEL_ID, history_graph, checkpointer
from history_manager import get_history
from chat_history_service import chat_history_service
from tool_config_service import tool_config_service
from kb_search_service import get_kb_search_service
from skills_service import skills_service
from session_validator import validate_session_id, validate_session_ownership
from project_service import project_service
from project_file_manager import project_file_manager
from project_kb_service import project_kb_service


def _composite_actor_id(user_id: str, project_id: str) -> str:
    return f"{user_id.replace('-', '')}_{project_id.replace('-', '')}"


# System prompt for description generation
DESCRIPTION_SYSTEM_PROMPT = """You are a helpful assistant that generates very brief titles for chat conversations.
Your task is to create a concise title (maximum 10 words) that captures the essence of the user's message.
Return ONLY the title, nothing else. No quotes, no explanations, just the title."""


async def generate_description_with_llm(message: str) -> Optional[str]:
    """
    Generate a brief description using Bedrock Converse API directly.
    Simple, no tools, no LangGraph - just a direct LLM call.

    Args:
        message: The user's message to summarize

    Returns:
        Generated description string or None if generation fails
    """
    try:
        import asyncio

        # Prepare the request for Bedrock Converse API
        request = {
            "modelId": MODEL_ID,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"text": f"Generate a title for this message: {message[:500]}"}
                    ],
                }
            ],
            "system": [{"text": DESCRIPTION_SYSTEM_PROMPT}],
            "inferenceConfig": {"maxTokens": 100, "temperature": 0},
        }

        # Run in executor to avoid blocking async loop
        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, lambda: bedrock_client.converse(**request)
        )

        # Extract the response text
        output = response.get("output", {})
        message_content = output.get("message", {}).get("content", [])
        if message_content:
            description = message_content[0].get("text", "").strip()

            # Ensure description is within word limit (10 words max)
            words = description.split()
            if len(words) > 10:
                description = " ".join(words[:10])

            return description

        return None

    except Exception as e:
        logger.error(f"Failed to generate description: {e}")
        return None


class RequestHandlers:
    """
    Handler class for Core-Services API requests.

    Provides static methods for handling various synchronous API operations.
    """

    # =========================================================================
    # Chat History Handlers
    # =========================================================================

    @staticmethod
    async def handle_chat_history(
        user_id: str,
        limit: int = 20,
        cursor: Optional[Dict[str, Any]] = None,
        bookmarked_filter: Optional[bool] = None,
    ) -> JSONResponse:
        """Handle chat history fetch requests with pagination.

        Retrieves paginated chat sessions for the authenticated user from the
        Chat_History_Table, ordered by created_at descending (most recent first).

        Args:
            user_id: The authenticated user ID from JWT token
            limit: Maximum number of sessions to return (default 20)
            cursor: Pagination cursor from previous request
            bookmarked_filter: When False, exclude bookmarked sessions from results

        Returns:
            JSONResponse with:
            - sessions: List of sessions containing session_id, description, created_at, bookmarked
            - cursor: Pagination cursor for next page (null if no more pages)
            - has_more: Boolean indicating if more pages exist

        """
        try:
            result = await chat_history_service.get_user_sessions(
                user_id=user_id,
                limit=limit,
                last_evaluated_key=cursor,
                bookmarked_filter=bookmarked_filter,
            )

            formatted_sessions = [
                {
                    "session_id": session.get("session_id"),
                    "description": session.get("description"),
                    "created_at": session.get("created_at"),
                    "bookmarked": session.get("bookmarked", False),
                }
                for session in result["sessions"]
            ]

            return JSONResponse(
                {
                    "sessions": formatted_sessions,
                    "cursor": result["last_evaluated_key"],
                    "has_more": result["has_more"],
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to fetch chat history for user {user_id}: {e}")
            return error_envelope("internal_error", "Failed to fetch chat history")

    @staticmethod
    async def handle_toggle_bookmark(session_id: str, user_id: str) -> JSONResponse:
        """Handle toggling the bookmark state of a chat session.

        Flips the bookmarked flag on the session. Enforces ownership and
        a per-user cap of 50 bookmarked sessions when bookmarking.

        Args:
            session_id: The session to toggle
            user_id: The authenticated user ID from JWT token

        Returns:
            JSONResponse with type, session_id, and new bookmarked value

        """
        error_map = {
            "session_not_found": ("not_found", "Session not found"),
            "unauthorized": ("auth_error", "Not authorized to modify this chat"),
            "bookmark_limit_reached": (
                "bookmark_limit_reached",
                "You have reached the maximum of 50 bookmarked chats",
            ),
        }

        try:
            result = await chat_history_service.toggle_bookmark(
                session_id=session_id, user_id=user_id
            )
            return JSONResponse(
                {
                    "type": "bookmark_toggled",
                    "session_id": result["session_id"],
                    "bookmarked": result["bookmarked"],
                },
                headers=CORS_HEADERS,
            )
        except ValueError as e:
            code, message = error_map.get(
                str(e), ("internal_error", "An unexpected error occurred")
            )
            return error_envelope(code, message)
        except Exception as e:
            logger.error(f"Failed to toggle bookmark for session {session_id}: {e}")
            return error_envelope("internal_error", "Failed to toggle bookmark")

    @staticmethod
    async def handle_bookmarked_chat_history(user_id: str) -> JSONResponse:
        """Handle fetching all bookmarked chat sessions for a user.

        Returns the full list of bookmarked sessions (no pagination) since
        bookmarks are capped at 50 per user.

        Args:
            user_id: The authenticated user ID from JWT token

        Returns:
            JSONResponse with sessions array (no cursor or has_more fields)

        """
        try:
            sessions = await chat_history_service.get_bookmarked_sessions(
                user_id=user_id
            )

            formatted_sessions = [
                {
                    "session_id": session.get("session_id"),
                    "description": session.get("description"),
                    "created_at": session.get("created_at"),
                    "bookmarked": True,
                }
                for session in sessions
            ]

            return JSONResponse(
                {"sessions": formatted_sessions},
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(
                f"Failed to fetch bookmarked chat history for user {user_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to fetch bookmarked chat history"
            )

    @staticmethod
    async def handle_delete_history(session_id: str) -> JSONResponse:
        """Handle deletion of chat history.

        Deletes the session from the Chat_History_Table. KB cleanup is handled
        by the DynamoDB Stream → EventBridge Pipe → SQS → Lambda pipeline.
        Note: Bedrock checkpointer cleanup is handled by Sparky since it has
        access to the checkpointer.

        Args:
            session_id: The session ID to delete

        Returns:
            JSONResponse with success status. Returns success even if session
            doesn't exist (idempotent delete).

        """
        try:
            # Delete from Chat_History_Table
            try:
                await chat_history_service.delete_session(session_id)
                logger.debug(f"Deleted session {session_id} from Chat_History_Table")
            except Exception as e:
                logger.error(
                    f"Error deleting session {session_id} from Chat_History_Table: {e}"
                )

            # Delete checkpoint data from the checkpointer store
            try:
                if checkpointer and hasattr(checkpointer, "adelete_thread"):
                    await checkpointer.adelete_thread(session_id)
                    logger.debug(f"Deleted checkpoints for session {session_id}")
            except Exception as e:
                logger.warning(
                    f"Checkpoint cleanup failed for session {session_id} (non-fatal): {e}"
                )

            # Note: KB cleanup is now handled by the DynamoDB Stream → EventBridge Pipe →
            # SQS → Lambda pipeline. No application-level KB delete publishing needed.

            return JSONResponse(
                {"success": True, "message": "Session deleted successfully"},
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Unexpected error in handle_delete_history: {e}")
            return error_envelope("internal_error", "Failed to delete history")

    @staticmethod
    async def handle_rename_chat(
        session_id: str, description: str, user_id: str
    ) -> JSONResponse:
        """Handle renaming a chat session.

        Updates the description/title of an existing chat session in the
        Chat_History_Table. Validates that the session exists and belongs
        to the user before updating.

        Args:
            session_id: The session ID to rename
            description: The new title/description for the chat
            user_id: The authenticated user ID from JWT token

        Returns:
            JSONResponse with session_id and updated description

        """
        try:
            if not session_id:
                return error_envelope("validation_error", "session_id is required")

            if not description or not description.strip():
                return error_envelope("validation_error", "description is required")

            description = description.strip()

            # Enforce max length
            if len(description) > 100:
                return error_envelope(
                    "validation_error",
                    "Description must be 100 characters or less",
                )

            # Verify the session exists and belongs to the user
            session = await chat_history_service.get_session(session_id)
            if not session:
                return error_envelope("not_found", "Session not found")

            if session.get("user_id") != user_id:
                return error_envelope(
                    "auth_error", "Not authorized to rename this chat"
                )

            # Update the description
            success = await chat_history_service.update_session_description(
                session_id=session_id, description=description
            )

            if not success:
                return error_envelope(
                    "internal_error", "Failed to update session description"
                )

            return JSONResponse(
                {
                    "type": "chat_renamed",
                    "session_id": session_id,
                    "description": description,
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to rename chat {session_id}: {e}")
            return error_envelope("internal_error", "Failed to rename chat")

    @staticmethod
    async def handle_generate_description(
        session_id: str, message: str, user_id: str, project_id: Optional[str] = None
    ) -> JSONResponse:
        """Handle description generation for a chat session.

        Generates a 1-line summary (10 words max) using a simple LLM call
        and updates the Chat_History_Table with the description.

        Args:
            session_id: The session ID to generate description for
            message: The user's message to summarize
            user_id: The authenticated user ID from JWT token

        Returns:
            JSONResponse with session_id and generated description

        """
        try:
            if not session_id:
                return error_envelope("validation_error", "session_id is required")

            if not message:
                return error_envelope("validation_error", "message is required")

            # Generate description using simple LLM call
            description = await generate_description_with_llm(message)

            # Fallback to truncated message if LLM fails
            if not description:
                description = message[:50] + "..." if len(message) > 50 else message

            # Create session record first, then update with description and optional project binding
            try:
                await chat_history_service.create_session_record(
                    session_id=session_id, user_id=user_id
                )
                await chat_history_service.update_session_description(
                    session_id=session_id, description=description
                )
                if project_id:
                    project = await project_service.get_project_for_user(
                        project_id, user_id
                    )
                    if project:
                        await chat_history_service.bind_project(session_id, project_id)
            except Exception as e:
                logger.error(f"Failed to save to history table: {e}")
                # Continue to return description even if persistence fails

            return JSONResponse(
                {
                    "session_id": session_id,
                    "description": description,
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to generate description: {e}")
            return error_envelope("internal_error", "Failed to generate description")

    @staticmethod
    async def handle_get_session(session_id: str, user_id: str) -> JSONResponse:
        """Handle get_session requests with ownership validation.

        Retrieves a session record by ID after validating that the
        authenticated user owns the session.

        Args:
            session_id: The session ID from the request payload.
            user_id: The authenticated user ID from JWT token.

        Returns:
            JSONResponse with the session record on success, or an
            error envelope for validation, authorization, or internal errors.
        """
        try:
            validation_error = validate_session_id(session_id)
            if validation_error:
                msg = (
                    "session_id is required"
                    if not session_id
                    else "session_id must be a valid UUID"
                )
                return error_envelope(validation_error, msg)

            result, session_record = await validate_session_ownership(
                session_id, user_id
            )

            if result == "session_not_found":
                return error_envelope("session_not_found", "Session not found")

            if result == "unauthorized":
                return error_envelope(
                    "unauthorized", "Access denied: session belongs to another user"
                )

            return JSONResponse(
                {
                    "type": "session",
                    "session": session_record,
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to retrieve session {session_id}: {e}")
            return error_envelope("internal_error", "Failed to retrieve session")

    @staticmethod
    async def handle_get_session_history(session_id: str, user_id: str) -> JSONResponse:
        """Handle get_session_history requests with ownership validation.

        Retrieves conversation history for a session after validating that
        the authenticated user owns the session. Uses the LangGraph
        checkpointer to read messages from AgentCore Memory.

        Args:
            session_id: The session ID from the request payload.
            user_id: The authenticated user ID from JWT token.

        Returns:
            JSONResponse with the formatted conversation history on success,
            or an error envelope for validation, authorization, or internal errors.
        """
        try:
            validation_error = validate_session_id(session_id)
            if validation_error:
                msg = (
                    "session_id is required"
                    if not session_id
                    else "session_id must be a valid UUID"
                )
                return error_envelope(validation_error, msg)

            result, session_record = await validate_session_ownership(
                session_id, user_id
            )

            if result == "session_not_found":
                return error_envelope("session_not_found", "Session not found")

            if result == "unauthorized":
                return error_envelope(
                    "unauthorized", "Access denied: session belongs to another user"
                )

            history = await get_history(history_graph, session_id, user_id)

            history_data = history.get("history", []) if history else []
            canvases_data = history.get("canvases", {}) if history else {}

            # Resolve bound project from session record
            bound_project = None
            project_id = session_record.get("project_id") if session_record else None
            if project_id:
                try:
                    bound_project = await project_service.get_project_for_user(
                        project_id, user_id
                    )
                except Exception as e:
                    logger.warning(
                        f"Failed to fetch bound project for history (non-fatal): {e}"
                    )

            return JSONResponse(
                {
                    "type": "session_history",
                    "session_id": session_id,
                    "history": history_data,
                    "canvases": canvases_data,
                    "project": bound_project,
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(
                f"Failed to retrieve conversation history for session {session_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to retrieve conversation history"
            )

    # =========================================================================
    # Tool Configuration Handlers
    # =========================================================================

    @staticmethod
    async def handle_get_tool_config(
        user_id: str, persona: str = "generic"
    ) -> JSONResponse:
        """Handle get tool configuration requests.

        Fetches the user's tool configuration from DynamoDB.
        If no configuration exists, initializes default configuration.

        Args:
            user_id: The authenticated user ID from JWT token
            persona: The persona identifier (default: "generic")

        Returns:
            JSONResponse with the user's tool configuration

        """
        try:
            config = await tool_config_service.get_config(user_id, persona)

            return JSONResponse(
                {
                    "type": "tool_config",
                    "config": config,
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to get tool config for user {user_id}: {e}")
            return error_envelope("internal_error", "Failed to get tool configuration")

    @staticmethod
    async def handle_save_tool_config(
        user_id: str, config: Dict[str, Any], persona: str = "generic"
    ) -> JSONResponse:
        """Handle save tool configuration requests.

        Persists the user's tool configuration to DynamoDB.
        Validates tool configurations before saving.

        Args:
            user_id: The authenticated user ID from JWT token
            config: The tool configuration to save
            persona: The persona identifier (default: "generic")

        Returns:
            JSONResponse with success status

        """
        try:
            await tool_config_service.save_config(user_id, config, persona)

            return JSONResponse(
                {
                    "type": "tool_config_saved",
                    "success": True,
                    "message": "Tool configuration saved successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            # Validation error
            logger.warning(f"Tool config validation failed for user {user_id}: {e}")
            return error_envelope(
                "tool_config_error", str(e), {"validation_error": True}
            )

        except Exception as e:
            logger.error(f"Failed to save tool config for user {user_id}: {e}")
            return error_envelope("internal_error", "Failed to save tool configuration")

    @staticmethod
    async def handle_get_tool_registry() -> JSONResponse:
        """Handle get tool registry requests.

        Returns the tool registry containing all available local tools
        and their configuration requirements.

        Returns:
            JSONResponse with the tool registry

        """
        try:
            registry = tool_config_service.get_registry()

            return JSONResponse(
                {
                    "type": "tool_registry",
                    "registry": registry,
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to get tool registry: {e}")
            return error_envelope("internal_error", "Failed to get tool registry")

    # =========================================================================
    # MCP Server Handlers
    # =========================================================================

    @staticmethod
    async def handle_add_mcp_server(
        user_id: str, server: Dict[str, Any], persona: str = "generic"
    ) -> JSONResponse:
        """Handle add MCP server requests.

        Adds a new MCP server to the user's configuration in DynamoDB.
        Validates transport type and transport-specific required fields.
        If a server with the same name exists, it will be updated.

        Args:
            user_id: The authenticated user ID from JWT token
            server: MCP server configuration (name, url/command, transport, enabled, tools)
            persona: The persona identifier (default: "generic")

        Returns:
            JSONResponse with success status and server configuration

        """
        try:
            # Validate required server fields
            if not server.get("name"):
                return error_envelope("validation_error", "Server name is required")

            # Validate transport type
            transport = server.get("transport", "")
            if transport not in ("streamable_http", "stdio"):
                return error_envelope(
                    "validation_error",
                    f"Unsupported transport type: '{transport}'. Must be 'streamable_http' or 'stdio'.",
                )

            # Validate transport-specific required field
            if transport == "streamable_http" and not server.get("url"):
                return error_envelope(
                    "validation_error",
                    "Server URL is required for streamable_http transport",
                )

            if transport == "stdio" and not server.get("command"):
                return error_envelope(
                    "validation_error", "Command is required for stdio transport"
                )

            # Validate stdio command against allowlist to prevent arbitrary command execution
            _ALLOWED_STDIO_COMMANDS = {"python", "python3", "uvx", "npx", "node"}
            _DANGEROUS_ARGS = {"-c", "--eval", "-e", "--exec", "--import"}
            if transport == "stdio":
                import os as _os

                cmd_basename = _os.path.basename(server.get("command", ""))
                if cmd_basename not in _ALLOWED_STDIO_COMMANDS:
                    return error_envelope(
                        "validation_error",
                        f"Unsupported stdio command '{cmd_basename}'. "
                        f"Allowed: {', '.join(sorted(_ALLOWED_STDIO_COMMANDS))}.",
                    )
                args = server.get("args", [])
                if any(a in _DANGEROUS_ARGS for a in args):
                    return error_envelope(
                        "validation_error",
                        "Inline code execution flags (-c, --eval, -e) are not allowed in MCP server args.",
                    )

            # Connect to the MCP server and discover tools before saving.
            # If the connection fails, reject the add so the user knows immediately.
            from langchain_mcp_adapters.client import MultiServerMCPClient

            server_name = server.get("name")
            if transport == "streamable_http":
                client_config = {
                    server_name: {
                        "transport": "streamable_http",
                        "url": server.get("url"),
                    }
                }
            else:  # stdio
                client_config = {
                    server_name: {
                        "transport": "stdio",
                        "command": server.get("command"),
                        "args": server.get("args", []),
                    }
                }

            try:
                client = MultiServerMCPClient(client_config)
                discovered_tools = await client.get_tools()
            except Exception as conn_err:
                logger.error(
                    f"Failed to connect to MCP server '{server_name}': {conn_err}"
                )
                # Provide a user-friendly message for unsupported commands
                unsupported_commands = {"yarn", "pnpm", "bun", "deno"}
                command = server.get("command", "")
                if transport == "stdio" and command in unsupported_commands:
                    friendly_msg = (
                        f"The command '{command}' is not available in this environment. "
                        f"Only 'uvx', 'python', 'python3', 'node', 'npm', and 'npx' are supported for stdio transport. "
                        f"Alternatively, use a server that supports 'streamable_http' transport."
                    )
                else:
                    friendly_msg = f"Could not connect to MCP server '{server_name}'. Please verify the server configuration."
                return error_envelope("validation_error", friendly_msg)

            # Build tools dict from discovered tools (all enabled by default)
            tools = {}
            for tool in discovered_tools:
                tools[tool.name] = {"enabled": True}

            server["tools"] = tools
            server["enabled"] = server.get("enabled", True)
            server["status"] = "available"

            # Save server config with discovered tools to DynamoDB
            server_config = await tool_config_service.add_mcp_server(
                user_id, server, persona
            )

            return JSONResponse(
                {
                    "type": "mcp_server_added",
                    "success": True,
                    "server": server_config,
                    "tools_discovered": len(tools),
                    "message": f"MCP server '{server_name}' added with {len(tools)} tools",
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to add MCP server for user {user_id}: {e}")
            return error_envelope("internal_error", "Failed to add MCP server")

    @staticmethod
    async def handle_delete_mcp_server(
        user_id: str, server_name: str, persona: str = "generic"
    ) -> JSONResponse:
        """Handle delete MCP server requests.

        Removes an MCP server and its associated tool states from the user's
        configuration.

        Args:
            user_id: The authenticated user ID from JWT token
            server_name: Name of the MCP server to remove
            persona: The persona identifier (default: "generic")

        Returns:
            JSONResponse with success status

        """
        try:
            if not server_name:
                return error_envelope("validation_error", "Server name is required")

            await tool_config_service.remove_mcp_server(user_id, server_name, persona)

            return JSONResponse(
                {
                    "type": "mcp_server_deleted",
                    "success": True,
                    "message": f"MCP server '{server_name}' deleted successfully",
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to delete MCP server for user {user_id}: {e}")
            return error_envelope("internal_error", "Failed to delete MCP server")

    @staticmethod
    async def handle_refresh_mcp_tools(
        user_id: str, server_name: str, persona: str = "generic"
    ) -> JSONResponse:
        """Handle refresh MCP tools requests.

        Connects to the MCP server directly using MultiServerMCPClient,
        re-discovers its current tools, and syncs the preference in DynamoDB.
        New tools are added as enabled by default, removed tools are cleaned up,
        and existing tool enabled/disabled states are preserved.

        Args:
            user_id: The authenticated user ID from JWT token
            server_name: Name of the MCP server to refresh
            persona: The persona identifier (default: "generic")

        Returns:
            JSONResponse with updated server config including synced tools

        """
        try:
            if not server_name:
                return error_envelope("validation_error", "Server name is required")

            # Get current config to find the server
            config = await tool_config_service.get_config(user_id, persona)
            if config is None:
                return error_envelope("not_found", "No configuration found")

            mcp_servers = config.get("mcp_servers", [])
            server = next(
                (s for s in mcp_servers if s.get("name") == server_name), None
            )
            if server is None:
                return error_envelope(
                    "not_found", f"MCP server '{server_name}' not found"
                )

            transport = server.get("transport", "streamable_http")

            # Build client config for MultiServerMCPClient
            from langchain_mcp_adapters.client import MultiServerMCPClient

            if transport == "streamable_http":
                client_config = {
                    server_name: {
                        "transport": "streamable_http",
                        "url": server.get("url"),
                    }
                }
            elif transport == "stdio":
                # Validate command against allowlist before execution
                import os as _os

                _ALLOWED_STDIO_COMMANDS = {"python", "python3", "uvx", "npx", "node"}
                cmd_basename = _os.path.basename(server.get("command", ""))
                if cmd_basename not in _ALLOWED_STDIO_COMMANDS:
                    return error_envelope(
                        "validation_error",
                        f"Unsupported stdio command '{cmd_basename}'. "
                        f"Allowed: {', '.join(sorted(_ALLOWED_STDIO_COMMANDS))}.",
                    )
                _DANGEROUS_ARGS = {"-c", "--eval", "-e", "--exec", "--import"}
                args = server.get("args", [])
                if any(a in _DANGEROUS_ARGS for a in args):
                    return error_envelope(
                        "validation_error",
                        "Inline code execution flags (-c, --eval, -e) are not allowed in MCP server args.",
                    )
                client_config = {
                    server_name: {
                        "transport": "stdio",
                        "command": server.get("command"),
                        "args": args,
                    }
                }
            else:
                return error_envelope(
                    "validation_error", f"Unsupported transport type: '{transport}'"
                )

            # Connect and discover tools
            client = MultiServerMCPClient(client_config)
            discovered_tools = await client.get_tools()

            existing_tools = server.get("tools", {})

            # Sync: preserve existing states, add new as enabled, remove stale
            synced_tools = {}
            for tool in discovered_tools:
                if tool.name in existing_tools:
                    synced_tools[tool.name] = existing_tools[tool.name]
                else:
                    synced_tools[tool.name] = {"enabled": True}

            # Update server in config
            from datetime import datetime, timezone

            updated_server = {
                **server,
                "tools": synced_tools,
                "status": "available",
                "last_refresh": datetime.now(timezone.utc).isoformat(),
            }

            config["mcp_servers"] = [
                updated_server if s.get("name") == server_name else s
                for s in mcp_servers
            ]
            await tool_config_service.save_config(user_id, config, persona)

            return JSONResponse(
                {
                    "type": "mcp_tools_refreshed",
                    "success": True,
                    "server": updated_server,
                    "message": f"Refreshed {len(synced_tools)} tools for '{server_name}'",
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(
                f"Failed to refresh MCP tools for server '{server_name}', user {user_id}: {e}"
            )
            # Provide a user-friendly message for unsupported commands
            unsupported_commands = {"yarn", "pnpm", "bun", "deno"}
            command = server.get("command", "") if server else ""
            transport_type = server.get("transport", "") if server else ""
            if transport_type == "stdio" and command in unsupported_commands:
                friendly_msg = (
                    f"The command '{command}' is not available in this environment. "
                    f"Only 'uvx', 'python', 'python3', 'node', 'npm', and 'npx' are supported for stdio transport. "
                    f"Alternatively, use a server that supports 'streamable_http' transport."
                )
            else:
                friendly_msg = f"Failed to refresh tools for '{server_name}'"
            return error_envelope("internal_error", friendly_msg)

    # =========================================================================
    # Search Handler
    # =========================================================================

    @staticmethod
    async def handle_search(query: str, user_id: str, limit: int = 10) -> JSONResponse:
        """Handle chat search requests using Bedrock KB.

        Performs hybrid search with user_id filtering and reranking to find
        relevant chat conversations. Returns formatted results with session_id,
        message_index, title, and content snippet.

        Args:
            query: The search query string
            user_id: The authenticated user ID from JWT token
            limit: Maximum number of results to return (default 10)

        Returns:
            JSONResponse with search results containing:
            - type: "search_results"
            - results: List of results with session_id, message_index, title, content, score
            - query: The original query
            - total: Number of results returned

        """
        try:
            kb_search_service = get_kb_search_service()

            if not kb_search_service.enabled:
                return JSONResponse(
                    {
                        "type": "search_results",
                        "results": [],
                        "query": query,
                        "total": 0,
                        "message": "Search is not available",
                    },
                    headers=CORS_HEADERS,
                )

            # Perform search with user_id filter
            results = await kb_search_service.search(
                query=query,
                user_id=user_id,
                limit=min(limit, 10),  # Enforce max 10 results
            )

            # Format results for response
            formatted_results = [
                {
                    "session_id": result.session_id,
                    "message_index": result.message_index,
                    "title": result.title,
                    "content": result.content[:100] + "..."
                    if len(result.content) > 100
                    else result.content,
                    "score": result.score,
                }
                for result in results
            ]

            return JSONResponse(
                {
                    "type": "search_results",
                    "results": formatted_results,
                    "query": query,
                    "total": len(formatted_results),
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            # Return error without exposing internal details
            logger.error(f"Search failed for user {user_id}: {e}")
            return error_envelope("internal_error", "Search failed. Please try again.")

    # =========================================================================
    # Skills Management Handlers
    # =========================================================================

    @staticmethod
    async def handle_list_skills(
        user_id: str, limit: int = 50, cursor: Optional[Dict[str, Any]] = None
    ) -> JSONResponse:
        """Handle list skills request.

        Returns skills categorized by type: system, user, and shared.

        Args:
            user_id: The authenticated user ID from JWT token
            limit: Maximum number of skills to return per category
            cursor: Pagination cursor (for user skills only)

        Returns:
            JSONResponse with categorized skills

        """
        try:
            # User's own skills
            result = await skills_service.list_skills(
                user_id=user_id, limit=limit, last_evaluated_key=cursor
            )

            # System skills
            system_skills = await skills_service.list_system_skills()

            # Annotate is_disabled on each skill
            disabled_skills = await skills_service.get_disabled_skills(user_id)
            for skill in system_skills:
                skill["is_disabled"] = skill.get("skill_name", "") in disabled_skills
            for skill in result["skills"]:
                skill["is_disabled"] = skill.get("skill_name", "") in disabled_skills

            return JSONResponse(
                {
                    "type": "skills_list",
                    "system": system_skills,
                    "user": result["skills"],
                    "cursor": result["last_evaluated_key"],
                    "has_more": result["has_more"],
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to list skills for user {user_id}: {e}")
            return error_envelope(
                "internal_error", "Failed to list skills. Please try again."
            )

    @staticmethod
    async def handle_list_public_skills(
        limit: int = 50, cursor: Optional[Dict[str, Any]] = None
    ) -> JSONResponse:
        """Handle list public skills request with pagination.

        Returns a paginated list of all public skills across all users.

        Args:
            limit: Maximum number of skills to return (default 50)
            cursor: Pagination cursor from previous request

        Returns:
            JSONResponse with:
            - type: "public_skills_list"
            - skills: List of public skills
            - cursor: Pagination cursor for next page
            - has_more: Boolean indicating if more pages exist

        """
        try:
            result = await skills_service.list_public_skills(
                limit=limit, last_evaluated_key=cursor
            )

            return JSONResponse(
                {
                    "type": "public_skills_list",
                    "skills": result["skills"],
                    "cursor": result["last_evaluated_key"],
                    "has_more": result["has_more"],
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to list public skills: {e}")
            return error_envelope(
                "internal_error", "Failed to list public skills. Please try again."
            )

    @staticmethod
    async def handle_get_skill(user_id: str, skill_name: str) -> JSONResponse:
        """Handle get single skill request.

        Returns the full skill including instruction.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill to fetch

        Returns:
            JSONResponse with:
            - type: "skill" and full skill data on success
            - type: "skill_not_found" error if skill doesn't exist

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")

            skill = await skills_service.get_skill(user_id, skill_name)

            # Fall back to system skill if not found under user
            if not skill:
                skill = await skills_service.get_skill("system", skill_name)

            if not skill:
                return error_envelope("not_found", f"Skill '{skill_name}' not found")

            return JSONResponse(
                {"type": "skill", "skill": skill},
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to get skill '{skill_name}' for user {user_id}: {e}")
            return error_envelope(
                "internal_error", "Failed to get skill. Please try again."
            )

    @staticmethod
    async def handle_get_skill_content(user_id: str, skill_name: str) -> JSONResponse:
        """Handle get skill content request.

        Returns the full skill content from S3: markdown, scripts, and templates.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill

        Returns:
            JSONResponse with markdown, scripts, and templates

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")

            # Check if it's a system skill by trying user partition first, then system
            if skills_service.is_system_skill(user_id):
                content = await skills_service.get_skill_content("system", skill_name)
            else:
                content = await skills_service.get_skill_content(user_id, skill_name)
                # Fall back to system skill content if user content is empty
                if not content.get("markdown"):
                    system_content = await skills_service.get_skill_content(
                        "system", skill_name
                    )
                    if system_content.get("markdown"):
                        content = system_content

            return JSONResponse(
                {
                    "type": "skill_content",
                    "markdown": content.get("markdown"),
                    "scripts": content.get("scripts", []),
                    "templates": content.get("templates", []),
                    "references": content.get("references", []),
                },
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(
                f"Failed to get skill content '{skill_name}' for user {user_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to get skill content. Please try again."
            )

    @staticmethod
    async def handle_save_skill_content(
        user_id: str, skill_name: str, filename: str, content: str
    ) -> JSONResponse:
        """Handle save skill content request.

        Saves SKILL.md or a script file to S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill
            filename: The file to save (e.g. "SKILL.md" or "scripts/analysis.py")
            content: The file content as a string

        Returns:
            JSONResponse with success status

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")
            if not filename:
                return error_envelope("validation_error", "filename is required")

            # Guard against system skill modification
            skills_service.guard_system_skill(user_id)

            s3_prefix = skills_service._s3_content_path(user_id, skill_name)

            if filename == "SKILL.md":
                skills_service._write_s3_object(f"{s3_prefix}SKILL.md", content)
            elif filename.endswith(".md"):
                # Reference file
                skills_service._validate_reference_filename(filename)
                skills_service._write_s3_object(
                    f"{s3_prefix}references/{filename}", content
                )
            else:
                # Script file
                skills_service._validate_script_filename(filename)
                skills_service._write_s3_object(
                    f"{s3_prefix}scripts/{filename}", content
                )

            return JSONResponse(
                {
                    "type": "content_saved",
                    "success": True,
                    "message": f"'{filename}' saved successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            error_type = (
                "access_denied" if "read-only" in str(e).lower() else "validation_error"
            )
            if error_type == "access_denied":
                return error_envelope("skill_error", str(e))
            return error_envelope("validation_error", str(e))
        except Exception as e:
            logger.error(
                f"Failed to save content '{filename}' for skill "
                f"'{skill_name}' (user: {user_id}): {e}"
            )
            return error_envelope(
                "internal_error", "Failed to save content. Please try again."
            )

    @staticmethod
    async def handle_get_public_skill(
        user_id: str, creator_user_id: str, skill_name: str
    ) -> JSONResponse:
        """Handle get public skill request.

        Returns the full skill if it exists and is public.

        Args:
            user_id: The authenticated user ID from JWT token
            creator_user_id: The user_id of the skill creator
            skill_name: The name of the skill to fetch

        Returns:
            JSONResponse with:
            - type: "skill" and full skill data on success
            - type: "skill_not_found" if skill doesn't exist or is not public

        """
        try:
            if not creator_user_id or not skill_name:
                return error_envelope(
                    "validation_error", "creator_user_id and skill_name are required"
                )

            skill = await skills_service.get_public_skill(creator_user_id, skill_name)

            if not skill:
                return error_envelope("not_found", "Skill not found")

            return JSONResponse(
                {"type": "skill", "skill": skill},
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(
                f"Failed to get public skill '{skill_name}' "
                f"by creator {creator_user_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to get public skill. Please try again."
            )

    @staticmethod
    async def handle_create_skill(
        user_id: str,
        skill_name: str,
        description: str,
        instruction: str,
        visibility: str = "private",
    ) -> JSONResponse:
        """Handle create skill request.

        Validates inputs, checks for duplicate skill_name, and creates the skill.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: Unique identifier for the skill
            description: Brief summary (max 200 chars)
            instruction: Detailed procedure (max 40000 chars)
            visibility: "public" or "private" (default "private")

        Returns:
            JSONResponse with:
            - type: "skill_created" and skill data on success
            - type: "validation_error" with field errors on validation failure
            - type: "skill_exists" if skill already exists

        """
        try:
            skill = await skills_service.create_skill(
                user_id=user_id,
                skill_name=skill_name,
                description=description,
                instruction=instruction or "",
                created_by="user",
                visibility=visibility,
            )

            return JSONResponse(
                {
                    "type": "skill_created",
                    "success": True,
                    "skill": skill,
                    "message": f"Skill '{skill_name}' created successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            error_data = e.args[0] if e.args else {}

            # Handle skill_exists error
            if (
                isinstance(error_data, dict)
                and error_data.get("type") == "skill_exists"
            ):
                return error_envelope(
                    "skill_exists",
                    error_data.get(
                        "skill_name", f"Skill '{skill_name}' already exists"
                    ),
                )

            # Handle validation errors
            if isinstance(error_data, dict):
                return error_envelope(
                    "validation_error", "Validation failed", {"fields": error_data}
                )

            # Handle string error
            return error_envelope("validation_error", str(e))

        except Exception as e:
            logger.error(
                f"Failed to create skill '{skill_name}' for user {user_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to create skill. Please try again."
            )

    @staticmethod
    async def handle_update_skill(
        user_id: str,
        skill_name: str,
        description: str,
        instruction: Optional[str] = None,
        visibility: Optional[str] = None,
    ) -> JSONResponse:
        """Handle update skill request.

        Validates inputs, checks skill exists, and updates the skill.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The skill to update
            description: New description (max 200 chars)
            instruction: New instruction (max 40000 chars)
            visibility: Optional new visibility ("public" or "private")

        Returns:
            JSONResponse with:
            - type: "skill_updated" and skill data on success
            - type: "validation_error" with field errors on validation failure
            - type: "skill_not_found" if skill doesn't exist

        """
        try:
            skill = await skills_service.update_skill(
                user_id=user_id,
                skill_name=skill_name,
                description=description,
                instruction=instruction,
                visibility=visibility,
            )

            return JSONResponse(
                {
                    "type": "skill_updated",
                    "success": True,
                    "skill": skill,
                    "message": f"Skill '{skill_name}' updated successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            error_data = e.args[0] if e.args else {}

            # Handle access_denied error (system skill guard)
            if (
                isinstance(error_data, dict)
                and error_data.get("type") == "access_denied"
            ):
                return error_envelope(
                    "skill_error", error_data.get("error", "Access denied")
                )

            # Handle skill_not_found error
            if (
                isinstance(error_data, dict)
                and error_data.get("type") == "skill_not_found"
            ):
                return error_envelope(
                    "not_found",
                    error_data.get("skill_name", f"Skill '{skill_name}' not found"),
                )

            # Handle validation errors
            if isinstance(error_data, dict):
                return error_envelope(
                    "validation_error", "Validation failed", {"fields": error_data}
                )

            # Handle string error
            return error_envelope("validation_error", str(e))

        except Exception as e:
            logger.error(
                f"Failed to update skill '{skill_name}' for user {user_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to update skill. Please try again."
            )

    @staticmethod
    async def handle_delete_skill(user_id: str, skill_name: str) -> JSONResponse:
        """Handle delete skill request.

        Deletes the skill and returns success.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill to delete

        Returns:
            JSONResponse with:
            - type: "skill_deleted" on success

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")

            await skills_service.delete_skill(user_id, skill_name)

            return JSONResponse(
                {
                    "type": "skill_deleted",
                    "success": True,
                    "message": f"Skill '{skill_name}' deleted successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            error_data = e.args[0] if e.args else {}
            if (
                isinstance(error_data, dict)
                and error_data.get("type") == "access_denied"
            ):
                return error_envelope(
                    "skill_error", error_data.get("error", "Access denied")
                )
            return error_envelope("validation_error", str(e))

        except Exception as e:
            logger.error(
                f"Failed to delete skill '{skill_name}' for user {user_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to delete skill. Please try again."
            )

    # =========================================================================
    # Download URL Refresh Handler
    # =========================================================================

    @staticmethod
    async def handle_refresh_download_url(s3_key: str, user_id: str) -> JSONResponse:
        """Handle presigned URL refresh for previously generated download files.

        Generates a fresh presigned GET URL for an S3 object so that users
        can download files from old conversations where the original URL expired.

        Args:
            s3_key: The S3 object key (e.g. artifact/{user_id}/{session_id}/{filename})
            user_id: The authenticated user ID from JWT token

        Returns:
            JSONResponse with a fresh presigned URL
        """
        try:
            if not s3_key or not s3_key.strip():
                return error_envelope("validation_error", "s3_key is required")

            # Only allow refreshing artifact/ prefixed keys for security
            if not s3_key.startswith("artifact/"):
                return error_envelope("validation_error", "Invalid s3_key prefix")

            # Verify the requesting user owns this artifact
            parts = s3_key.split("/")
            if s3_key.startswith("artifact/") and (
                len(parts) < 3 or parts[1] != user_id
            ):
                return error_envelope("access_denied", "Access denied")

            import boto3
            from botocore.config import Config as BotoConfig
            from config import REGION, S3_BUCKET

            s3_client = boto3.client(
                "s3",
                region_name=REGION,
                config=BotoConfig(s3={"addressing_style": "virtual"}),
                endpoint_url=f"https://s3.{REGION}.amazonaws.com",
            )
            url = s3_client.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": s3_key},
                ExpiresIn=3600,
            )

            return JSONResponse(
                {"type": "refresh_url_success", "url": url},
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(f"Failed to refresh download URL for key {s3_key}: {e}")
            return error_envelope("internal_error", "Failed to generate download URL")

    @staticmethod
    async def handle_get_file_download_url(
        user_id: str, project_id: str, file_id: str
    ) -> JSONResponse:
        """Generate a presigned download URL for an uploaded project file.

        Looks up the file record, verifies ownership, and returns a
        time-limited presigned GET URL for direct S3 download.

        Args:
            user_id: The authenticated user ID from JWT token
            project_id: The project that owns the file
            file_id: The file to download

        Returns:
            JSONResponse with presigned download URL and filename
        """
        try:
            if not all([project_id, file_id]):
                return error_envelope(
                    "validation_error", "project_id and file_id are required"
                )

            file = await project_service.get_file_for_user(project_id, file_id, user_id)
            if not file:
                return error_envelope("not_found", "File not found")

            if file.get("status") not in ("ready", "indexed", "processing"):
                return error_envelope(
                    "file_not_ready", "File is not available for download"
                )

            url = project_file_manager.generate_download_url(
                s3_key=file["s3_key"],
                filename=file["filename"],
            )

            return JSONResponse(
                {
                    "type": "file_download_url",
                    "url": url,
                    "filename": file["filename"],
                },
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(
                f"Failed to generate download URL for file {file_id} "
                f"in project {project_id}: {e}"
            )
            return error_envelope("internal_error", "Failed to generate download URL")

    @staticmethod
    async def handle_upload_template(
        user_id: str, skill_name: str, filename: str, content: bytes
    ) -> JSONResponse:
        """Handle template file upload request.

        Uploads a template file to the skill's templates/ subfolder in S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill
            filename: The template filename
            content: The raw file content as bytes

        Returns:
            JSONResponse with:
            - type: "template_uploaded" on success

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")
            if not filename:
                return error_envelope("validation_error", "filename is required")

            await skills_service.upload_template(user_id, skill_name, filename, content)

            return JSONResponse(
                {
                    "type": "template_uploaded",
                    "success": True,
                    "message": f"Template '{filename}' uploaded successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except Exception as e:
            logger.error(
                f"Failed to upload template '{filename}' for skill "
                f"'{skill_name}' (user: {user_id}): {e}"
            )
            return error_envelope(
                "internal_error", "Failed to upload template. Please try again."
            )

    @staticmethod
    async def handle_delete_template(
        user_id: str, skill_name: str, filename: str
    ) -> JSONResponse:
        """Handle template file deletion request.

        Deletes a template file from the skill's templates/ subfolder in S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill
            filename: The template filename to delete

        Returns:
            JSONResponse with:
            - type: "template_deleted" on success

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")
            if not filename:
                return error_envelope("validation_error", "filename is required")

            await skills_service.delete_template(user_id, skill_name, filename)

            return JSONResponse(
                {
                    "type": "template_deleted",
                    "success": True,
                    "message": f"Template '{filename}' deleted successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except Exception as e:
            logger.error(
                f"Failed to delete template '{filename}' for skill "
                f"'{skill_name}' (user: {user_id}): {e}"
            )
            return error_envelope(
                "internal_error", "Failed to delete template. Please try again."
            )

    @staticmethod
    async def handle_delete_script(
        user_id: str, skill_name: str, filename: str
    ) -> JSONResponse:
        """Handle script file deletion request.

        Deletes a script file from the skill's scripts/ subfolder in S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill
            filename: The script filename to delete

        Returns:
            JSONResponse with:
            - type: "script_deleted" on success
        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")
            if not filename:
                return error_envelope("validation_error", "filename is required")

            await skills_service.delete_script(user_id, skill_name, filename)

            return JSONResponse(
                {
                    "type": "script_deleted",
                    "success": True,
                    "message": f"Script '{filename}' deleted successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except Exception as e:
            logger.error(
                f"Failed to delete script '{filename}' for skill "
                f"'{skill_name}' (user: {user_id}): {e}"
            )
            return error_envelope(
                "internal_error", "Failed to delete script. Please try again."
            )

    @staticmethod
    async def handle_upload_reference(
        user_id: str, skill_name: str, filename: str, content: str
    ) -> JSONResponse:
        """Handle reference file upload request.

        Uploads a reference .md file to the skill's references/ subfolder in S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill
            filename: The reference filename (must end with .md)
            content: The text content of the reference file

        Returns:
            JSONResponse with:
            - type: "reference_uploaded" on success

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")
            if not filename:
                return error_envelope("validation_error", "filename is required")

            await skills_service.upload_reference(
                user_id, skill_name, filename, content
            )

            return JSONResponse(
                {
                    "type": "reference_uploaded",
                    "success": True,
                    "message": f"Reference '{filename}' uploaded successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except Exception as e:
            logger.error(
                f"Failed to upload reference '{filename}' for skill "
                f"'{skill_name}' (user: {user_id}): {e}"
            )
            return error_envelope(
                "internal_error", "Failed to upload reference. Please try again."
            )

    @staticmethod
    async def handle_delete_reference(
        user_id: str, skill_name: str, filename: str
    ) -> JSONResponse:
        """Handle reference file deletion request.

        Deletes a reference file from the skill's references/ subfolder in S3.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The name of the skill
            filename: The reference filename to delete

        Returns:
            JSONResponse with:
            - type: "reference_deleted" on success

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")
            if not filename:
                return error_envelope("validation_error", "filename is required")

            await skills_service.delete_reference(user_id, skill_name, filename)

            return JSONResponse(
                {
                    "type": "reference_deleted",
                    "success": True,
                    "message": f"Reference '{filename}' deleted successfully",
                },
                headers=CORS_HEADERS,
            )

        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except Exception as e:
            logger.error(
                f"Failed to delete reference '{filename}' for skill "
                f"'{skill_name}' (user: {user_id}): {e}"
            )
            return error_envelope(
                "internal_error", "Failed to delete reference. Please try again."
            )

    @staticmethod
    async def handle_toggle_skill(
        user_id: str, skill_name: str, disabled: bool
    ) -> JSONResponse:
        """Handle skill toggle (enable/disable) request.

        Args:
            user_id: The authenticated user ID from JWT token
            skill_name: The skill name to toggle
            disabled: True to disable, False to enable

        Returns:
            JSONResponse with toggle result

        """
        try:
            if not skill_name:
                return error_envelope("validation_error", "skill_name is required")

            await skills_service.toggle_skill(user_id, skill_name, disabled)

            return JSONResponse(
                {"type": "skill_toggle", "success": True},
                headers=CORS_HEADERS,
            )

        except Exception as e:
            logger.error(
                f"Failed to toggle skill '{skill_name}' for user {user_id}: {e}"
            )
            return error_envelope(
                "internal_error", "Failed to toggle skill. Please try again."
            )

    # =========================================================================
    # Projects Handlers
    # =========================================================================

    @staticmethod
    async def handle_create_project(
        user_id: str, name: str, description: str
    ) -> JSONResponse:
        try:
            if not name or not name.strip():
                return error_envelope("validation_error", "name is required")
            project = await project_service.create_project(
                user_id=user_id,
                name=name.strip(),
                description=(description or "").strip(),
            )
            return JSONResponse(
                {"type": "project_created", "project": project}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to create project for user {user_id}: {e}")
            return error_envelope("internal_error", "Failed to create project")

    @staticmethod
    async def handle_list_projects(
        user_id: str, cursor: Optional[Dict[str, Any]]
    ) -> JSONResponse:
        try:
            result = await project_service.list_projects(user_id=user_id, cursor=cursor)
            return JSONResponse(
                {"type": "projects_list", **result}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to list projects for user {user_id}: {e}")
            return error_envelope("internal_error", "Failed to list projects")

    @staticmethod
    async def handle_get_project(user_id: str, project_id: str) -> JSONResponse:
        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")
            return JSONResponse(
                {"type": "project", "project": project}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to get project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to get project")

    @staticmethod
    async def handle_update_project(
        user_id: str,
        project_id: str,
        name: Optional[str],
        description: Optional[str],
    ) -> JSONResponse:
        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            project = await project_service.update_project(
                project_id=project_id,
                user_id=user_id,
                name=name.strip() if name else None,
                description=description.strip() if description is not None else None,
            )
            if not project:
                return error_envelope("not_found", "Project not found")
            return JSONResponse(
                {"type": "project_updated", "project": project}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to update project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to update project")

    @staticmethod
    async def handle_delete_project(user_id: str, project_id: str) -> JSONResponse:
        import asyncio

        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            async def _cascade_delete():
                try:
                    files = await project_service.list_all_project_files(project_id)
                    if files:
                        key_pairs = [
                            {
                                "s3_key": f["s3_key"],
                                "metadata_s3_key": f["metadata_s3_key"],
                            }
                            for f in files
                        ]
                        await asyncio.to_thread(
                            project_file_manager.delete_objects_batch, key_pairs
                        )
                        for f in files:
                            await project_service.delete_file_record(
                                project_id, f["file_id"]
                            )
                    try:
                        await asyncio.to_thread(project_kb_service.start_ingestion_job)
                    except Exception as e:
                        logger.warning(
                            f"KB sync after project delete failed (non-fatal): {e}"
                        )
                    await project_service.delete_project(project_id)
                    await chat_history_service.clear_project_bindings_for_project(
                        project_id, user_id
                    )
                    logger.debug(f"Cascade delete complete for project {project_id}")
                except Exception as e:
                    logger.error(f"Cascade delete failed for project {project_id}: {e}")

            asyncio.create_task(_cascade_delete())
            return JSONResponse(
                {"type": "project_deleted", "success": True}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to delete project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to delete project")

    @staticmethod
    async def handle_get_upload_url(
        user_id: str,
        project_id: str,
        filename: str,
        content_type: str,
        size_bytes: int,
    ) -> JSONResponse:
        import uuid as _uuid

        try:
            if not all([project_id, filename, content_type]):
                return error_envelope(
                    "validation_error",
                    "project_id, filename, and content_type are required",
                )

            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            from project_service import MAX_FILES_PER_PROJECT as _MAX

            if project.get("file_count", 0) >= _MAX:
                return error_envelope(
                    "limit_exceeded",
                    f"Project has reached the maximum of {_MAX} files",
                )

            try:
                project_file_manager.validate_file(
                    filename, content_type, size_bytes or 0
                )
            except ValueError as ve:
                return error_envelope("validation_error", str(ve))

            duplicate = await project_service.check_filename_exists(
                project_id, filename
            )
            if duplicate:
                return error_envelope(
                    "file_already_exists",
                    f"A file named '{filename}' already exists in this project",
                )

            file_id = str(_uuid.uuid4())
            from project_service import file_category as _file_category

            _category = _file_category(filename)
            metadata_s3_key_placeholder = ""  # written during confirm
            s3_info = project_file_manager.generate_upload_url(
                user_id=user_id,
                project_id=project_id,
                file_id=file_id,
                filename=filename,
                content_type=content_type,
                category=_category,
            )
            await project_service.register_file_upload(
                project_id=project_id,
                user_id=user_id,
                file_id=file_id,
                filename=filename,
                s3_key=s3_info["s3_key"],
                metadata_s3_key=project_file_manager.build_metadata_s3_key(
                    s3_info["s3_key"]
                ),
                content_type=content_type,
                size_bytes=size_bytes or 0,
            )
            return JSONResponse(
                {
                    "type": "upload_url",
                    "upload_url": s3_info["upload_url"],
                    "file_id": file_id,
                    "s3_key": s3_info["s3_key"],
                },
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"Failed to generate upload URL for project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to generate upload URL")

    @staticmethod
    async def handle_confirm_file_upload(
        user_id: str, project_id: str, file_id: str
    ) -> JSONResponse:
        try:
            if not all([project_id, file_id]):
                return error_envelope(
                    "validation_error", "project_id and file_id are required"
                )

            file = await project_service.get_file_for_user(project_id, file_id, user_id)
            if not file:
                return error_envelope("not_found", "File record not found")

            if not await asyncio.to_thread(
                project_file_manager.object_exists, file["s3_key"]
            ):
                return error_envelope(
                    "upload_incomplete", "File not found in S3 — upload may have failed"
                )

            is_data_file = file.get("category") == "data"

            if is_data_file:
                # Structured data files go to S3 only — no KB ingestion
                updated_file = await project_service.update_file_status(
                    project_id=project_id,
                    file_id=file_id,
                    status="ready",
                )
            else:
                # Document files: write metadata sidecar and trigger KB ingestion
                await asyncio.to_thread(
                    project_file_manager.write_metadata_sidecar,
                    s3_key=file["s3_key"],
                    project_id=project_id,
                    user_id=user_id,
                    file_id=file_id,
                    filename=file["filename"],
                )

                job_id = ""
                try:
                    job_id = await asyncio.to_thread(
                        project_kb_service.start_ingestion_job
                    )
                except Exception as e:
                    logger.warning(f"KB ingestion job failed (non-fatal): {e}")

                updated_file = await project_service.update_file_status(
                    project_id=project_id,
                    file_id=file_id,
                    status="processing" if job_id else "indexed",
                    ingestion_job_id=job_id or None,
                )

            await project_service.increment_file_count(project_id, delta=1)

            return JSONResponse(
                {"type": "file_upload_confirmed", "file": updated_file},
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(
                f"Failed to confirm upload for file {file_id} in project {project_id}: {e}"
            )
            await project_service.update_file_status(project_id, file_id, "failed")
            return error_envelope("internal_error", "Failed to confirm file upload")

    @staticmethod
    async def handle_add_artifact_to_project(
        user_id: str,
        project_id: str,
        s3_key: str,
        filename: str,
    ) -> JSONResponse:
        """Copy a generated artifact into a project, register it, and trigger KB ingestion if applicable."""
        import uuid as _uuid
        from config import S3_BUCKET
        from project_file_manager import STRUCTURED_EXTENSIONS, DOCUMENT_EXTENSIONS
        from project_service import (
            file_category as _file_category,
            MAX_FILES_PER_PROJECT as _MAX,
        )

        _EXTENSION_TO_MIME = {
            ".pdf": "application/pdf",
            ".txt": "text/plain",
            ".md": "text/markdown",
            ".html": "text/html",
            ".htm": "text/html",
            ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        }

        try:
            if not all([project_id, s3_key, filename]):
                return error_envelope(
                    "validation_error", "project_id, s3_key, and filename are required"
                )

            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            if project.get("file_count", 0) >= _MAX:
                return error_envelope(
                    "project_file_limit_reached",
                    f"Project has reached the maximum of {_MAX} files",
                )

            # Verify the artifact belongs to the requesting user
            if not s3_key.startswith(f"artifact/{user_id}/"):
                return error_envelope(
                    "forbidden", "Artifact does not belong to this user"
                )

            ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
            if ext not in STRUCTURED_EXTENSIONS and ext not in DOCUMENT_EXTENSIONS:
                return error_envelope(
                    "invalid_file_type",
                    f"File type '{ext}' is not supported in projects",
                )

            duplicate = await project_service.check_filename_exists(
                project_id, filename
            )
            if duplicate:
                return error_envelope(
                    "file_already_exists",
                    f"A file named '{filename}' already exists in this project",
                )

            file_id = str(_uuid.uuid4())
            _category = _file_category(filename)
            content_type = _EXTENSION_TO_MIME.get(ext, "application/octet-stream")

            dest_key, size_bytes = await asyncio.to_thread(
                project_file_manager.copy_from_artifact,
                source_bucket=S3_BUCKET,
                source_key=s3_key,
                user_id=user_id,
                project_id=project_id,
                file_id=file_id,
                filename=filename,
                category=_category,
            )

            await project_service.register_file_upload(
                project_id=project_id,
                user_id=user_id,
                file_id=file_id,
                filename=filename,
                s3_key=dest_key,
                metadata_s3_key=project_file_manager.build_metadata_s3_key(dest_key),
                content_type=content_type,
                size_bytes=size_bytes,
            )

            is_data_file = _category == "data"
            if is_data_file:
                updated_file = await project_service.update_file_status(
                    project_id=project_id, file_id=file_id, status="ready"
                )
            else:
                await asyncio.to_thread(
                    project_file_manager.write_metadata_sidecar,
                    s3_key=dest_key,
                    project_id=project_id,
                    user_id=user_id,
                    file_id=file_id,
                    filename=filename,
                )
                job_id = ""
                try:
                    job_id = await asyncio.to_thread(
                        project_kb_service.start_ingestion_job
                    )
                except Exception as e:
                    logger.warning(f"KB ingestion job failed (non-fatal): {e}")

                updated_file = await project_service.update_file_status(
                    project_id=project_id,
                    file_id=file_id,
                    status="processing" if job_id else "indexed",
                    ingestion_job_id=job_id or None,
                )

            await project_service.increment_file_count(project_id, delta=1)

            return JSONResponse(
                {"type": "artifact_added_to_project", "file": updated_file},
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"Failed to add artifact to project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to add artifact to project")

    @staticmethod
    async def handle_list_project_files(
        user_id: str, project_id: str, cursor: Optional[Dict[str, Any]]
    ) -> JSONResponse:
        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")
            result = await project_service.list_project_files(
                project_id=project_id, cursor=cursor
            )

            # Resolve any files still marked "processing" by checking Bedrock job status.
            # Files with no ingestion_job_id (ConflictException during upload) fall back
            # to the latest job — all processing files share the same KB-wide ingestion.
            latest_status = None  # lazily fetched once if needed
            updated_files = []
            for f in result["files"]:
                if f.get("status") == "processing":
                    if f.get("ingestion_job_id"):
                        bedrock_status = await asyncio.to_thread(
                            project_kb_service.get_ingestion_job_status,
                            f["ingestion_job_id"],
                        )
                    else:
                        if latest_status is None:
                            latest_status = await asyncio.to_thread(
                                project_kb_service.get_latest_ingestion_job_status
                            )
                        bedrock_status = latest_status

                    if bedrock_status == "COMPLETE":
                        f = (
                            await project_service.update_file_status(
                                project_id=f["project_id"],
                                file_id=f["file_id"],
                                status="indexed",
                            )
                            or f
                        )
                    elif bedrock_status in ("FAILED", "STOPPED"):
                        f = (
                            await project_service.update_file_status(
                                project_id=f["project_id"],
                                file_id=f["file_id"],
                                status="failed",
                            )
                            or f
                        )
                updated_files.append(f)
            result["files"] = updated_files

            return JSONResponse(
                {"type": "project_files_list", **result}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to list files for project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to list project files")

    @staticmethod
    async def handle_delete_project_file(
        user_id: str, project_id: str, file_id: str
    ) -> JSONResponse:
        try:
            if not all([project_id, file_id]):
                return error_envelope(
                    "validation_error", "project_id and file_id are required"
                )
            file = await project_service.get_file_for_user(project_id, file_id, user_id)
            if not file:
                return error_envelope("not_found", "File not found")

            await asyncio.to_thread(
                project_file_manager.delete_file_objects,
                s3_key=file["s3_key"],
                metadata_s3_key=file["metadata_s3_key"],
            )
            await project_service.delete_file_record(project_id, file_id)
            await project_service.increment_file_count(project_id, delta=-1)

            try:
                await asyncio.to_thread(project_kb_service.start_ingestion_job)
            except Exception as e:
                logger.warning(f"KB sync after file delete failed (non-fatal): {e}")

            return JSONResponse(
                {"type": "file_deleted", "success": True}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(
                f"Failed to delete file {file_id} from project {project_id}: {e}"
            )
            return error_envelope("internal_error", "Failed to delete file")

    @staticmethod
    async def handle_bind_project(
        user_id: str, session_id: str, project_id: str
    ) -> JSONResponse:
        try:
            if not all([session_id, project_id]):
                return error_envelope(
                    "validation_error", "session_id and project_id are required"
                )
            session = await chat_history_service.get_session(session_id)
            if not session or session.get("user_id") != user_id:
                return error_envelope("not_found", "Session not found")
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            await chat_history_service.bind_project(session_id, project_id)
            return JSONResponse(
                {"type": "project_bound", "success": True}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(
                f"Failed to bind project {project_id} to session {session_id}: {e}"
            )
            return error_envelope("internal_error", "Failed to bind project")

    @staticmethod
    async def handle_unbind_project(user_id: str, session_id: str) -> JSONResponse:
        try:
            if not session_id:
                return error_envelope("validation_error", "session_id is required")
            session = await chat_history_service.get_session(session_id)
            if not session or session.get("user_id") != user_id:
                return error_envelope("not_found", "Session not found")

            await chat_history_service.unbind_project(session_id)
            return JSONResponse(
                {"type": "project_unbound", "success": True}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to unbind project from session {session_id}: {e}")
            return error_envelope("internal_error", "Failed to unbind project")

    @staticmethod
    async def handle_get_session_project(user_id: str, session_id: str) -> JSONResponse:
        try:
            if not session_id:
                return error_envelope("validation_error", "session_id is required")
            session = await chat_history_service.get_session(session_id)
            if not session or session.get("user_id") != user_id:
                return error_envelope("not_found", "Session not found")

            project_id = session.get("project_id")
            if not project_id:
                return JSONResponse(
                    {"type": "session_project", "project": None}, headers=CORS_HEADERS
                )
            project = await project_service.get_project_for_user(project_id, user_id)
            return JSONResponse(
                {"type": "session_project", "project": project}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(f"Failed to get project for session {session_id}: {e}")
            return error_envelope("internal_error", "Failed to get session project")

    @staticmethod
    async def handle_list_project_sessions(
        user_id: str, project_id: str
    ) -> JSONResponse:
        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            sessions = await chat_history_service.get_sessions_for_project(
                project_id=project_id, user_id=user_id
            )
            return JSONResponse(
                {"type": "project_sessions_list", "sessions": sessions},
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"Failed to list sessions for project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to list project sessions")

    @staticmethod
    async def handle_list_project_canvases(
        user_id: str, project_id: str
    ) -> JSONResponse:
        import asyncio
        import boto3
        from config import REGION, PROJECT_CANVASES_TABLE

        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            if not PROJECT_CANVASES_TABLE:
                return JSONResponse(
                    {"type": "project_canvases_list", "canvases": []},
                    headers=CORS_HEADERS,
                )

            dynamodb = boto3.resource("dynamodb", region_name=REGION)
            table = dynamodb.Table(PROJECT_CANVASES_TABLE)
            items = []
            query_params = {
                "KeyConditionExpression": "project_id = :pid",
                "ExpressionAttributeValues": {":pid": project_id},
                "ProjectionExpression": "canvas_id, #n, #t, saved_at",
                "ExpressionAttributeNames": {"#n": "name", "#t": "type"},
            }
            while True:
                resp = await asyncio.to_thread(table.query, **query_params)
                for item in resp.get("Items", []):
                    items.append(
                        {
                            "canvas_id": item["canvas_id"],
                            "name": item.get("name", ""),
                            "type": item.get("type", "document"),
                            "saved_at": item.get("saved_at", ""),
                        }
                    )
                last_key = resp.get("LastEvaluatedKey")
                if not last_key:
                    break
                query_params["ExclusiveStartKey"] = last_key

            items.sort(key=lambda x: x.get("saved_at", ""))
            return JSONResponse(
                {"type": "project_canvases_list", "canvases": items},
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"Failed to list canvases for project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to list project canvases")

    @staticmethod
    async def handle_delete_project_canvas(
        user_id: str, project_id: str, canvas_id: str
    ) -> JSONResponse:
        import asyncio
        import boto3
        from botocore.exceptions import ClientError
        from config import REGION, PROJECT_CANVASES_TABLE, PROJECTS_S3_BUCKET

        try:
            if not all([project_id, canvas_id]):
                return error_envelope(
                    "validation_error", "project_id and canvas_id are required"
                )
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            if not PROJECT_CANVASES_TABLE or not PROJECTS_S3_BUCKET:
                return error_envelope("internal_error", "Canvas storage not configured")

            dynamodb = boto3.resource("dynamodb", region_name=REGION)
            table = dynamodb.Table(PROJECT_CANVASES_TABLE)
            resp = await asyncio.to_thread(
                table.delete_item,
                Key={"project_id": project_id, "canvas_id": canvas_id},
                ReturnValues="ALL_OLD",
            )
            deleted_item = resp.get("Attributes")
            if not deleted_item:
                return error_envelope("not_found", "Canvas not found")

            s3_key = deleted_item.get("s3_key", f"canvases/{project_id}/{canvas_id}")
            s3 = boto3.client("s3", region_name=REGION)
            try:
                await asyncio.to_thread(
                    s3.delete_object, Bucket=PROJECTS_S3_BUCKET, Key=s3_key
                )
            except ClientError as e:
                logger.warning(
                    f"S3 delete failed for canvas {canvas_id} (non-fatal): {e}"
                )

            return JSONResponse(
                {"type": "canvas_deleted", "success": True}, headers=CORS_HEADERS
            )
        except Exception as e:
            logger.error(
                f"Failed to delete canvas {canvas_id} from project {project_id}: {e}"
            )
            return error_envelope("internal_error", "Failed to delete canvas")

    @staticmethod
    async def handle_list_project_memories(
        user_id: str, project_id: str
    ) -> JSONResponse:
        import asyncio
        from config import project_memory_store

        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            if not project_memory_store:
                return JSONResponse(
                    {"type": "project_memories_list", "facts": [], "preferences": []},
                    headers=CORS_HEADERS,
                )

            actor_id = _composite_actor_id(user_id, project_id)
            memory_id = project_memory_store.memory_id
            client = project_memory_store.client

            async def _list_all(namespace: str) -> list[dict]:
                """Page through ListMemoryRecords until exhausted."""
                records = []
                next_token = None
                try:
                    while True:
                        kwargs = {
                            "memoryId": memory_id,
                            "namespace": namespace,
                            "maxResults": 100,
                        }
                        if next_token:
                            kwargs["nextToken"] = next_token
                        resp = await asyncio.to_thread(
                            client.list_memory_records, **kwargs
                        )
                        for r in resp.get("memoryRecordSummaries", []):
                            content = r.get("content", {})
                            text = (
                                content.get("text", "")
                                if isinstance(content, dict)
                                else str(content)
                            )
                            if text:
                                records.append(
                                    {
                                        "memory_record_id": r.get("memoryRecordId"),
                                        "content": text,
                                    }
                                )
                        next_token = resp.get("nextToken")
                        if not next_token:
                            break
                except Exception as e:
                    logger.warning(f"Memory list failed for namespace {namespace}: {e}")
                return records

            facts, preferences = await asyncio.gather(
                _list_all(f"projects/{actor_id}"),
                _list_all(f"preferences/{actor_id}"),
            )

            return JSONResponse(
                {
                    "type": "project_memories_list",
                    "facts": facts,
                    "preferences": preferences,
                },
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"Failed to list memories for project {project_id}: {e}")
            return error_envelope("internal_error", "Failed to list project memories")

    @staticmethod
    async def handle_delete_project_memory(
        user_id: str, project_id: str, memory_record_id: str
    ) -> JSONResponse:
        import asyncio
        from config import project_memory_store

        try:
            if not project_id:
                return error_envelope("validation_error", "project_id is required")
            if not memory_record_id:
                return error_envelope(
                    "validation_error", "memory_record_id is required"
                )

            project = await project_service.get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope("not_found", "Project not found")

            if not project_memory_store:
                return error_envelope("not_found", "Memory store not configured")

            memory_id = project_memory_store.memory_id
            client = project_memory_store.client

            # Verify the memory record belongs to this user's project namespace
            actor_id = _composite_actor_id(user_id, project_id)
            valid_namespaces = {f"projects/{actor_id}", f"preferences/{actor_id}"}
            try:
                record = await asyncio.to_thread(
                    client.get_memory_record,
                    memoryId=memory_id,
                    memoryRecordId=memory_record_id,
                )
                record_ns = record.get("namespace", "")
                if record_ns not in valid_namespaces:
                    return error_envelope("access_denied", "Access denied")
            except client.exceptions.ResourceNotFoundException:
                return error_envelope("not_found", "Memory record not found")

            await asyncio.to_thread(
                client.delete_memory_record,
                memoryId=memory_id,
                memoryRecordId=memory_record_id,
            )

            return JSONResponse(
                {
                    "type": "project_memory_deleted",
                    "memory_record_id": memory_record_id,
                },
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"Failed to delete memory record {memory_record_id}: {e}")
            return error_envelope("internal_error", "Failed to delete memory record")

    # =========================================================================
    # Scheduled Task Handlers
    # =========================================================================

    @staticmethod
    async def _get_task_service():
        from scheduled_task_service import scheduled_task_service
        return scheduled_task_service

    @staticmethod
    async def handle_create_scheduled_task(
        user_id: str,
        name: str,
        prompt: str,
        schedule_expression: str,
        timezone_str: str = "UTC",
        skills: Optional[list] = None,
    ) -> JSONResponse:
        try:
            if not name or not name.strip():
                return error_envelope("validation_error", "name is required")
            if not prompt or not prompt.strip():
                return error_envelope("validation_error", "prompt is required")
            if not schedule_expression:
                return error_envelope(
                    "validation_error", "schedule_expression is required"
                )
            svc = await RequestHandlers._get_task_service()
            job = await svc.create_job(
                user_id=user_id,
                name=name,
                prompt=prompt,
                schedule_expression=schedule_expression,
                timezone_str=timezone_str,
                skills=skills,
            )
            return JSONResponse(
                {"type": "scheduled_task_created", "job": job}, headers=CORS_HEADERS
            )
        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except ClientError as e:
            logger.error("AWS error creating scheduled task: %s", e)
            return error_envelope("aws_error", f"Failed to create scheduled task: {e.response['Error']['Message']}")

    @staticmethod
    async def handle_list_scheduled_tasks(
        user_id: str, limit: int = 50, cursor=None
    ) -> JSONResponse:
        try:
            svc = await RequestHandlers._get_task_service()
            result = await svc.list_jobs(user_id=user_id, limit=limit, cursor=cursor)
            return JSONResponse(
                {"type": "scheduled_tasks_list", **result}, headers=CORS_HEADERS
            )
        except ClientError as e:
            logger.error("AWS error listing scheduled tasks: %s", e)
            return error_envelope("aws_error", "Failed to list scheduled tasks")

    @staticmethod
    async def handle_get_scheduled_task(user_id: str, job_id: str) -> JSONResponse:
        try:
            if not job_id:
                return error_envelope("validation_error", "job_id is required")
            svc = await RequestHandlers._get_task_service()
            job = await svc.get_job(user_id, job_id)
            if not job:
                return error_envelope("not_found", "Scheduled task not found")
            return JSONResponse(
                {"type": "scheduled_task", "job": job}, headers=CORS_HEADERS
            )
        except ClientError as e:
            logger.error("AWS error getting scheduled task %s: %s", job_id, e)
            return error_envelope("aws_error", "Failed to get scheduled task")

    @staticmethod
    async def handle_update_scheduled_task(
        user_id: str,
        job_id: str,
        name=None,
        prompt=None,
        schedule_expression=None,
        timezone_str=None,
        skills=None,
    ) -> JSONResponse:
        try:
            if not job_id:
                return error_envelope("validation_error", "job_id is required")
            svc = await RequestHandlers._get_task_service()
            job = await svc.update_job(
                user_id=user_id,
                job_id=job_id,
                name=name,
                prompt=prompt,
                schedule_expression=schedule_expression,
                timezone_str=timezone_str,
                skills=skills,
            )
            if not job:
                return error_envelope("not_found", "Scheduled task not found")
            return JSONResponse(
                {"type": "scheduled_task_updated", "job": job}, headers=CORS_HEADERS
            )
        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except ClientError as e:
            logger.error("AWS error updating scheduled task %s: %s", job_id, e)
            return error_envelope("aws_error", f"Failed to update scheduled task: {e.response['Error']['Message']}")

    @staticmethod
    async def handle_delete_scheduled_task(user_id: str, job_id: str) -> JSONResponse:
        try:
            if not job_id:
                return error_envelope("validation_error", "job_id is required")
            svc = await RequestHandlers._get_task_service()
            deleted = await svc.delete_job(user_id, job_id)
            if not deleted:
                return error_envelope("not_found", "Scheduled task not found")
            return JSONResponse(
                {"type": "scheduled_task_deleted", "job_id": job_id},
                headers=CORS_HEADERS,
            )
        except ClientError as e:
            logger.error("AWS error deleting scheduled task %s: %s", job_id, e)
            return error_envelope("aws_error", "Failed to delete scheduled task")

    @staticmethod
    async def handle_toggle_scheduled_task(
        user_id: str, job_id: str, enabled: bool
    ) -> JSONResponse:
        try:
            if not job_id:
                return error_envelope("validation_error", "job_id is required")
            svc = await RequestHandlers._get_task_service()
            job = await svc.toggle_job(user_id, job_id, enabled)
            if not job:
                return error_envelope("not_found", "Scheduled task not found")
            return JSONResponse(
                {"type": "scheduled_task_toggled", "job": job}, headers=CORS_HEADERS
            )
        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except ClientError as e:
            logger.error("AWS error toggling scheduled task %s: %s", job_id, e)
            return error_envelope("aws_error", f"Failed to toggle scheduled task: {e.response['Error']['Message']}")

    @staticmethod
    async def handle_trigger_scheduled_task(user_id: str, job_id: str) -> JSONResponse:
        try:
            if not job_id:
                return error_envelope("validation_error", "job_id is required")
            svc = await RequestHandlers._get_task_service()
            triggered = await svc.trigger_job(user_id, job_id)
            if not triggered:
                return error_envelope("not_found", "Scheduled task not found")
            return JSONResponse(
                {"type": "scheduled_task_triggered", "job_id": job_id},
                headers=CORS_HEADERS,
            )
        except ClientError as e:
            logger.error("AWS error triggering scheduled task %s: %s", job_id, e)
            return error_envelope("aws_error", "Failed to trigger scheduled task")

    @staticmethod
    async def handle_list_task_executions(
        user_id: str, job_id: str, limit: int = 20, cursor=None
    ) -> JSONResponse:
        try:
            if not job_id:
                return error_envelope("validation_error", "job_id is required")
            svc = await RequestHandlers._get_task_service()
            result = await svc.list_executions(
                job_id=job_id, user_id=user_id, limit=limit, cursor=cursor,
            )
            return JSONResponse(
                {"type": "task_executions_list", **result}, headers=CORS_HEADERS
            )
        except ClientError as e:
            logger.error("AWS error listing executions for job %s: %s", job_id, e)
            return error_envelope("aws_error", "Failed to list executions")

    @staticmethod
    async def handle_get_task_execution(
        user_id: str, job_id: str, execution_id: str
    ) -> JSONResponse:
        try:
            if not job_id or not execution_id:
                return error_envelope(
                    "validation_error", "job_id and execution_id are required"
                )
            svc = await RequestHandlers._get_task_service()
            execution = await svc.get_execution(job_id, execution_id, user_id)
            if not execution:
                return error_envelope("not_found", "Execution not found")
            return JSONResponse(
                {"type": "task_execution", "execution": execution}, headers=CORS_HEADERS
            )
        except ClientError as e:
            logger.error("AWS error getting execution %s: %s", execution_id, e)
            return error_envelope("aws_error", "Failed to get execution")


# Global handlers instance
handlers = RequestHandlers()
