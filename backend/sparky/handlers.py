import asyncio
import json
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from fastapi.responses import JSONResponse, StreamingResponse
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from models import InvocationRequest
from agent_manager import agent_manager
from code_interpreter import code_interpreter_client
from kb_event_publisher import extract_text_content
from chat_history_service import chat_history_service
from session_validator import (
    register_session,
    deregister_session,
    validate_session_ownership,
)
from utils import (
    logger,
    extract_budget_level,
    error_envelope,
    sse_stream,
    CORS_HEADERS,
)
from streaming import (
    StreamingHandler,
    _active_streams,
    _thread_streaming_body,
    streaming_handler,
)
from thread_keys import (
    thread_stream_key,
    thread_graph_id_for as _thread_checkpoint_thread_id,
)
from browser import browser_client, BrowserToolError
from config import (
    boto_client,
    checkpointer,
    DEFAULT_MODEL_ID,
    validate_model_id,
    ALLOWED_MODELS,
)


# Strong references to fire-and-forget cleanup tasks so they don't get garbage
# collected mid-run. Each task removes itself on completion.
_background_delete_tasks: set = set()


def _normalize_for_match(text: str) -> str:
    """Collapse whitespace for anchor-substring matching.

    Rendered markdown and the raw AIMessage content may differ in leading
    newlines, trailing whitespace, and whitespace inside the markdown (e.g.
    line wrapping). Normalizing both sides to single-spaced text lets us
    verify an anchor without being tripped up by those incidental deltas.
    """
    if not text:
        return ""
    return " ".join(text.split())


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

            # Fire-and-forget cleanup of thread anchors + each thread's
            # checkpoints. Anchors live in DynamoDB (not the LangGraph state)
            # so deletion is independent of the parent session's checkpoint.
            async def _cleanup_threads() -> None:
                try:
                    from thread_anchor_service import delete_session_anchors

                    deleted = await delete_session_anchors(session_id)
                except Exception as e:
                    logger.warning(
                        f"Thread anchor cleanup failed for session {session_id}: {e}"
                    )
                    return
                if not hasattr(checkpointer, "adelete_thread"):
                    return
                for a in deleted:
                    tgid = a.get("thread_graph_id")
                    if not tgid:
                        continue
                    try:
                        await checkpointer.adelete_thread(tgid)
                    except Exception as e:
                        logger.warning(
                            f"Thread checkpoint cleanup failed for {tgid} "
                            f"(non-fatal): {e}"
                        )

            task = asyncio.create_task(_cleanup_threads())
            _background_delete_tasks.add(task)
            task.add_done_callback(_background_delete_tasks.discard)

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
            async def _fetch_canvases():
                """Prefetch checkpoint, then read canvases from graph state."""
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
                    if state and state.values:
                        return state.values.get("canvases") or {}
                except Exception as e:
                    logger.warning(f"Failed to fetch session state (non-fatal): {e}")
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
                _fetch_canvases(),
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

            # Fork point — the highest turn_index retained by the new session.
            # For turn_index branches it's turn_index - 1; for checkpoint_id
            # branches we count HumanMessages in the kept slice.
            if turn_index is not None and not checkpoint_id:
                fork_point = turn_index - 1
            else:
                fork_point = sum(1 for m in messages if isinstance(m, HumanMessage)) - 1

            new_session_id = str(uuid.uuid4())

            new_config = {
                "configurable": {"thread_id": new_session_id, "actor_id": user_id}
            }
            await agent_manager.cached_agent.aupdate_state(
                new_config,
                values={"messages": messages, "canvases": canvases},
            )

            # Load anchors from DynamoDB, filter out those past the fork point
            # or whose thread is currently streaming, then copy both the
            # anchor rows AND each thread's checkpoint bundle to the new session.
            from thread_anchor_service import (
                list_anchors_for_session,
                put_anchor,
            )

            source_anchors = await list_anchors_for_session(source_session_id)
            skipped_thread_ids: List[str] = []
            carry_anchors: List[dict] = []
            for a in source_anchors:
                if a.get("turn_index", -1) > fork_point:
                    continue
                tid = a.get("thread_id")
                if not tid:
                    continue
                if thread_stream_key(source_session_id, tid) in _active_streams:
                    skipped_thread_ids.append(tid)
                    continue
                carry_anchors.append(a)

            async def _carry_one(a: dict) -> Optional[str]:
                tid = a["thread_id"]
                src_graph = _thread_checkpoint_thread_id(source_session_id, tid)
                dst_graph = _thread_checkpoint_thread_id(new_session_id, tid)
                try:
                    copied = await checkpointer.acopy_checkpoint_ns(
                        src_actor_id=user_id,
                        src_thread_id=src_graph,
                        src_ns="",
                        dst_actor_id=user_id,
                        dst_thread_id=dst_graph,
                        dst_ns="",
                    )
                    # No checkpoints copied → the anchor would point at an
                    # empty thread graph. Skip it so the new session doesn't
                    # surface a broken thread.
                    if not copied:
                        logger.warning(
                            f"Branch: thread {tid} skipped — no checkpoints copied"
                        )
                        return tid
                    await put_anchor(
                        {
                            **a,
                            "session_id": new_session_id,
                            "thread_graph_id": dst_graph,
                        }
                    )
                    return None
                except Exception as e:
                    logger.warning(f"Branch: failed to carry thread {tid}: {e}")
                    return tid

            failed = await asyncio.gather(*(_carry_one(a) for a in carry_anchors))
            skipped_thread_ids.extend(tid for tid in failed if tid)

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

            response_body: Dict[str, Any] = {
                "type": "branch_complete",
                "session_id": new_session_id,
            }
            if skipped_thread_ids:
                response_body["skipped_thread_ids"] = skipped_thread_ids
            return JSONResponse(response_body, headers=cors_headers)

        except Exception as e:
            logger.error(f"Unexpected error in handle_branch: {e}")
            return error_envelope("internal_error", "An unexpected error occurred.")

    @staticmethod
    async def handle_convert_execution_to_chat(
        request: InvocationRequest, user_id: str
    ) -> JSONResponse:
        """Convert a scheduled task execution into a chat session.

        Copies the LangGraph thread (keyed by execution_id) into a new
        thread and registers it as a normal chat session so the user can
        continue the conversation in the chat UI.
        """
        execution_id = request.input.get("execution_id")
        job_name = request.input.get("job_name", "Scheduled task")

        if not execution_id:
            return error_envelope("validation_error", "execution_id is required")

        try:
            # Load checkpoint from the execution thread
            source_config = {
                "configurable": {
                    "thread_id": execution_id,
                    "actor_id": user_id,
                }
            }
            state = await agent_manager.cached_agent.aget_state(source_config)

            if not state or not state.values.get("messages"):
                return error_envelope(
                    "not_found", "No conversation found for this execution"
                )

            messages = state.values["messages"]
            canvases = state.values.get("canvases", {})

            # Create new session
            new_session_id = str(uuid.uuid4())
            new_config = {
                "configurable": {
                    "thread_id": new_session_id,
                    "actor_id": user_id,
                }
            }
            await agent_manager.cached_agent.aupdate_state(
                new_config,
                values={"messages": messages, "canvases": canvases},
            )

            # Register in chat history
            await chat_history_service.create_session_record(
                session_id=new_session_id,
                user_id=user_id,
            )
            await chat_history_service.update_session_description(
                session_id=new_session_id,
                description=job_name,
            )

            register_session(new_session_id, user_id)

            return JSONResponse(
                {
                    "type": "convert_complete",
                    "session_id": new_session_id,
                }
            )

        except Exception as e:
            logger.error(f"Failed to convert execution to chat: {e}")
            return error_envelope(
                "internal_error", "Failed to convert execution to chat"
            )

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

    # Threads — side-conversations anchored to a span of an AI message.
    # Each thread has its own LangGraph thread_id (see
    # _thread_checkpoint_thread_id) so checkpoints stay isolated from the
    # parent session. Anchors are persisted in DynamoDB via
    # thread_anchor_service — NOT in the LangGraph state — so thread
    # create/delete operations can never corrupt the parent's messages.

    @staticmethod
    async def handle_thread_create(
        request: InvocationRequest, session_id: str, user_id: str
    ) -> JSONResponse:
        """Create a new thread anchored to a span of an AI message.

        Required input fields:
          - turn_index: int           — zero-based turn index of the target AI message
          - ai_message_index: int     — index into the AI message list (in case there
                                         are multiple AI messages in one turn)
          - quoted_text: str          — the exact substring the user highlighted
          - start_offset: int         — char offset of quote start in message content
          - end_offset: int           — char offset of quote end
          - prompt: str               — the user's first thread message
        Optional:
          - title, message_id         — passthrough metadata
        """
        data = request.input or {}
        turn_index = data.get("turn_index")
        ai_message_index = data.get("ai_message_index", 0)
        quoted_text = data.get("quoted_text", "")
        start_offset = data.get("start_offset")
        end_offset = data.get("end_offset")
        prompt = (data.get("prompt") or "").strip()
        title = data.get("title")
        message_id = data.get("message_id")

        if turn_index is None or not isinstance(turn_index, int):
            return error_envelope("validation_error", "turn_index (int) is required")
        if not prompt:
            return error_envelope("validation_error", "prompt is required")

        try:
            agent = await agent_manager.get_agent()
            config = {"configurable": {"thread_id": session_id, "actor_id": user_id}}
            state = await agent.aget_state(config)
            if not state or not state.values.get("messages"):
                return error_envelope("not_found", "Session has no messages")

            messages = state.values["messages"]

            # Slice: everything up to and including the target turn.
            try:
                turn_slice = slice_messages_to_turn(messages, turn_index)
            except ValueError as ve:
                return error_envelope("validation_error", str(ve))

            # Extract AI messages in the target turn that actually have visible
            # text content. The frontend's ai_message_index counts *rendered
            # text blocks* in the UI, not raw AIMessage objects — a single turn
            # may contain multiple AIMessages for reasoning / tool calls that
            # have no text of their own. Filtering here matches the two
            # definitions.
            human_seen = -1
            turn_start = 0
            for i, m in enumerate(turn_slice):
                if isinstance(m, HumanMessage):
                    human_seen += 1
                    if human_seen == turn_index:
                        turn_start = i
                        break
            turn_ai_messages = [
                m
                for m in turn_slice[turn_start:]
                if isinstance(m, AIMessage) and extract_text_content(m.content)
            ]
            if ai_message_index < 0 or ai_message_index >= len(turn_ai_messages):
                return error_envelope(
                    "validation_error",
                    f"ai_message_index {ai_message_index} out of range for turn {turn_index}",
                )
            target_ai = turn_ai_messages[ai_message_index]

            # We intentionally don't strictly verify that quoted_text appears
            # inside target_ai.content. The rendered text the user highlights
            # has markdown formatting stripped (e.g. "hello **world**" renders
            # as "hello world"), so a naive substring match against the raw
            # persisted content will miss valid anchors whenever the span
            # crosses any formatting. turn_index + ai_message_index already
            # unambiguously identifies the target message, so drift detection
            # here would be theatrical rather than load-bearing.
            target_text = _normalize_for_match(extract_text_content(target_ai.content))
            quoted_norm = _normalize_for_match(quoted_text)
            if quoted_norm and quoted_norm not in target_text:
                logger.debug(
                    "thread_create: quote not found in target AI text "
                    "(likely stripped markdown) — accepting anyway. "
                    "quote=%r target=%r",
                    quoted_norm[:80],
                    target_text[:120],
                )

            # Reject if the target turn's main stream is currently active.
            if session_id in _active_streams:
                return error_envelope(
                    "busy",
                    "Main chat is currently streaming. Try again once it finishes.",
                )

            thread_id = str(uuid.uuid4())
            # Use a dedicated LangGraph thread_id (not checkpoint_ns) so the
            # agent's normal checkpointer semantics apply. See
            # _thread_checkpoint_thread_id for why.
            thread_graph_id = _thread_checkpoint_thread_id(session_id, thread_id)
            now_iso = datetime.now(timezone.utc).isoformat()

            # Seed the thread checkpoint with the main-chat slice + a framing
            # SystemMessage. Freezes the context so subsequent main-chat turns
            # don't shift the thread's view. The opening HumanMessage is sent
            # via the first thread_message call (which also runs the model),
            # so we don't duplicate it here.
            frame = (
                "You are continuing a side-conversation (Thread) about a specific "
                "passage from the AI message above. The user highlighted the "
                "following quote and wants to discuss it:\n\n"
                f"> {quoted_text}\n\n"
                "The conversation up to and including that AI response is shown "
                "above for context. Focus your answer on the quoted span and the "
                "user's new question. Do not modify canvases and do not browse "
                "the web — those tools are unavailable here."
            )
            seed_messages = [*turn_slice, SystemMessage(content=frame)]
            thread_config = {
                "configurable": {
                    "thread_id": thread_graph_id,
                    "actor_id": user_id,
                }
            }
            anchor = {
                "session_id": session_id,
                "thread_id": thread_id,
                "user_id": user_id,
                "thread_graph_id": thread_graph_id,
                "turn_index": turn_index,
                "ai_message_index": ai_message_index,
                "message_id": message_id,
                "start_offset": start_offset,
                "end_offset": end_offset,
                "quoted_text": quoted_text,
                "title": title or (quoted_text[:60] if quoted_text else "Thread"),
                "created_at": now_iso,
            }

            # Seed the thread's checkpoint + persist the anchor in DynamoDB
            # concurrently. They target completely different storage so no
            # contention; the parent session's checkpoint is never touched.
            from thread_anchor_service import put_anchor

            await asyncio.gather(
                agent.aupdate_state(thread_config, values={"messages": seed_messages}),
                put_anchor(anchor),
            )

            return JSONResponse(
                {
                    "type": "thread_created",
                    "thread_id": thread_id,
                    "thread_graph_id": thread_graph_id,
                    "anchor": anchor,
                },
                headers=CORS_HEADERS,
            )
        except ValueError as e:
            return error_envelope("validation_error", str(e))
        except Exception as e:
            logger.error(f"handle_thread_create failed: {e}", exc_info=True)
            return error_envelope("internal_error", "Failed to create thread.")

    @staticmethod
    async def handle_thread_message(
        request: InvocationRequest, session_id: str, user_id: str
    ) -> StreamingResponse:
        """Stream a new user turn into an existing thread.

        The enabled_tools field of the request is IGNORED — the thread's tool
        policy is server-authoritative (blacklist in THREAD_DISABLED_TOOLS).
        Returns an SSE stream identical in envelope to the main /invocations flow.
        """
        data = request.input or {}
        thread_id = data.get("thread_id")
        prompt = (data.get("prompt") or "").strip()
        model_id = data.get("model_id")

        if not thread_id:
            return error_envelope("validation_error", "thread_id is required")
        if not prompt:
            return error_envelope("validation_error", "prompt is required")

        if data.get("enabled_tools"):
            logger.warning(
                "thread_message: ignoring client-supplied enabled_tools "
                "(server-authoritative blacklist applies)"
            )

        # Wrap the streaming body with the SSE decorator at call time.
        @sse_stream()
        async def _run():
            async for chunk in _thread_streaming_body(
                handler_instance=streaming_handler,
                session_id=session_id,
                user_id=user_id,
                thread_id=thread_id,
                prompt=prompt,
                model_id=model_id,
            ):
                yield chunk

        return await _run()

    @staticmethod
    async def handle_thread_fetch(
        request: InvocationRequest, session_id: str, user_id: str
    ) -> JSONResponse:
        """Return the messages + anchor for a single thread."""
        data = request.input or {}
        thread_id = data.get("thread_id")
        if not thread_id:
            return error_envelope("validation_error", "thread_id is required")

        try:
            from thread_anchor_service import get_anchor

            agent = await agent_manager.get_agent()
            thread_graph_id = _thread_checkpoint_thread_id(session_id, thread_id)
            thread_config = {
                "configurable": {
                    "thread_id": thread_graph_id,
                    "actor_id": user_id,
                }
            }
            state, anchor = await asyncio.gather(
                agent.aget_state(thread_config),
                get_anchor(session_id, thread_id),
            )

            messages_raw = (
                state.values.get("messages", []) if state and state.values else []
            )

            # Serialize only the messages that belong to this thread's own
            # conversation — drop everything up to and including the last
            # seeded SystemMessage (parent-chat context for the LLM).
            start_index = 0
            for i in range(len(messages_raw) - 1, -1, -1):
                if isinstance(messages_raw[i], SystemMessage):
                    start_index = i + 1
                    break

            serialized: List[dict] = []
            for msg in messages_raw[start_index:]:
                if isinstance(msg, HumanMessage):
                    serialized.append({"role": "user", "content": msg.content})
                elif isinstance(msg, AIMessage):
                    serialized.append({"role": "assistant", "content": msg.content})

            return JSONResponse(
                {
                    "type": "thread_fetched",
                    "thread_id": thread_id,
                    "messages": serialized,
                    "anchor": anchor,
                },
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"handle_thread_fetch failed: {e}")
            return error_envelope("internal_error", "Failed to fetch thread.")

    @staticmethod
    async def handle_thread_delete(
        request: InvocationRequest, session_id: str, user_id: str
    ) -> JSONResponse:
        """Remove a thread's anchor from main state and delete its checkpoints."""
        data = request.input or {}
        thread_id = data.get("thread_id")
        if not thread_id:
            return error_envelope("validation_error", "thread_id is required")

        try:
            from thread_anchor_service import delete_anchor

            # Cancel any in-flight thread stream first.
            if thread_stream_key(session_id, thread_id) in _active_streams:
                from streaming import cancel_stream_async as _cancel

                await _cancel(session_id, thread_id)

            # Drop the anchor row and the thread's own checkpoint bundle.
            # Both operations target storage independent of the parent
            # session's checkpoint, so neither can corrupt it.
            thread_graph_id = _thread_checkpoint_thread_id(session_id, thread_id)

            async def _adelete_checkpoints() -> None:
                if not hasattr(checkpointer, "adelete_thread"):
                    return
                try:
                    await checkpointer.adelete_thread(thread_graph_id)
                except Exception as e:
                    logger.warning(f"Thread checkpoint cleanup failed: {e}")

            await asyncio.gather(
                delete_anchor(session_id, thread_id),
                _adelete_checkpoints(),
            )

            return JSONResponse(
                {"type": "thread_deleted", "thread_id": thread_id},
                headers=CORS_HEADERS,
            )
        except Exception as e:
            logger.error(f"handle_thread_delete failed: {e}")
            return error_envelope("internal_error", "Failed to delete thread.")


# Global handlers instance
handlers = RequestHandlers()
