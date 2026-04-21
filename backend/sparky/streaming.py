import json
import asyncio
import time
from asyncio import Queue
from typing import Any, Dict, List, Optional, TypedDict
from langchain_core.messages import ToolMessage, AIMessageChunk, AIMessage
from langgraph.types import Command
from models import InvocationRequest
from agent_manager import agent_manager
from graph import SparkyContext, CANVAS_TOOL_NAMES, THREAD_DISABLED_TOOLS
from cancellation_handler import handle_cancellation, is_tool_call, get_tool_call_id
from canvas_stream_parser import CanvasStreamParser
from citation_helpers import build_citation_markers
from utils import (
    sse_stream,
    log_error,
    logger,
    extract_budget_level,
    stream_error_chunk,
)
from attachment_processor import (
    validate_all_attachments,
    build_content_blocks,
    is_spreadsheet_type,
    is_large_document,
    Attachment,
    ALLOWED_TYPES,
    ALLOWED_IMAGE_TYPES,
    ALLOWED_DOCUMENT_TYPES,
)
from code_interpreter import code_interpreter_client, CodeInterpreterError
from browser import browser_client
from kb_event_publisher import get_kb_event_publisher, extract_text_content
from chat_history_service import chat_history_service
from thread_keys import thread_graph_id_for, thread_stream_key  # noqa: F401 (re-exported)


# Stream state type for tracking active streams with pub/sub support
class StreamState(TypedDict):
    queue: Queue  # Pub/sub queue for chunks
    chunks: List[dict]  # Buffered chunks for replay
    user_message: str  # Original user message
    started_at: float  # Timestamp for debugging
    completed: bool  # Whether stream has finished
    error: Optional[str]  # Error message if failed


# Legacy alias for backward compatibility
StreamBuffer = StreamState


# Global stream buffer tracking active streams for reconnection support
_active_streams: Dict[str, StreamBuffer] = {}

# Global task tracking
_current_tasks = {}


def cancel_current_stream(session_id: str = None, thread_id: str = None):
    """Cancel the current streaming operation.

    - (session_id, thread_id) -> cancel that specific thread stream.
    - (session_id,)           -> cancel the main stream for that session.
    - ()                      -> cancel every tracked stream.
    """
    global _current_tasks

    if session_id and thread_id:
        key = thread_stream_key(session_id, thread_id)
        if key in _current_tasks:
            task = _current_tasks[key]
            if not task.done():
                task.cancel()
                logger.debug(f"Cancelled thread stream: {key}")
            return {"response": "stream_cancelled"}
        return {"response": "no_active_stream"}

    if session_id and session_id in _current_tasks:
        task = _current_tasks[session_id]
        if not task.done():
            task.cancel()
            logger.debug(f"Cancelled stream for session: {session_id}")
        # Clear any browser control lock so the frontend can dismiss the toast
        try:
            browser_client.clear_user_controlled(session_id)
        except Exception:
            pass
        return {"response": "stream_cancelled", "browser_control": "released"}

    # Cancel all active tasks if no session_id provided
    cancelled_count = 0
    for sid, task in list(_current_tasks.items()):
        if not task.done():
            task.cancel()
            cancelled_count += 1

    logger.debug(f"Cancelled {cancelled_count} active streams")
    return {"response": f"cancelled_{cancelled_count}_streams"}


async def cancel_stream_async(session_id: str = None, thread_id: str = None):
    """Async version to cancel the current streaming operation"""
    return cancel_current_stream(session_id, thread_id)


def cleanup_finished_tasks():
    """Clean up finished tasks from the global tracking dict"""
    global _current_tasks
    finished_sessions = [sid for sid, task in _current_tasks.items() if task.done()]
    for sid in finished_sessions:
        del _current_tasks[sid]


class StreamingHandler:
    def __init__(self):
        # Guard: only one message processed at a time to prevent AI state corruption
        self._processing = False
        # Canvas streaming state machine (extracted to dedicated module)
        self._canvas_parser = CanvasStreamParser()

    @staticmethod
    def get_active_stream(session_id: str) -> dict:
        """
        Get active stream status for a session.
        Returns buffer contents if session has active stream, inactive status otherwise.
        """
        if session_id in _active_streams:
            buffer = _active_streams[session_id]
            return {
                "active": True,
                "chunks": buffer["chunks"],
                "user_message": buffer["user_message"],
            }
        return {"active": False}

    @sse_stream()
    async def handle_streaming_request(
        self, request: InvocationRequest, session_id: str, user_id: str = None
    ):
        """Handle streaming responses with yields using native astream"""
        # Clean up any finished tasks
        cleanup_finished_tasks()

        # Only one message at a time to prevent AI message state corruption
        if self._processing:
            yield stream_error_chunk(
                "rate_limit",
                "Agent is currently processing another request. Please wait for it to complete.",
            )
            yield {"end": True}
            return

        # Get current task and store it for cancellation
        current_task = asyncio.current_task()
        global _current_tasks
        _current_tasks[session_id] = current_task

        self._processing = True
        try:
            response_buffer = []
            cancelled = False
            tool_messages = []
            content = []

            # KB indexing tracking variables
            user_message_text = ""
            ai_response_text = ""
            message_index = 0
            has_interrupt = False
            token_stats: dict = {}

            # Track whether we've seen real text content yet (strip leading newlines from model output)
            seen_text_content = False

            # Track browser live endpoints already sent this turn (dedup across multiple tool calls)
            seen_live_endpoints = set()

            # Initialize agent and state variables for use in exception handlers and debug logging
            agent = None
            state = None

            # Initialize stream state with queue for pub/sub support
            global _active_streams
            _active_streams[session_id] = StreamState(
                queue=Queue(),
                chunks=[],
                user_message=request.input.get("prompt", ""),
                started_at=time.time(),
                completed=False,
                error=None,
            )

            # Clear any lingering browser control lock from a previous turn
            try:
                browser_client.clear_user_controlled(session_id)
            except Exception:
                pass  # No browser session yet — that's fine

            try:
                # Check if this is a resume_interrupt request
                request_type = request.input.get("type")
                is_resume_interrupt = request_type == "resume_interrupt"

                # Extract agent_mode from request (default "normal")
                agent_mode = request.input.get("agent_mode", "normal")
                logger.debug(f"Agent mode: {agent_mode}")

                # Extract optional tools enabled by the user (e.g. ["browser"])
                enabled_optional_tools = list(request.input.get("enabled_tools", []))

                # Validate project ownership and enable project KB tool if bound
                project_id = request.input.get("project_id", "")
                project_name = ""
                project_description = ""
                project_files: list = []
                project_data_files: list = []
                project_canvases: list = []
                project_preferences = ""
                if project_id:
                    from project_context import get_project_context
                    from project_preference_loader import get_project_preferences

                    proj_ctx = await get_project_context(project_id, user_id)
                    if not proj_ctx:
                        yield stream_error_chunk(
                            "auth_error",
                            "Project not found or access denied.",
                        )
                        yield {"end": True}
                        return
                    project_name = proj_ctx.name
                    project_description = proj_ctx.description
                    project_files = proj_ctx.filenames
                    project_data_files = proj_ctx.data_files
                    project_canvases = proj_ctx.canvases
                    project_preferences = await get_project_preferences(
                        project_id, user_id
                    )
                    if "search_project_knowledge_base" not in enabled_optional_tools:
                        enabled_optional_tools.append("search_project_knowledge_base")
                    if "recall_project_memory" not in enabled_optional_tools:
                        enabled_optional_tools.append("recall_project_memory")
                    if (
                        proj_ctx.filenames or proj_ctx.data_files
                    ) and "load_project_file" not in enabled_optional_tools:
                        enabled_optional_tools.append("load_project_file")
                    if (
                        project_canvases
                        and "load_project_canvas" not in enabled_optional_tools
                    ):
                        enabled_optional_tools.append("load_project_canvas")

                # Ensure agent exists (uses cached tools)
                budget_level = extract_budget_level(request.input)
                if budget_level is None:
                    budget_level = agent_manager.current_budget_level

                # Extract model_id from request for model selection propagation
                model_id = request.input.get("model_id")

                # Validate model_id if provided
                if model_id is not None:
                    from config import validate_model_id, ALLOWED_MODELS

                    if not validate_model_id(model_id):
                        yield stream_error_chunk(
                            "validation_error",
                            f"Invalid model_id: {model_id}. Allowed models: {ALLOWED_MODELS}",
                            {"allowed_models": ALLOWED_MODELS},
                        )
                        yield {"end": True}
                        return

                # Get the appropriate agent based on mode, passing model_id for proper model selection
                agent = await agent_manager.get_agent(
                    budget_level,
                    model_id=model_id,
                    agent_mode=agent_mode,
                    user_id=user_id,
                )

                if is_resume_interrupt:
                    # When resuming interrupt, ensure we use the existing agent without recreation
                    # This preserves the tool registry that matches the persisted state
                    logger.debug(
                        "Resuming interrupt with existing agent to preserve tool registry"
                    )

                if is_resume_interrupt:
                    # Build resume payload with type, optional tool_id, and optional args
                    resume_payload = {"type": request.input.get("prompt")}
                    if request.input.get("tool_id"):
                        resume_payload["tool_id"] = request.input.get("tool_id")
                    if request.input.get("args"):
                        resume_payload["args"] = request.input.get("args")
                    tmp_msg = Command(resume=resume_payload)
                    # Skip KB indexing for resume_interrupt
                    has_interrupt = True
                else:
                    # Extract and validate attachments if present
                    attachments_data = request.input.get("attachments", [])
                    validated_attachments = []

                    if attachments_data:
                        # Validate all attachments
                        validation_result = validate_all_attachments(attachments_data)
                        if not validation_result.valid:
                            # Return error response for invalid attachments
                            yield stream_error_chunk(
                                "attachment_error",
                                validation_result.error,
                                {
                                    "filename": validation_result.filename,
                                    "reason": validation_result.reason,
                                    "allowed_types": list(ALLOWED_TYPES),
                                },
                            )
                            yield {"end": True}
                            return

                        # Convert validated attachment dicts to Attachment objects
                        for att_dict in attachments_data:
                            validated_attachments.append(
                                Attachment(
                                    name=att_dict["name"],
                                    type=att_dict["type"],
                                    size=att_dict["size"],
                                    data=att_dict["data"],
                                )
                            )

                    # Build content blocks (attachments first, then text last)
                    prompt_text = request.input.get(
                        "prompt", "No prompt found in input"
                    )

                    # Classify attachments into routing categories
                    spreadsheet_attachments = [
                        a for a in validated_attachments if is_spreadsheet_type(a.type)
                    ]
                    image_attachments = [
                        a
                        for a in validated_attachments
                        if a.type in ALLOWED_IMAGE_TYPES
                    ]
                    document_attachments = [
                        a
                        for a in validated_attachments
                        if a.type in ALLOWED_DOCUMENT_TYPES
                        and not is_spreadsheet_type(a.type)
                        and a.type not in ALLOWED_IMAGE_TYPES
                    ]
                    large_doc_attachments = [
                        d for d in document_attachments if is_large_document(d)
                    ]

                    # Upload spreadsheets and large documents to CI (fatal on failure)
                    ci_fatal_attachments = (
                        spreadsheet_attachments + large_doc_attachments
                    )
                    if ci_fatal_attachments:
                        try:
                            ci_session_id = (
                                await code_interpreter_client.get_or_create_session(
                                    session_id, user_id=user_id
                                )
                            )
                            files_to_write = []
                            for att in ci_fatal_attachments:
                                files_to_write.append(
                                    {
                                        "path": f"/tmp/data/{att.name}",  # nosec B108
                                        "data": att.data,
                                    }
                                )
                            await code_interpreter_client.upload_data_files(
                                ci_session_id, files_to_write
                            )
                        except CodeInterpreterError as e:
                            logger.error(f"Failed to upload files to CI: {e}")
                            yield stream_error_chunk(
                                "agent_error",
                                "Failed to upload data files to Code Interpreter.",
                            )
                            yield {"end": True}
                            return

                    # Upload images to CI (non-fatal on failure)
                    if image_attachments:
                        try:
                            ci_session_id = (
                                await code_interpreter_client.get_or_create_session(
                                    session_id, user_id=user_id
                                )
                            )
                            image_files_to_write = []
                            for att in image_attachments:
                                image_files_to_write.append(
                                    {
                                        "path": f"/tmp/data/{att.name}",  # nosec B108
                                        "data": att.data,
                                    }
                                )
                            await code_interpreter_client.upload_data_files(
                                ci_session_id, image_files_to_write
                            )
                        except CodeInterpreterError as e:
                            logger.warning(
                                f"Failed to upload image files to CI, continuing with LLM image blocks: {e}"
                            )

                    # Build content blocks with all attachments — routing handled internally
                    content, ci_bound_attachments = build_content_blocks(
                        prompt_text, validated_attachments
                    )

                    # Fetch conversation state once for first-message check and message_index
                    config = {
                        "configurable": {
                            "thread_id": session_id,
                            "actor_id": user_id,
                        }
                    }
                    state = await agent.aget_state(config)

                    tmp_msg = {"messages": [{"role": "user", "content": content}]}

                    # Extract user message text for KB indexing
                    # Strip non-text content (images, documents, cachePoints)
                    user_message_text = extract_text_content(content)

                    # Compute message_index from conversation state
                    if state and state.values.get("messages"):
                        # Count user messages to determine message_index
                        existing_messages = state.values.get("messages", [])
                        user_message_count = sum(
                            1
                            for msg in existing_messages
                            if hasattr(msg, "type") and msg.type == "human"
                        )
                        message_index = user_message_count
                    else:
                        message_index = 0

                # Process the async stream directly using the selected agent
                # Both Normal Agent and Deep Agent use LangGraph's astream interface,
                # yielding StreamPart objects via version="v2"
                # DEBUG: Log conversation messages being sent to agent
                if state and state.values.get("messages"):
                    for i, msg in enumerate(state.values.get("messages", [])):
                        msg_type = type(msg).__name__
                        if hasattr(msg, "content"):
                            content_preview = str(msg.content)[:300]
                        else:
                            content_preview = str(msg)[:300]
                        extra = ""
                        if hasattr(msg, "tool_call_id"):
                            extra = f" tool_call_id={msg.tool_call_id} name={getattr(msg, 'name', '')}"
                        logger.debug(
                            f"[CONV_MSG] [{i}] {msg_type}{extra}: {content_preview}"
                        )
                logger.debug(f"[CONV_NEW] user_input: {str(tmp_msg)[:500]}")

                async for stream_part in agent.astream(
                    tmp_msg,
                    {
                        "configurable": {
                            "thread_id": session_id,
                            "actor_id": user_id,
                        },
                        "recursion_limit": 200,
                    },
                    stream_mode=["messages", "updates", "custom"],
                    version="v2",
                    context=SparkyContext(
                        user_id=user_id or "",
                        session_id=session_id or "",
                        enabled_tools=enabled_optional_tools,
                        model_id=model_id,
                        project_id=project_id,
                        project_name=project_name,
                        project_description=project_description,
                        project_files=project_files,
                        project_data_files=project_data_files,
                        project_canvases=project_canvases,
                        project_preferences=project_preferences,
                    ),
                ):
                    # Unpack v2 StreamPart dict into mode/data for downstream processing
                    mode = stream_part["type"]
                    data = stream_part["data"]

                    # Accumulate token usage from chunks that carry usage_metadata
                    if mode == "messages":
                        chunk = data[0]
                        if isinstance(chunk, AIMessageChunk) and chunk.usage_metadata:
                            u = chunk.usage_metadata
                            details = u.get("input_token_details", {})
                            token_stats["input_tokens"] = token_stats.get(
                                "input_tokens", 0
                            ) + (u.get("input_tokens") or 0)
                            token_stats["output_tokens"] = token_stats.get(
                                "output_tokens", 0
                            ) + (u.get("output_tokens") or 0)
                            token_stats["cache_creation_input_tokens"] = (
                                token_stats.get("cache_creation_input_tokens", 0)
                                + (details.get("cache_creation") or 0)
                            )
                            token_stats["cache_read_input_tokens"] = token_stats.get(
                                "cache_read_input_tokens", 0
                            ) + (details.get("cache_read") or 0)

                    # Process and yield the chunk through _process_stream_data
                    # which handles all chunk types (text, tool, reasoning, interrupt, end)
                    chunk_data = self._process_stream_data(
                        mode, data, session_id, seen_live_endpoints
                    )
                    if chunk_data:
                        # Strip leading newlines from the first text chunk(s) of the stream
                        # Some models emit \n\n before the reasoning block
                        if (
                            not seen_text_content
                            and isinstance(chunk_data, dict)
                            and chunk_data.get("type") == "text"
                        ):
                            stripped = chunk_data["content"].lstrip("\n")
                            if not stripped:
                                continue  # skip entirely empty leading newline chunks
                            chunk_data = {**chunk_data, "content": stripped}
                            seen_text_content = True
                        elif isinstance(chunk_data, dict) and chunk_data.get(
                            "type"
                        ) in ("text", "think"):
                            seen_text_content = True

                        if isinstance(chunk_data, list):
                            for chunk in chunk_data:
                                yield chunk
                                # Buffer chunk and publish to queue for reconnection support
                                if session_id in _active_streams:
                                    _active_streams[session_id]["chunks"].append(chunk)
                                    await _active_streams[session_id]["queue"].put(
                                        chunk
                                    )
                                # Check for interrupt in response
                                if chunk.get("type") == "interrupt":
                                    has_interrupt = True
                        else:
                            yield chunk_data
                            # Buffer chunk and publish to queue for reconnection support
                            if session_id in _active_streams:
                                _active_streams[session_id]["chunks"].append(chunk_data)
                                await _active_streams[session_id]["queue"].put(
                                    chunk_data
                                )
                            # Check for interrupt in response
                            if chunk_data.get("type") == "interrupt":
                                has_interrupt = True

                        # Accumulate AI response text for KB indexing
                        if (
                            isinstance(chunk_data, dict)
                            and chunk_data.get("type") == "text"
                        ):
                            ai_response_text += chunk_data.get("content", "")

                    # Buffer AIMessageChunk for potential cancellation handling
                    if mode == "messages":
                        if (
                            isinstance(data[0], AIMessageChunk)
                            and len(data[0].content) > 0
                            and is_tool_call(data[0].content[0])
                            and not get_tool_call_id(data[0].content[0])
                        ):
                            continue
                        else:
                            response_buffer.append(data[0])

            except asyncio.CancelledError:
                logger.debug(f"Stream cancelled for session: {session_id}")
                cancelled = True
                # Handle cancellation cleanup
                tool_messages = await handle_cancellation(
                    response_buffer, session_id, agent, user_id, agent_manager
                )
                # Don't re-raise - let the generator complete normally

            except Exception as e:
                log_error(e)

                # Check if this is a Research Agent error
                try:
                    from research_agent import ResearchAgentError

                    is_research_agent_error = isinstance(e, ResearchAgentError)
                except ImportError:
                    is_research_agent_error = False

                if is_research_agent_error:
                    # Return Research Agent specific error with recovery option
                    logger.error(
                        f"Research Agent error for session {session_id}: {str(e)}"
                    )
                    yield stream_error_chunk(
                        "research_agent_error",
                        str(e),
                        {"recoverable": getattr(e, "recoverable", True)},
                    )
                else:
                    # Return standard error format for other errors
                    yield stream_error_chunk(
                        "agent_error", "An internal error occurred. Please try again."
                    )

            finally:
                if session_id in _current_tasks:
                    del _current_tasks[session_id]

                # Signal completion/error to queue subscribers before cleanup
                if session_id in _active_streams:
                    stream_state = _active_streams[session_id]
                    stream_state["completed"] = True
                    if cancelled:
                        stream_state["error"] = "Stream cancelled by user"
                    # Signal end to any queue subscribers
                    await stream_state["queue"].put({"end": True})

                # Always ensure we send a completion signal
                if cancelled:
                    for tool_msg in tool_messages:
                        yield tool_msg

                # Include the checkpoint_id so the frontend can target this
                # exact state snapshot when branching conversations
                end_marker = {"end": True}
                if token_stats:
                    end_marker["token_stats"] = token_stats
                try:
                    if agent and user_id:
                        final_config = {
                            "configurable": {
                                "thread_id": session_id,
                                "actor_id": user_id,
                            }
                        }
                        final_state = await agent.aget_state(final_config)
                        cp_id = (
                            final_state.config.get("configurable", {}).get(
                                "checkpoint_id"
                            )
                            if final_state and final_state.config
                            else None
                        )
                        if cp_id:
                            end_marker["checkpoint_id"] = cp_id
                except Exception as e:
                    logger.debug(f"Could not fetch checkpoint_id for end marker: {e}")

                yield end_marker

                # Clean up stream state after yielding end signal
                # Small delay to allow resume subscribers to receive the end signal
                await asyncio.sleep(0.1)
                if session_id in _active_streams:
                    del _active_streams[session_id]

                # Fire-and-forget KB indexing publish
                # Skip if: interrupt detected, no user message, or resume_interrupt request
                if user_id and user_message_text and not has_interrupt:
                    kb_publisher = get_kb_event_publisher()
                    if kb_publisher.enabled:
                        # Fire-and-forget: fetch description and publish in background
                        async def publish_with_description():
                            try:
                                session_description = None
                                try:
                                    session_record = (
                                        await chat_history_service.get_session(
                                            session_id
                                        )
                                    )
                                    if session_record:
                                        session_description = session_record.get(
                                            "description"
                                        )
                                except Exception as e:
                                    logger.warning(
                                        f"Could not fetch session description: {e}"
                                    )

                                await kb_publisher.publish_conversation(
                                    session_id=session_id,
                                    user_id=user_id,
                                    message_index=message_index,
                                    user_message=user_message_text,
                                    ai_response=ai_response_text,
                                    description=session_description,
                                )
                            except Exception as e:
                                logger.error(f"KB publish failed: {e}")

                        asyncio.create_task(publish_with_description())
        finally:
            self._processing = False

    def _process_stream_data(
        self,
        mode: str,
        data: Any,
        session_id: str = None,
        seen_live_endpoints: set = None,
    ) -> dict:
        """Process individual stream data chunks"""
        if mode == "custom":
            event_name = data.get("name", "")
            if event_name in ("browser_session_started", "browser_session_ended"):
                payload = data.get("data", {})
                live_ep = payload.get("live_endpoint")
                browser_id = payload.get("browser_session_id")

                # Deduplicate: skip if we already sent this session this turn
                dedup_key = browser_id or live_ep
                if seen_live_endpoints is not None and dedup_key:
                    if dedup_key in seen_live_endpoints:
                        return {}
                    seen_live_endpoints.add(dedup_key)

                return {
                    "type": "browser_session",
                    "status": payload.get("status"),
                    "live_endpoint": live_ep,
                    "browser_session_id": payload.get("browser_session_id"),
                    "url_lifetime": payload.get("url_lifetime"),
                    "viewport": payload.get("viewport"),
                }
            if event_name in ("browser_control_paused", "browser_control_resumed"):
                payload = data.get("data", {})
                return {
                    "type": "browser_control",
                    "status": "paused"
                    if event_name == "browser_control_paused"
                    else "resumed",
                    "lock_id": payload.get("lock_id"),
                }
            # Canvas state emitted from awrap_tool_call via stream writer
            if data.get("type") == "canvas_state" and "canvases" in data:
                return data
            return {}

        if mode == "updates" and "agent" in data:
            messages = data["agent"]["messages"][0]
            if isinstance(messages, AIMessage):
                tool_content = []
                # Handle both list and string content
                content_list = (
                    messages.content if isinstance(messages.content, list) else []
                )
                for message in content_list:
                    # Skip if message is not a dict (e.g., string content)
                    if not isinstance(message, dict):
                        continue
                    if is_tool_call(message):
                        # Skip the batch tool_update for canvas tools — the
                        # canvas_stream_parser emits granular tool_updates instead.
                        tool_name = message.get("name")
                        if tool_name in CANVAS_TOOL_NAMES:
                            continue
                        try:
                            content = (
                                json.loads(message.get("input", ""))
                                if message.get("input", None)
                                else {}
                            )
                        except json.JSONDecodeError:
                            content = message.get("input", "")
                        tool_content.append(
                            {
                                "type": "tool",
                                "id": get_tool_call_id(message),
                                "tool_name": tool_name,
                                "tool_start": True,
                                "tool_update": True,
                                "content": content,
                                "error": False,
                            }
                        )
                return tool_content
        # Canvas state updates are now emitted via the custom stream writer
        # in awrap_tool_call, so no detection needed here.

        if mode == "updates" and "__interrupt__" in data:
            # Handle multiple interrupts - return all of them
            interrupts = data["__interrupt__"]
            if len(interrupts) == 1:
                return {"type": "interrupt", "content": interrupts[0].value}
            else:
                # Return multiple interrupts as a list
                return [
                    {"type": "interrupt", "content": intr.value} for intr in interrupts
                ]
        elif mode == "messages":
            chunk, metadata = data
            if chunk.response_metadata.get("stopReason") == "end_turn":
                return {}

            if not chunk.content:
                return {}

            if isinstance(chunk, ToolMessage):
                # Clean up canvas streaming state
                if session_id and chunk.name in CANVAS_TOOL_NAMES:
                    self._canvas_parser.stop_tracking(session_id)
                try:
                    # content may already be a parsed object (e.g. list of image blocks)
                    if isinstance(chunk.content, (list, dict)):
                        content = chunk.content
                    else:
                        content = json.loads(chunk.content) if chunk.content else {}
                except json.JSONDecodeError:
                    content = chunk.content
                # DEBUG: Log raw tool response for debugging
                content_type = type(content).__name__
                is_list = isinstance(content, list)
                has_df = (
                    is_list
                    and any(
                        isinstance(b, dict) and "__dataframe__" in b for b in content
                    )
                    if is_list
                    else False
                )
                logger.debug(
                    f"[TOOL_RESPONSE] tool={chunk.name} id={chunk.tool_call_id} "
                    f"content_type={content_type} is_list={is_list} has_dataframe={has_df} "
                    f"raw_content_preview={str(content)[:500]}"
                )
                result = {
                    "type": "tool",
                    "tool_name": chunk.name,
                    "id": chunk.tool_call_id,
                    "tool_start": False,
                    "content": content,
                    "error": chunk.status == "error",
                }
                # Include metadata (e.g. canvas snapshots) when present
                _rm = getattr(chunk, "response_metadata", None)
                if _rm:
                    result["metadata"] = _rm
                return result

            # Handle empty content (reasoning chunks)
            if not chunk.content or (
                isinstance(chunk.content, str) and not chunk.content.strip()
            ):
                return {}

            content = (
                chunk.content[0]
                if isinstance(chunk.content, list)
                else {"type": "text", "text": chunk.content}
            )
            msg_type = content.get("type")

            # Handle tool calls (Bedrock format)
            if is_tool_call(content) and content.get("name"):
                tool_id = get_tool_call_id(content)
                tool_name = content.get("name")
                tool_start_event = {
                    "type": "tool",
                    "id": tool_id,
                    "tool_name": tool_name,
                    "tool_start": True,
                }
                # Include tool input when available (e.g. canvas tool args)
                raw_input = content.get("input")
                if raw_input:
                    try:
                        tool_start_event["content"] = (
                            json.loads(raw_input)
                            if isinstance(raw_input, str)
                            else raw_input
                        )
                    except (json.JSONDecodeError, TypeError):
                        tool_start_event["content"] = raw_input

                # Start tracking canvas tool streaming for both create and update
                if tool_name in CANVAS_TOOL_NAMES and session_id:
                    self._canvas_parser.start_tracking(session_id, tool_id, tool_name)
                return tool_start_event

            # Stream partial tool call input chunks for canvas tools
            if is_tool_call(content) and not content.get("name"):
                raw_input = content.get("input", "")
                if session_id and self._canvas_parser.is_tracking(session_id):
                    result = self._canvas_parser.process_chunk(session_id, raw_input)
                    if result:
                        return result
                return {}
            elif msg_type == "text":
                text_content = content.get("text", "")
                # Check for citations in the content (Claude native citations)
                # Citation chunks may arrive with empty text — check citations first
                citations = content.get("citations")
                if citations:
                    citation_markers = build_citation_markers(citations)
                    if text_content:
                        return {
                            "type": "text",
                            "content": text_content + " " + citation_markers,
                        }
                    return {"type": "text", "content": citation_markers}
                # Skip completely empty text chunks
                if not text_content:
                    return {}
                return {"type": "text", "content": text_content}
            elif msg_type == "reasoning_content":
                # Bedrock format
                return {
                    "type": "think",
                    "content": (content.get("reasoning_content") or {}).get("text", ""),
                }

        return {}


async def _thread_streaming_body(
    handler_instance: "StreamingHandler",
    session_id: str,
    user_id: str,
    thread_id: str,
    prompt: str,
    model_id: Optional[str],
):
    """Run a thread-mode turn against the LangGraph agent and yield stream chunks.

    Mirrors the minimum of handle_streaming_request: checkpoint targeting,
    cancellation cleanup, and end-of-stream bookkeeping. Skips attachments,
    project context, KB indexing, and interrupt resume — threads are plain
    text sub-conversations with a blacklist of disallowed tools.
    """
    # Rate-limit: only one stream (main or thread) in-flight at a time.
    if handler_instance._processing:
        yield stream_error_chunk(
            "rate_limit",
            "Agent is currently processing another request. Please wait for it to complete.",
        )
        yield {"end": True}
        return

    cleanup_finished_tasks()
    stream_key = thread_stream_key(session_id, thread_id)
    thread_graph_id = thread_graph_id_for(session_id, thread_id)

    global _current_tasks, _active_streams
    current_task = asyncio.current_task()
    _current_tasks[stream_key] = current_task

    handler_instance._processing = True

    response_buffer: list = []
    cancelled = False
    tool_messages: list = []
    token_stats: dict = {}
    seen_text_content = False
    seen_live_endpoints: set = set()
    agent = None

    _active_streams[stream_key] = StreamState(
        queue=Queue(),
        chunks=[],
        user_message=prompt,
        started_at=time.time(),
        completed=False,
        error=None,
    )

    try:
        # Validate model_id if caller provided one; otherwise ride default.
        if model_id is not None:
            from config import validate_model_id, ALLOWED_MODELS

            if not validate_model_id(model_id):
                yield stream_error_chunk(
                    "validation_error",
                    f"Invalid model_id: {model_id}. Allowed models: {ALLOWED_MODELS}",
                    {"allowed_models": ALLOWED_MODELS},
                )
                yield {"end": True}
                return

        # Default budget for threads = 2 (medium effort). budget_level=0 omits
        # the `thinking` field entirely for adaptive-reasoning models, which
        # causes them to emit inline <thinking> XML in text chunks instead of
        # separate reasoning_content blocks.
        agent = await agent_manager.get_agent(
            budget_level=2,
            model_id=model_id,
            agent_mode="normal",
            user_id=user_id,
        )

        tmp_msg = {"messages": [{"role": "user", "content": prompt}]}

        # Threads start with NO optional tools enabled. We only re-enable the
        # project tools below when the parent session is bound to a project.
        # Core tools (fetch_skill, manage_skill, execute_code, etc.) are not
        # in OPTIONAL_TOOL_NAMES so they remain always-available.
        allowed_optional: list[str] = []

        # Inherit the parent session's project binding so threads share the
        # project's KB, memory, files, and preferences. Without this, a thread
        # spawned from a project-bound chat would have no knowledge of the
        # project it's discussing.
        project_id = ""
        project_name = ""
        project_description = ""
        project_files: list = []
        project_data_files: list = []
        project_canvases: list = []
        project_preferences = ""
        try:
            from chat_history_service import chat_history_service

            project_id = await chat_history_service.get_project_id(session_id) or ""
        except Exception as e:
            logger.warning(f"Thread: failed to resolve parent project (non-fatal): {e}")

        if project_id:
            try:
                from project_context import get_project_context
                from project_preference_loader import get_project_preferences

                proj_ctx = await get_project_context(project_id, user_id)
                if proj_ctx:
                    project_name = proj_ctx.name
                    project_description = proj_ctx.description
                    project_files = proj_ctx.filenames
                    project_data_files = proj_ctx.data_files
                    project_canvases = proj_ctx.canvases
                    project_preferences = await get_project_preferences(
                        project_id, user_id
                    )
                    for tool_name in (
                        "search_project_knowledge_base",
                        "recall_project_memory",
                    ):
                        if tool_name not in allowed_optional:
                            allowed_optional.append(tool_name)
                    if (
                        proj_ctx.filenames or proj_ctx.data_files
                    ) and "load_project_file" not in allowed_optional:
                        allowed_optional.append("load_project_file")
                    if (
                        project_canvases
                        and "load_project_canvas" not in allowed_optional
                    ):
                        allowed_optional.append("load_project_canvas")
                else:
                    # Couldn't verify ownership — drop the binding rather than
                    # leaking across projects.
                    project_id = ""
            except Exception as e:
                logger.warning(
                    f"Thread: failed to hydrate project context (non-fatal): {e}"
                )
                project_id = ""

        async for stream_part in agent.astream(
            tmp_msg,
            {
                "configurable": {
                    "thread_id": thread_graph_id,
                    "actor_id": user_id,
                },
                "recursion_limit": 200,
            },
            stream_mode=["messages", "updates", "custom"],
            version="v2",
            context=SparkyContext(
                user_id=user_id or "",
                session_id=session_id or "",
                enabled_tools=allowed_optional,
                disabled_tools=list(THREAD_DISABLED_TOOLS),
                model_id=model_id,
                thread_mode=True,
                project_id=project_id,
                project_name=project_name,
                project_description=project_description,
                project_files=project_files,
                project_data_files=project_data_files,
                project_canvases=project_canvases,
                project_preferences=project_preferences,
            ),
        ):
            mode = stream_part["type"]
            data = stream_part["data"]

            if mode == "messages":
                chunk = data[0]
                if isinstance(chunk, AIMessageChunk) and chunk.usage_metadata:
                    u = chunk.usage_metadata
                    details = u.get("input_token_details", {})
                    token_stats["input_tokens"] = token_stats.get("input_tokens", 0) + (
                        u.get("input_tokens") or 0
                    )
                    token_stats["output_tokens"] = token_stats.get(
                        "output_tokens", 0
                    ) + (u.get("output_tokens") or 0)
                    token_stats["cache_creation_input_tokens"] = token_stats.get(
                        "cache_creation_input_tokens", 0
                    ) + (details.get("cache_creation") or 0)
                    token_stats["cache_read_input_tokens"] = token_stats.get(
                        "cache_read_input_tokens", 0
                    ) + (details.get("cache_read") or 0)

            chunk_data = handler_instance._process_stream_data(
                mode, data, session_id, seen_live_endpoints
            )
            if chunk_data:
                if (
                    not seen_text_content
                    and isinstance(chunk_data, dict)
                    and chunk_data.get("type") == "text"
                ):
                    stripped = chunk_data["content"].lstrip("\n")
                    if not stripped:
                        continue
                    chunk_data = {**chunk_data, "content": stripped}
                    seen_text_content = True
                elif isinstance(chunk_data, dict) and chunk_data.get("type") in (
                    "text",
                    "think",
                ):
                    seen_text_content = True

                if isinstance(chunk_data, list):
                    for chunk in chunk_data:
                        yield chunk
                        if stream_key in _active_streams:
                            _active_streams[stream_key]["chunks"].append(chunk)
                            await _active_streams[stream_key]["queue"].put(chunk)
                else:
                    yield chunk_data
                    if stream_key in _active_streams:
                        _active_streams[stream_key]["chunks"].append(chunk_data)
                        await _active_streams[stream_key]["queue"].put(chunk_data)

            if mode == "messages":
                if (
                    isinstance(data[0], AIMessageChunk)
                    and len(data[0].content) > 0
                    and is_tool_call(data[0].content[0])
                    and not get_tool_call_id(data[0].content[0])
                ):
                    continue
                else:
                    response_buffer.append(data[0])

    except asyncio.CancelledError:
        logger.debug(f"Thread stream cancelled: {stream_key}")
        cancelled = True
        try:
            # Reuse main-chat cancellation logic by passing the thread's
            # LangGraph thread_id as `session_id` — the only thing
            # handle_cancellation does with it is route the state write.
            tool_messages = await handle_cancellation(
                response_buffer,
                session_id=thread_graph_id,
                agent=agent,
                user_id=user_id,
                agent_manager=agent_manager,
            )
        except Exception as e:
            logger.error(f"Thread cancellation cleanup failed: {e}")

    except Exception as e:
        log_error(e)
        yield stream_error_chunk(
            "agent_error", "An internal error occurred. Please try again."
        )

    finally:
        if stream_key in _current_tasks:
            del _current_tasks[stream_key]

        if stream_key in _active_streams:
            stream_state = _active_streams[stream_key]
            stream_state["completed"] = True
            if cancelled:
                stream_state["error"] = "Stream cancelled by user"
            await stream_state["queue"].put({"end": True})

        if cancelled:
            for tool_msg in tool_messages:
                yield tool_msg

        end_marker: dict = {"end": True, "thread_id": thread_id}
        if token_stats:
            end_marker["token_stats"] = token_stats
        try:
            if agent and user_id:
                final_config = {
                    "configurable": {
                        "thread_id": thread_graph_id,
                        "actor_id": user_id,
                    }
                }
                final_state = await agent.aget_state(final_config)
                cp_id = (
                    final_state.config.get("configurable", {}).get("checkpoint_id")
                    if final_state and final_state.config
                    else None
                )
                if cp_id:
                    end_marker["checkpoint_id"] = cp_id
        except Exception as e:
            logger.debug(f"Could not fetch thread checkpoint_id for end marker: {e}")

        yield end_marker

        await asyncio.sleep(0.1)
        if stream_key in _active_streams:
            del _active_streams[stream_key]

        handler_instance._processing = False


# Global streaming handler instance
streaming_handler = StreamingHandler()
