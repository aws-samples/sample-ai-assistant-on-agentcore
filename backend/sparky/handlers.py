import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi.responses import JSONResponse, StreamingResponse
from models import InvocationRequest
from agent_manager import agent_manager
from code_interpreter import code_interpreter_client
from chat_history_service import chat_history_service
from session_validator import (
    register_session,
    deregister_session,
    validate_session_ownership,
)
from utils import logger, extract_budget_level, error_envelope
from streaming import StreamingHandler, _active_streams
from browser import browser_client, BrowserToolError
from config import (
    boto_client,
    checkpointer,
    DEFAULT_MODEL_ID,
    validate_model_id,
    ALLOWED_MODELS,
)


# System prompt for summary generation
SUMMARY_SYSTEM_PROMPT = """You are a helpful assistant that generates very brief titles for chat conversations.
Your task is to create a concise title (maximum 10 words) that captures the essence of the user's message.
Return ONLY the title, nothing else. No quotes, no explanations, just the title."""


async def generate_summary_with_llm(message: str) -> Optional[str]:
    """
    Generate a brief summary using ChatBedrockConverse directly.
    Simple, no tools, no LangGraph - just a direct LLM call.
    """
    try:
        from langchain_aws import ChatBedrockConverse
        from langchain_core.messages import SystemMessage, HumanMessage

        # Create a simple model without thinking/tools
        llm = ChatBedrockConverse(
            model_id=DEFAULT_MODEL_ID,
            client=boto_client,
            max_tokens=100,
            temperature=0,
        )

        # Simple prompt
        messages = [
            SystemMessage(content=SUMMARY_SYSTEM_PROMPT),
            HumanMessage(content=f"Generate a title for this message: {message[:500]}"),
        ]

        response = await llm.ainvoke(messages)
        summary = response.content.strip()

        # Ensure summary is within word limit (10 words max)
        words = summary.split()
        if len(words) > 10:
            summary = " ".join(words[:10])

        return summary

    except Exception as e:
        logger.error(f"Failed to generate summary: {e}")
        return None


def extract_model_id(input_data: Dict[str, Any]) -> Optional[str]:
    """Extract model_id from input data.

    Args:
        input_data: The input dictionary from the request

    Returns:
        The model_id string if present, None otherwise
    """
    return input_data.get("model_id")


def slice_messages_to_turn(messages: List[Any], turn_index: int) -> List[Any]:
    """Slice a flat list of LangChain messages up to and including the specified turn.

    A "turn" is defined as one HumanMessage followed by all subsequent non-human
    messages until the next HumanMessage (or end of list). turn_index is zero-based.

    Args:
        messages: Flat list of LangChain messages.
        turn_index: Zero-based index of the turn to slice up to (inclusive).

    Returns:
        Messages from index 0 through the end of the specified turn.

    Raises:
        ValueError: If turn_index is out of bounds (>= number of turns or negative,
                     or the message list has no turns).
    """
    if turn_index < 0:
        raise ValueError(f"Turn index {turn_index} is negative")

    human_count = 0
    for i, msg in enumerate(messages):
        if hasattr(msg, "type") and msg.type == "human":
            if human_count == turn_index + 1:
                return messages[:i]
            human_count += 1

    if human_count <= turn_index:
        raise ValueError(
            f"Turn index {turn_index} exceeds available turns ({human_count})"
        )
    return list(messages)


class RequestHandlers:
    @staticmethod
    def handle_ping() -> JSONResponse:
        """Handle ping requests"""
        return JSONResponse(
            {"type": "pong", "message": "pong"},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    @staticmethod
    async def handle_delete_history(session_id: str, user_id: str) -> JSONResponse:
        """Handle deletion of chat history with cascading cleanup.

        Deletes the session from the Chat_History_Table and DynamoDB checkpointer.
        KB cleanup is handled by the DynamoDB Stream → EventBridge Pipe → SQS → Lambda pipeline.

        Args:
            session_id: The session ID (same as chat-history session_id)
            user_id: The authenticated user ID for actor_id in checkpointer config

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
                # Log but continue - idempotent behavior
                logger.error(
                    f"Error deleting session {session_id} from Chat_History_Table: {e}"
                )

            # Delete checkpoint data from the checkpointer store
            try:
                if hasattr(checkpointer, "adelete_thread"):
                    await checkpointer.adelete_thread(session_id)
                    logger.debug(f"Deleted checkpoints for session {session_id}")
            except Exception as e:
                logger.warning(
                    f"Checkpoint cleanup failed for session {session_id} (non-fatal): {e}"
                )

            # Note: KB cleanup is now handled by the DynamoDB Stream → EventBridge Pipe →
            # SQS → Lambda pipeline. No application-level KB delete publishing needed.

            # Evict from session authorization cache
            deregister_session(session_id, user_id)

            # Return success regardless of individual failures
            return JSONResponse(
                {"success": True, "message": "Session deleted successfully"},
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                },
            )

        except Exception as e:
            logger.error(f"Unexpected error in handle_delete_history: {e}")
            return error_envelope("internal_error", "An unexpected error occurred.")

    @staticmethod
    async def handle_create_session(
        user_id: str, proposed_session_id: str = None
    ) -> JSONResponse:
        """Handle create session requests.

        Uses the frontend-proposed session ID if provided and not already taken.
        Falls back to generating a new UUID on conflict.
        Starts tool loading in background and returns immediately.

        Args:
            user_id: The authenticated user ID from JWT token
            proposed_session_id: Session ID proposed by the frontend (from header)

        Returns:
            JSONResponse with session_id

        """
        import asyncio

        try:
            # Use the proposed session ID if it's a valid UUID and not already taken
            session_id = None
            if proposed_session_id:
                try:
                    # Validate it looks like a UUID
                    uuid.UUID(proposed_session_id)
                    # Check if it's already in use
                    exists = await chat_history_service.session_exists(
                        proposed_session_id
                    )
                    if not exists:
                        session_id = proposed_session_id
                        logger.debug(
                            f"Using frontend-proposed session ID: {session_id}"
                        )
                    else:
                        logger.debug(
                            f"Proposed session ID {proposed_session_id} already exists, generating new one"
                        )
                except (ValueError, AttributeError):
                    logger.debug(
                        "Invalid proposed session ID format, generating new one"
                    )

            if session_id is None:
                session_id = str(uuid.uuid4())
                logger.debug(f"Generated new session ID: {session_id}")

            # Register this session as owned by the user in memory so that
            # subsequent requests skip the DynamoDB ownership lookup.
            register_session(session_id, user_id)

            # Fire-and-forget: Build tools with preference reconciliation in background
            # Fresh reconciliation on each create_session (Req 4.1, 4.7, 5.7)
            async def load_tools_background():
                try:
                    await agent_manager.build_tools_with_reconciliation(user_id)
                    await (
                        agent_manager.get_agent()
                    )  # Create agent with reconciled tools
                    logger.debug(
                        f"Background tool reconciliation complete for session {session_id}"
                    )
                except Exception as e:
                    logger.error(f"Background tool reconciliation failed: {e}")

            asyncio.create_task(load_tools_background())

            async def init_ci_session_background():
                try:
                    await code_interpreter_client.get_or_create_session(
                        session_id, user_id=user_id
                    )
                    logger.debug(
                        f"Background CI session init complete for session {session_id}"
                    )
                except Exception as e:
                    logger.error(f"Background CI session init failed: {e}")

            asyncio.create_task(init_ci_session_background())

            return JSONResponse(
                {"type": "session_created", "session_id": session_id},
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                },
            )
        except Exception as e:
            logger.error(f"Failed to create session: {e}")
            return error_envelope("session_error", "Failed to create session.")

    @staticmethod
    async def handle_prepare(
        request: InvocationRequest, session_id: str, user_id: str
    ) -> JSONResponse:
        """Handle prepare requests.

        Accepts an optional `refresh` boolean parameter (default false).
        When refresh=false or omitted: reuses the Active_Tool_Set from session init.
        When refresh=true: re-runs full preference reconciliation (same as session init flow).
        Returns Active_Tool_Set (list of active tool names) in the response.

        """
        try:
            budget_level = extract_budget_level(request.input)
            model_id = extract_model_id(request.input)
            # Support both 'refresh' (new) and 'refresh_tools' (legacy) parameters
            refresh = request.input.get(
                "refresh", request.input.get("refresh_tools", False)
            )

            # Validate model_id
            if model_id is not None and not validate_model_id(model_id):
                return error_envelope(
                    "validation_error",
                    f"Invalid model_id: {model_id}. Allowed: {ALLOWED_MODELS}",
                )

            if budget_level is None:
                budget_level = agent_manager.current_budget_level

            logger.debug(
                f"Preparing: budget={budget_level}, model={model_id}, refresh={refresh}"
            )

            if refresh:
                # Re-run full preference reconciliation (Req 5.3)
                logger.debug(
                    f"Refresh requested — re-running preference reconciliation for user {user_id}"
                )
                await agent_manager.build_tools_with_reconciliation(user_id)
            elif agent_manager.current_user_id != user_id:
                # First time for this user — need initial tool load
                logger.debug(f"New user {user_id} — running preference reconciliation")
                await agent_manager.build_tools_with_reconciliation(user_id)
            # else: refresh=false and same user → reuse Active_Tool_Set from session init (Req 5.2)

            # Get agent (uses cached tools, recreates if model/budget changed)
            await agent_manager.get_agent(budget_level, model_id)

            effective_model_id = model_id or DEFAULT_MODEL_ID
            active_tools = (
                [t.name for t in agent_manager.cached_tools]
                if agent_manager.cached_tools
                else []
            )

            # Run checkpoint prefetch and project lookup in parallel —
            # these are independent branches that each hit DynamoDB/AgentCore.
            async def _fetch_checkpoint_state():
                """Prefetch checkpoint, then read canvases from state."""
                try:
                    await checkpointer.aprefetch_session(
                        actor_id=user_id,
                        thread_id=session_id,
                    )
                except Exception as e:
                    logger.warning(f"Checkpoint prefetch failed (non-fatal): {e}")
                try:
                    config = {
                        "configurable": {"thread_id": session_id, "actor_id": user_id}
                    }
                    state = await agent_manager.cached_agent.aget_state(config)
                    if state and state.values.get("canvases"):
                        return state.values["canvases"]
                except Exception as e:
                    logger.warning(f"Failed to fetch canvases state (non-fatal): {e}")
                return {}

            async def _fetch_project_info():
                """Look up bound project and its canvases."""
                try:
                    project_id = await chat_history_service.get_project_id(session_id)
                    if not project_id:
                        return None
                    from project_context import get_project_for_user
                    from project_preference_loader import get_project_preferences
                    from project_canvas_service import list_canvases

                    project, saved_canvases = await asyncio.gather(
                        get_project_for_user(project_id, user_id),
                        list_canvases(project_id),
                    )
                    if project:
                        asyncio.create_task(
                            get_project_preferences(project_id, user_id)
                        )
                        return {
                            "project_id": project["project_id"],
                            "name": project.get("name", ""),
                            "description": project.get("description", ""),
                            "saved_canvases": saved_canvases,
                        }
                except Exception as e:
                    logger.warning(f"Failed to fetch bound project (non-fatal): {e}")
                return None

            canvases_state, project_info = await asyncio.gather(
                _fetch_checkpoint_state(),
                _fetch_project_info(),
            )

            # Enabled optional tools from user's DynamoDB config — lets the
            # frontend build per-request enabled_tools without a separate call.
            enabled_optional = [
                name
                for name, on in agent_manager.cached_optional_tool_prefs.items()
                if on
            ]

            return JSONResponse(
                {
                    "type": "prepare_complete",
                    "message": "Environment ready",
                    "active_tools": active_tools,
                    "enabled_optional_tools": enabled_optional,
                    "budget_level": agent_manager.current_budget_level,
                    "thinking_enabled": agent_manager.current_budget_level > 0,
                    "model_id": effective_model_id,
                    "canvases": canvases_state,
                    "project": project_info,
                },
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                },
            )
        except Exception as e:
            logger.error(f"Failed to prepare: {e}")
            return error_envelope("internal_error", "Failed to prepare session.")

    @staticmethod
    async def handle_summary(
        request: InvocationRequest, session_id: str, user_id: str
    ) -> JSONResponse:
        """Handle summary generation for chat history.

        Generates a short description of the user's message using a simple LLM call,
        and creates a chat history record in DynamoDB in parallel.

        Args:
            request: The invocation request containing the user's message
            session_id: The Bedrock session ID
            user_id: The authenticated user ID from JWT token

        Returns:
            JSONResponse with the generated description and session_id
        """
        try:
            message = request.input.get("message", "")

            if not message:
                return error_envelope("validation_error", "Message is required")

            # Generate description using simple LLM call (no tools, no LangGraph)
            description = await generate_summary_with_llm(message)

            # Fallback to truncated message if LLM fails
            if not description:
                description = message[:50] + "..." if len(message) > 50 else message

            # Create DynamoDB entry in parallel with response
            async def create_history_record():
                try:
                    await chat_history_service.create_session_record(
                        session_id=session_id, user_id=user_id
                    )
                    await chat_history_service.update_session_description(
                        session_id=session_id, description=description
                    )
                except Exception as e:
                    logger.error(f"Failed to create chat history record: {e}")

            # Run DynamoDB operation in background (fire and forget)
            asyncio.create_task(create_history_record())

            return JSONResponse(
                {
                    "type": "summary_complete",
                    "session_id": session_id,
                    "description": description,
                },
                headers={
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "*",
                },
            )

        except Exception as e:
            logger.error(f"Failed to generate summary: {e}")
            return error_envelope("internal_error", "Failed to generate summary.")

    @staticmethod
    def handle_stream_status(session_id: str) -> JSONResponse:
        """Handle stream status requests.

        Returns active status with buffered chunks if session has an active stream,
        or inactive status otherwise.

        Args:
            session_id: The session ID to check for active stream

        Returns:
            JSONResponse with stream status:
            - active: bool - whether stream is currently active
            - chunks: List[dict] - buffered chunks (only if active)
            - user_message: str - original message (only if active)
        """
        status = StreamingHandler.get_active_stream(session_id)
        return JSONResponse(
            status,
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    @staticmethod
    async def handle_stream_resume(session_id: str) -> StreamingResponse:
        """Handle stream resume SSE requests.

        SSE endpoint that:
        1. Checks if stream is active
        2. If active: yields buffered chunks, then polls for new chunks
        3. If inactive: yields end event immediately

        Uses polling instead of queue to avoid single-consumer issues.

        Args:
            session_id: The session ID to resume stream for

        Returns:
            StreamingResponse with SSE content type
        """

        async def generate():
            stream_state = _active_streams.get(session_id)

            if not stream_state:
                yield f"data: {json.dumps({'active': False, 'end': True})}\n\n"
                return

            # Send user_message first so frontend can identify the turn
            yield f"data: {json.dumps({'user_message': stream_state['user_message']})}\n\n"

            # Track how many chunks we've sent
            sent_count = 0

            try:
                while True:
                    # Re-fetch stream state in case it was updated
                    stream_state = _active_streams.get(session_id)
                    if not stream_state:
                        # Stream was cleaned up
                        yield f"data: {json.dumps({'end': True})}\n\n"
                        return

                    # Get current chunks list
                    current_chunks = stream_state["chunks"]

                    # Send any new chunks we haven't sent yet
                    while sent_count < len(current_chunks):
                        chunk = current_chunks[sent_count]
                        yield f"data: {json.dumps(chunk)}\n\n"
                        sent_count += 1

                    # Check if stream is completed
                    if stream_state["completed"]:
                        yield f"data: {json.dumps({'end': True})}\n\n"
                        return

                    # Small delay before polling again to avoid busy-waiting
                    await asyncio.sleep(0.05)

            except asyncio.CancelledError:
                # Client disconnected - clean exit
                logger.debug(
                    f"Stream resume subscriber disconnected for session: {session_id}"
                )
            except Exception as e:
                logger.error(f"Error in stream resume for session {session_id}: {e}")
                yield f"data: {json.dumps({'error': 'Stream resume failed.', 'end': True})}\n\n"

        return StreamingResponse(
            generate(),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                "Access-Control-Allow-Headers": "*",
            },
        )

    @staticmethod
    async def handle_branch(
        request: InvocationRequest, session_id: str, user_id: str
    ) -> JSONResponse:
        """Handle branch requests — create a new session from a specific checkpoint.

        When checkpoint_id is provided, loads state at that exact point (messages
        and canvases are already correct). Falls back to turn_index-based slicing
        for backward compatibility with older clients.
        """
        cors_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }

        try:
            source_session_id = request.input.get("source_session_id")
            turn_index = request.input.get("turn_index")
            checkpoint_id = request.input.get("checkpoint_id")

            if source_session_id is None:
                return error_envelope(
                    "validation_error",
                    "source_session_id is required",
                )

            if checkpoint_id is None and turn_index is None:
                return error_envelope(
                    "validation_error",
                    "Either checkpoint_id or turn_index is required",
                )

            source_validation = await validate_session_ownership(
                source_session_id, user_id
            )
            if source_validation != "authorized":
                return error_envelope(
                    "auth_error", "Session not found or access denied"
                )

            config = {
                "configurable": {
                    "thread_id": source_session_id,
                    "actor_id": user_id,
                    **({"checkpoint_id": checkpoint_id} if checkpoint_id else {}),
                }
            }
            state = await agent_manager.cached_agent.aget_state(config)

            if not state or not state.values.get("messages"):
                return error_envelope("not_found", "Source session not found")

            messages = state.values["messages"]
            canvases = state.values.get("canvases", {})

            # When using turn_index without checkpoint_id, slice messages manually
            # (backward compat for clients that don't send checkpoint_id)
            if not checkpoint_id and turn_index is not None:
                try:
                    messages = slice_messages_to_turn(messages, turn_index)
                except ValueError as e:
                    return error_envelope(
                        "validation_error", f"Invalid turn index: {e}"
                    )

            new_session_id = str(uuid.uuid4())

            new_config = {
                "configurable": {"thread_id": new_session_id, "actor_id": user_id}
            }
            await agent_manager.cached_agent.aupdate_state(
                new_config,
                values={
                    "messages": messages,
                    "canvases": canvases,
                },
            )

            try:
                source_record = await chat_history_service.get_session(
                    source_session_id
                )
                source_description = (source_record or {}).get(
                    "description"
                ) or "Branched from conversation"

                await chat_history_service.create_session_record(
                    session_id=new_session_id,
                    user_id=user_id,
                )
                await chat_history_service.update_session_description(
                    session_id=new_session_id,
                    description=source_description,
                )
            except Exception as e:
                logger.error(
                    f"Failed to create chat history record for branch {new_session_id}: {e}"
                )

            return JSONResponse(
                {"type": "branch_complete", "session_id": new_session_id},
                headers=cors_headers,
            )

        except Exception as e:
            logger.error(f"Unexpected error in handle_branch: {e}")
            return error_envelope("internal_error", "An unexpected error occurred.")

    @staticmethod
    async def handle_generate_live_view_url(browser_session_id: str) -> JSONResponse:
        """Generate a fresh live view URL for the given browser session."""
        if not browser_session_id:
            return JSONResponse(
                status_code=400,
                content={"error": "browser_session_id is required"},
            )
        try:
            result = await browser_client.generate_live_view_url(browser_session_id)
            return JSONResponse(content=result)
        except BrowserToolError as e:
            logger.error(f"Browser tool error generating live view URL: {e}")
            return JSONResponse(
                status_code=404,
                content={"error": "Browser session not found."},
            )

    @staticmethod
    async def handle_take_browser_control(session_id: str) -> JSONResponse:
        """Set user_controlled=True, generate lock_id, return it."""
        if not session_id:
            return JSONResponse(
                status_code=400,
                content={"error": "session_id is required"},
            )
        try:
            lock_id = browser_client.set_user_controlled(session_id)
            return JSONResponse(content={"status": "ok", "lock_id": lock_id})
        except BrowserToolError:
            return JSONResponse(
                status_code=404,
                content={"error": f"Session not found: {session_id}"},
            )

    @staticmethod
    async def handle_release_browser_control(
        session_id: str, lock_id: str
    ) -> JSONResponse:
        """Release user_controlled if lock_id matches. Idempotent — always returns 200."""
        if not session_id:
            return JSONResponse(
                status_code=400,
                content={"error": "session_id is required"},
            )
        try:
            browser_client.release_user_controlled(session_id, lock_id or "")
            return JSONResponse(content={"status": "ok"})
        except BrowserToolError:
            return JSONResponse(
                status_code=404,
                content={"error": f"Session not found: {session_id}"},
            )

    @staticmethod
    async def handle_canvas_edit(
        request: dict, user_id: str, session_id: str
    ) -> JSONResponse:
        """Save a user edit by overwriting the latest version in-place via aupdate_state."""
        cors_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
        canvas_id = request.get("canvas_id")
        content = request.get("content")

        if not canvas_id or content is None:
            return JSONResponse(
                {"type": "error", "error": "canvas_id and content are required"},
                status_code=400,
                headers=cors_headers,
            )

        try:
            config = {"configurable": {"thread_id": session_id, "actor_id": user_id}}
            state = await agent_manager.cached_agent.aget_state(config)

            if not state or not state.values.get("canvases"):
                return JSONResponse(
                    {"type": "error", "error": "Canvas not found"},
                    status_code=404,
                    headers=cors_headers,
                )

            canvases = state.values["canvases"]
            canvas = canvases.get(canvas_id)
            if canvas is None:
                return JSONResponse(
                    {"type": "error", "error": "Canvas not found"},
                    status_code=404,
                    headers=cors_headers,
                )

            version_id = canvas["latest_version_id"]
            existing_version = canvas["versions"][version_id]

            # Overwrite the existing latest version with new content
            await agent_manager.cached_agent.aupdate_state(
                config,
                values={
                    "canvases": {
                        canvas_id: {
                            **canvas,
                            "versions": {
                                version_id: {
                                    **existing_version,
                                    "content": content,
                                    "edited_by": "user",
                                    "timestamp": datetime.now(timezone.utc).isoformat(),
                                }
                            },
                        }
                    }
                },
            )

            return JSONResponse(
                {"status": "updated", "canvas_id": canvas_id},
                headers=cors_headers,
            )
        except Exception as e:
            logger.error(f"Failed to save canvas edit: {e}")
            return JSONResponse(
                {"type": "error", "error": "Failed to save canvas edit."},
                status_code=500,
                headers=cors_headers,
            )

    @staticmethod
    async def handle_save_canvas_to_project(
        request: dict, user_id: str, session_id: str
    ) -> JSONResponse:
        """Save the current version of a canvas to the bound project.

        Validates project ownership, retrieves canvas content from session state,
        and persists it to S3 + DynamoDB via project_canvas_service.
        Re-saving an existing canvas_id overwrites the previous version.
        """
        cors_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
        project_id = request.get("project_id")
        canvas_id = request.get("canvas_id")

        if not project_id or not canvas_id:
            return JSONResponse(
                {"type": "error", "error": "project_id and canvas_id are required"},
                status_code=400,
                headers=cors_headers,
            )

        try:
            from project_context import get_project_for_user
            from project_canvas_service import save_canvas

            project = await get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope(
                    "auth_error", "Project not found or access denied"
                )

            if not agent_manager.cached_agent:
                return JSONResponse(
                    {"type": "error", "error": "Agent not initialized"},
                    status_code=503,
                    headers=cors_headers,
                )

            config = {"configurable": {"thread_id": session_id, "actor_id": user_id}}
            state = await agent_manager.cached_agent.aget_state(config)

            if not state or not state.values.get("canvases"):
                return JSONResponse(
                    {"type": "error", "error": "Canvas not found in session state"},
                    status_code=404,
                    headers=cors_headers,
                )

            canvas = state.values["canvases"].get(canvas_id)
            if canvas is None:
                return JSONResponse(
                    {"type": "error", "error": f"Canvas {canvas_id!r} not found"},
                    status_code=404,
                    headers=cors_headers,
                )

            latest_version = canvas["versions"][canvas["latest_version_id"]]
            result = await save_canvas(
                project_id=project_id,
                canvas_id=canvas_id,
                name=canvas.get("name", ""),
                canvas_type=canvas.get("type", "document"),
                content=latest_version["content"],
                session_id=session_id,
                user_id=user_id,
            )

            return JSONResponse(
                {"status": "saved", **result},
                headers=cors_headers,
            )
        except Exception as e:
            logger.error(f"Failed to save canvas to project: {e}")
            return error_envelope("internal_error", "Failed to save canvas to project.")

    @staticmethod
    async def handle_delete_project_canvas(
        request: dict, user_id: str, session_id: str
    ) -> JSONResponse:
        """Delete a saved canvas artifact from a project."""
        cors_headers = {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "*",
        }
        project_id = request.get("project_id")
        canvas_id = request.get("canvas_id")

        if not project_id or not canvas_id:
            return JSONResponse(
                {"type": "error", "error": "project_id and canvas_id are required"},
                status_code=400,
                headers=cors_headers,
            )

        try:
            from project_context import get_project_for_user
            from project_canvas_service import delete_canvas

            project = await get_project_for_user(project_id, user_id)
            if not project:
                return error_envelope(
                    "auth_error", "Project not found or access denied"
                )

            deleted = await delete_canvas(project_id, canvas_id)
            if not deleted:
                return JSONResponse(
                    {"type": "error", "error": f"Canvas {canvas_id!r} not found"},
                    status_code=404,
                    headers=cors_headers,
                )

            return JSONResponse(
                {"status": "deleted", "canvas_id": canvas_id},
                headers=cors_headers,
            )
        except Exception as e:
            logger.error(f"Failed to delete project canvas: {e}")
            return error_envelope("internal_error", "Failed to delete project canvas.")


# Global handlers instance
handlers = RequestHandlers()
