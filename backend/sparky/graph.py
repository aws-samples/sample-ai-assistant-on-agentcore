import asyncio
import json
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import (
    Annotated,
    Callable,
    List,
    Optional,
)
from typing_extensions import TypedDict
from langchain_core.messages import (
    AIMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_aws import ChatBedrockConverse
from langchain_aws.middleware import BedrockPromptCachingMiddleware
from langchain_core.tools import BaseTool
from langchain.agents import create_agent
from langchain.agents.middleware import (
    AgentMiddleware,
    ClearToolUsesEdit,
    ContextEditingMiddleware,
    ModelRequest,
)
from langchain.agents.middleware.types import ModelResponse
from langchain.tools.tool_node import ToolCallRequest
from langgraph.graph import MessagesState
from langgraph.types import Command
from langgraph_checkpoint_aws.async_saver import AsyncBedrockSessionSaver

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


class CanvasVersion(TypedDict):
    """A snapshot of a canvas's content at a point in time."""

    version_id: str
    content: str
    tool_call_id: str
    timestamp: str  # ISO 8601
    edited_by: str  # "agent" or "user"


class Canvas(TypedDict):
    """A canvas with its version history."""

    id: str
    name: str
    type: str  # "document", "html", "code", "diagram", "svg", "mermaid", "react"
    latest_version_id: str
    versions: dict[str, CanvasVersion]


def canvases_reducer(
    existing: dict[str, Canvas],
    updates: dict[str, Canvas],
) -> dict[str, Canvas]:
    """Merge canvas state updates into existing state.

    - Preserves canvases not referenced in the update.
    - Adds new canvases as-is.
    - For existing canvases, shallow-merges the versions dicts and
      overwrites top-level fields (name, latest_version_id) from the update.
    """
    result = {**existing}
    for canvas_id, update in updates.items():
        if canvas_id in result:
            old = result[canvas_id]
            merged_versions = {**old["versions"], **update["versions"]}
            result[canvas_id] = {**old, **update, "versions": merged_versions}
        else:
            result[canvas_id] = update
    return result


@dataclass
class SparkyContext:
    """Runtime context passed via the `context` argument to invoke/stream."""

    user_id: str = ""
    session_id: str = ""
    enabled_tools: List[str] = field(default_factory=list)
    disabled_tools: List[str] = field(default_factory=list)
    model_id: Optional[str] = None
    project_id: str = ""
    project_name: str = ""
    project_description: str = ""
    project_files: List[str] = field(default_factory=list)
    project_data_files: List[str] = field(default_factory=list)
    project_canvases: List[dict] = field(default_factory=list)
    project_preferences: str = ""
    # Thread (side-conversation) mode — when True, skip canvas guidance, skip
    # project-memory ingestion, skip KB indexing. Thread state lives under a
    # distinct checkpoint_ns.
    thread_mode: bool = False


class SparkyState(MessagesState):
    """Extended graph state with optional browser session tracking and canvas state."""

    browser_session_id: Optional[str] = None
    canvases: Annotated[dict[str, Canvas], canvases_reducer] = {}


async def _ingest_to_project_memory(
    user_id: str,
    project_id: str,
    session_id: str,
    last_human_msg: Optional[HumanMessage],
    response,
) -> None:
    """Fire-and-forget: save the current turn's human + final AI message to AgentCore Memory."""
    try:
        from config import memory_store as _s
        from project_memory_tool import composite_actor_id
        from kb_event_publisher import extract_text_content

        if not _s:
            return

        # actor_id = composite_actor_id → namespace "projects/{actorId}"
        # session_id tags which session produced the memory; retrieval searches across all sessions
        ns = (composite_actor_id(user_id, project_id), session_id)

        puts = []
        if last_human_msg is not None:
            puts.append(
                asyncio.to_thread(
                    _s.put,
                    ns,
                    str(uuid.uuid4()),
                    {
                        "message": HumanMessage(
                            content=extract_text_content(last_human_msg.content)
                        )
                    },
                )
            )

        # Save final AIMessage only — skip intermediate tool-calling steps.
        # ModelResponse.result is list[BaseMessage]; fall back to [response] for bare AIMessage
        result_msgs = getattr(response, "result", [response])
        ai_msg = next(
            (m for m in reversed(result_msgs) if isinstance(m, AIMessage)), None
        )
        if ai_msg is not None and not getattr(ai_msg, "tool_calls", None):
            ai_text = extract_text_content(ai_msg.content)
            if ai_text:
                puts.append(
                    asyncio.to_thread(
                        _s.put,
                        ns,
                        str(uuid.uuid4()),
                        {"message": AIMessage(content=ai_text)},
                    )
                )

        if puts:
            results = await asyncio.gather(*puts, return_exceptions=True)
            for r in results:
                if isinstance(r, Exception):
                    logger.warning(f"Project memory: failed to store message: {r}")
            logger.debug(
                "Project memory: stored %d message(s)",
                sum(1 for r in results if not isinstance(r, Exception)),
            )
    except asyncio.CancelledError:
        logger.debug("Project memory: ingestion task cancelled")
        raise
    except Exception as e:
        logger.warning(f"Project memory: ingestion failed: {e}")


# Strong references to fire-and-forget tasks — prevents GC collection before completion.
_MAX_BACKGROUND_TASKS = 50
_background_tasks: set = set()


CANVAS_TOOL_NAMES = {
    "create_document",
    "create_html_canvas",
    "create_code_canvas",
    "create_diagram",
    "create_svg",
    "create_mermaid",
    "update_canvas",
}


# Tools unavailable inside a Thread (side-conversation) run.
# Threads are lightweight sub-conversations anchored to a span of an AI message
# and must not touch canvases, the browser, or project-canvas persistence.
# Tools forbidden inside a Thread (side-conversation). Threads can still
# READ project canvases via load_project_canvas — only the mutating tools
# (create/update) are blocked, so a thread never alters the parent's canvas.
THREAD_DISABLED_TOOLS: set[str] = CANVAS_TOOL_NAMES | {"browse_web"}


class CanvasMiddleware(AgentMiddleware):
    """Inject canvas context into the model request without persisting to state.

    Uses ``awrap_model_call`` so the canvas context message is only visible to
    the model — it never gets written to the checkpointer or streamed to the
    frontend.  On each model call this middleware:

    1. Reads canvas data from the graph state ``canvases`` field.
    2. Appends the latest version content of each canvas to the system prompt.
    3. If no canvases exist in state, passes through unchanged.
    """

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], ModelResponse],
    ) -> ModelResponse:
        # Read canvas data directly from graph state
        state_canvases = request.state.get("canvases", {})

        if not state_canvases:
            return await handler(request)

        # Build canvas context from state and append to system prompt
        context_parts = [
            "\n\n[Canvas Context — Single Source of Truth]\n"
            "The content below is the CURRENT state of each canvas. "
            "It reflects the latest version including any user edits. "
            "When referencing or updating a canvas, always use this as the authoritative content — "
            "ignore any versions that may appear in the conversation history."
        ]
        for cid, canvas in state_canvases.items():
            latest = canvas["versions"][canvas["latest_version_id"]]
            context_parts.append(
                f"\n## Canvas: {canvas.get('name', '')} (ID: {cid})\n{latest['content']}"
            )

        canvas_context = "\n".join(context_parts)

        # Append to system prompt
        system_message = request.system_message
        if system_message is not None:
            if isinstance(system_message.content, list):
                system_message = SystemMessage(
                    content=[
                        *system_message.content,
                        {"type": "text", "text": canvas_context},
                    ]
                )
            elif isinstance(system_message.content, str):
                system_message = SystemMessage(
                    content=system_message.content + canvas_context
                )
        else:
            system_message = SystemMessage(content=canvas_context)

        return await handler(request.override(system_message=system_message))


def create_react_agent(
    model: ChatBedrockConverse,
    tools: Optional[List[BaseTool]],
    prompt: SystemMessage,
    checkpointer: Optional[AsyncBedrockSessionSaver] = None,
    optional_tool_names: Optional[List[str]] = None,
    additional_middleware: Optional[List[AgentMiddleware]] = None,
):
    """Create a React agent and return the compiled graph"""
    from utils import filter_conversation_images

    _tools = tools or []
    _optional_tool_names = set(optional_tool_names or [])

    class SparkyMiddleware(AgentMiddleware):
        """Middleware for message preprocessing, dynamic tool selection, and tool execution."""

        async def awrap_model_call(
            self,
            request: ModelRequest,
            handler: Callable[[ModelRequest], ModelResponse],
        ) -> ModelResponse:
            """Preprocess messages and dynamically select tools before each model call."""

            # --- Message preprocessing (dedup, image filtering, empty-input patching) ---
            raw_messages = list(request.messages)

            # Deduplicate ToolMessages by tool_call_id (keep first occurrence)
            seen_tool_call_ids: set = set()
            deduped_messages: list = []
            for msg in raw_messages:
                if isinstance(msg, ToolMessage):
                    if msg.tool_call_id in seen_tool_call_ids:
                        logger.warning(
                            f"Dropping duplicate ToolMessage for tool_call_id: {msg.tool_call_id}"
                        )
                        continue
                    seen_tool_call_ids.add(msg.tool_call_id)
                deduped_messages.append(msg)

            # Filter older images from conversation history
            filtered_messages = filter_conversation_images(deduped_messages)

            # Bedrock rejects tool_use blocks with empty input — patch any that
            # were cleared by ClearToolUsesEdit with a placeholder object.
            for msg in filtered_messages:
                if isinstance(msg, AIMessage) and isinstance(msg.content, list):
                    for block in msg.content:
                        if (
                            isinstance(block, dict)
                            and block.get("type") == "tool_use"
                            and not block.get("input")
                        ):
                            block["input"] = {"cleared": True}
                if isinstance(msg, AIMessage) and hasattr(msg, "tool_calls"):
                    for tc in msg.tool_calls:
                        if not tc.get("args"):
                            tc["args"] = {"cleared": True}

            # Bedrock requires every tool_use to have a matching tool_result in
            # the next message. When a stream is cancelled mid-tool-call, the
            # checkpoint may contain an AIMessage with tool_use blocks but no
            # corresponding ToolMessages. Synthesize placeholder ToolMessages
            # for any orphaned tool calls so Bedrock doesn't reject the request.
            answered_tool_ids: set = set()
            for msg in filtered_messages:
                if isinstance(msg, ToolMessage) and msg.tool_call_id:
                    answered_tool_ids.add(msg.tool_call_id)

            repaired_messages: list = []
            for msg in filtered_messages:
                repaired_messages.append(msg)
                if isinstance(msg, AIMessage) and hasattr(msg, "tool_calls"):
                    orphaned = [
                        tc
                        for tc in msg.tool_calls
                        if tc.get("id") and tc["id"] not in answered_tool_ids
                    ]
                    for tc in orphaned:
                        logger.warning(
                            f"Synthesizing placeholder ToolMessage for orphaned "
                            f"tool_call_id: {tc['id']}"
                        )
                        repaired_messages.append(
                            ToolMessage(
                                content=json.dumps(
                                    {
                                        "error": "Tool call was cancelled before completion."
                                    }
                                ),
                                name=tc.get("name", "unknown"),
                                tool_call_id=tc["id"],
                                status="error",
                            )
                        )
            filtered_messages = repaired_messages

            # --- Dynamic tool selection based on enabled_tools from runtime context ---
            ctx = (
                request.runtime.context
                if request.runtime and request.runtime.context
                else SparkyContext()
            )
            enabled_tools = set(ctx.enabled_tools or [])
            disabled_tools = set(ctx.disabled_tools or [])
            # Only include optional tools that are explicitly enabled;
            # then strip anything in the runtime blacklist (used by Thread mode
            # to remove canvas/browser/project-canvas tools).
            active_tools = [
                t
                for t in _tools
                if (t.name not in _optional_tool_names or t.name in enabled_tools)
                and t.name not in disabled_tools
            ]

            # Strip non-standard content blocks (e.g. cachePoint) from the system
            # message so downstream middleware like TodoListMiddleware doesn't
            # propagate them to Bedrock which rejects unsupported block types.
            system_message = request.system_message
            if system_message is not None and isinstance(system_message.content, list):
                filtered_content = [
                    block
                    for block in system_message.content
                    if not (
                        isinstance(block, dict) and block.get("type") == "non_standard"
                    )
                ]
                if len(filtered_content) != len(system_message.content):
                    system_message = SystemMessage(content=filtered_content)

            # Inject canvas guidance when canvas tools are enabled
            from canvas import CANVAS_CREATION_TOOL_IDS
            from prompt import build_canvas_guidance

            enabled_canvas = enabled_tools & CANVAS_CREATION_TOOL_IDS
            if enabled_canvas and system_message is not None:
                canvas_guidance = build_canvas_guidance(enabled_canvas)
                if canvas_guidance:
                    canvas_block = {"type": "text", "text": canvas_guidance}
                    if isinstance(system_message.content, list):
                        system_message = SystemMessage(
                            content=[*system_message.content, canvas_block]
                        )
                    elif isinstance(system_message.content, str):
                        system_message = SystemMessage(
                            content=system_message.content + canvas_guidance
                        )

            # Inject browser guidance when browser tool is enabled
            browser_enabled = "browser" in enabled_tools
            if browser_enabled and system_message is not None:
                from prompt import BROWSER_GUIDANCE

                browser_block = {"type": "text", "text": BROWSER_GUIDANCE}
                if isinstance(system_message.content, list):
                    system_message = SystemMessage(
                        content=[*system_message.content, browser_block]
                    )
                elif isinstance(system_message.content, str):
                    system_message = SystemMessage(
                        content=system_message.content + BROWSER_GUIDANCE
                    )

            # Inject user preferences when project is bound and preferences exist
            if ctx.project_preferences and system_message is not None:
                pref_block = {
                    "type": "text",
                    "text": (
                        f"\n\n[Your preferences for this project]\n"
                        f"{ctx.project_preferences}"
                    ),
                }
                if isinstance(system_message.content, list):
                    system_message = SystemMessage(
                        content=[*system_message.content, pref_block]
                    )
                elif isinstance(system_message.content, str):
                    system_message = SystemMessage(
                        content=system_message.content
                        + f"\n\n[Your preferences for this project]\n"
                        + ctx.project_preferences
                    )

            # Inject project context when project tools are enabled
            if (
                "search_project_knowledge_base" in enabled_tools
                and system_message is not None
            ):
                project_name = ctx.project_name or "the current project"
                project_guidance = f'\n\n[Project — "{project_name}"]\n'
                if ctx.project_description:
                    project_guidance += f"Description: {ctx.project_description}\n"

                if ctx.project_files:
                    files_list = "\n".join(f"  - {f}" for f in ctx.project_files)
                    project_guidance += (
                        f"\nIndexed documents (searchable via `search_project_knowledge_base`, loadable via `load_project_file`):\n{files_list}\n"
                        "Use `search_project_knowledge_base` to retrieve relevant passages. "
                        "You can filter to a specific file with the `filename_filter` argument. "
                        "Use `load_project_file` to load the full file into the Code Interpreter when you need to process it directly. "
                        "Always cite the source filename in your response.\n"
                    )

                if ctx.project_data_files:
                    data_list = "\n".join(f"  - {f}" for f in ctx.project_data_files)
                    project_guidance += (
                        f"\nData files (loadable via `load_project_file`):\n{data_list}\n"
                        "Use `load_project_file` to load any of these files into the Code Interpreter, "
                        "then use `execute_code` to analyse them with Python.\n"
                    )

                if "recall_project_memory" in enabled_tools:
                    project_guidance += (
                        "\nUse `recall_project_memory` to retrieve insights and decisions "
                        "stored from past sessions in this project. Call it proactively "
                        "when the user's question may benefit from prior context.\n"
                    )

                if ctx.project_canvases:
                    canvas_list = "\n".join(
                        f"  - {c['name']} [canvas_id={c['canvas_id']}] ({c['type']})"
                        for c in ctx.project_canvases
                    )
                    project_guidance += (
                        f"\nSaved canvas artifacts (loadable via `load_project_canvas`):\n{canvas_list}\n"
                        "Use `load_project_canvas` with the canvas_id to retrieve and display the content. "
                        "These are read-only — if the user wants to edit, create a new canvas in this session.\n"
                    )

                project_block = {"type": "text", "text": project_guidance}
                if isinstance(system_message.content, list):
                    system_message = SystemMessage(
                        content=[*system_message.content, project_block]
                    )
                elif isinstance(system_message.content, str):
                    system_message = SystemMessage(
                        content=system_message.content + project_guidance
                    )

            response = await handler(
                request.override(
                    messages=filtered_messages,
                    tools=active_tools,
                    system_message=system_message,
                )
            )

            # Project memory ingestion — fire-and-forget, never blocks the response.
            # Skip in thread mode: thread turns are side-conversations and should
            # not pollute project long-term memory.
            from config import memory_store as _memory_store

            if (
                _memory_store
                and ctx.project_id
                and ctx.user_id
                and not ctx.thread_mode
            ):
                last_human_msg = (
                    filtered_messages[-1]
                    if filtered_messages
                    and isinstance(filtered_messages[-1], HumanMessage)
                    else None
                )
                if len(_background_tasks) >= _MAX_BACKGROUND_TASKS:
                    logger.warning(
                        f"Background task limit ({_MAX_BACKGROUND_TASKS}) reached, skipping memory ingestion"
                    )
                else:
                    task = asyncio.create_task(
                        _ingest_to_project_memory(
                            ctx.user_id,
                            ctx.project_id,
                            ctx.session_id,
                            last_human_msg,
                            response,
                        )
                    )
                    _background_tasks.add(task)
                    task.add_done_callback(_background_tasks.discard)

            return response

        async def awrap_tool_call(
            self,
            request: ToolCallRequest,
            handler: Callable[[ToolCallRequest], ToolMessage | Command],
        ) -> ToolMessage | Command:
            """Wrap tool invocations: missing-tool guard, tool_call_id injection, canvas snapshots."""
            tools_by_name = {tool.name: tool for tool in _tools}
            tool_name = request.tool_call["name"]
            tool_call_id = request.tool_call["id"]

            # Handle missing tool — framework doesn't provide a user-friendly message
            if tool_name not in tools_by_name:
                logger.warning(
                    f"Tool '{tool_name}' not found in available tools: {list(tools_by_name.keys())}"
                )
                return ToolMessage(
                    content=json.dumps(
                        {
                            "error": f"Tool '{tool_name}' is not available. "
                            f"Available tools: {list(tools_by_name.keys())}"
                        }
                    ),
                    name=tool_name,
                    status="error",
                    tool_call_id=tool_call_id,
                )

            # Inject tool_call_id into arguments so tools can reference their own call
            modified_args = dict(request.tool_call["args"])
            modified_args["tool_call_id"] = tool_call_id

            # Inject project_id and user_id so the LLM never supplies them
            if tool_name in (
                "search_project_knowledge_base",
                "load_project_file",
                "recall_project_memory",
                "load_project_canvas",
            ):
                tool_ctx = (
                    request.runtime.context
                    if request.runtime and request.runtime.context
                    else SparkyContext()
                )
                modified_args["project_id"] = tool_ctx.project_id or ""
                if tool_name in ("load_project_file", "recall_project_memory"):
                    modified_args["user_id"] = tool_ctx.user_id or ""

            request.tool_call = {**request.tool_call, "args": modified_args}

            # Delegate to framework handler (handles ToolException, wrapping, etc.)
            try:
                result = await handler(request)
            except Exception as e:
                logger.error(
                    f"Tool '{tool_name}' raised an unexpected error: {e}", exc_info=True
                )
                return ToolMessage(
                    content=json.dumps({"error": f"Tool execution failed: {str(e)}"}),
                    name=tool_name,
                    status="error",
                    tool_call_id=tool_call_id,
                )

            # For canvas tools, split the result into a pointer-only ToolMessage
            # and a canvases state update so content lives in graph state, not messages.
            if isinstance(result, ToolMessage) and tool_name in CANVAS_TOOL_NAMES:
                try:
                    content = result.content
                    data = (
                        json.loads(content)
                        if isinstance(content, str)
                        else content
                        if isinstance(content, dict)
                        else None
                    )
                    snapshot_content = (
                        data.pop("_snapshot", None) if data is not None else None
                    )

                    if snapshot_content is not None and data.get("status") != "error":
                        version_id = str(uuid.uuid4())
                        canvas_id = data.get("canvas_id", "")
                        canvas_name = data.get("title", "")

                        # Build pointer-only ToolMessage (no canvas content)
                        pointer = {
                            "canvas_id": canvas_id,
                            "version_id": version_id,
                            "status": data.get("status", "created"),
                        }
                        if "matched_lines" in data:
                            pointer["matched_lines"] = data["matched_lines"]

                        pointer_msg = ToolMessage(
                            content=json.dumps(pointer),
                            name=tool_name,
                            tool_call_id=tool_call_id,
                            status=result.status,
                        )

                        # Build canvases state update with full content
                        now = datetime.now(timezone.utc).isoformat()
                        from canvas import CANVAS_TYPE_BY_TOOL

                        canvas_entry: dict = {
                            "id": canvas_id,
                            "name": canvas_name,
                            "latest_version_id": version_id,
                            "versions": {
                                version_id: {
                                    "version_id": version_id,
                                    "content": snapshot_content,
                                    "tool_call_id": tool_call_id,
                                    "timestamp": now,
                                    "edited_by": "agent",
                                }
                            },
                        }
                        # Include canvas type so the streaming event carries it to the frontend.
                        # For create tools, derive from the tool name. For update_canvas,
                        # use the type from the tool result or fall back to "document".
                        if tool_name in CANVAS_TYPE_BY_TOOL:
                            canvas_entry["type"] = CANVAS_TYPE_BY_TOOL[tool_name]
                        else:
                            canvas_entry["type"] = data.get("type", "document")
                        canvas_update: dict[str, Canvas] = {canvas_id: canvas_entry}

                        # Emit canvas state to the frontend via the custom stream
                        # so it arrives reliably regardless of updates mode structure.
                        try:
                            from langgraph.config import get_stream_writer

                            writer = get_stream_writer()
                            writer(
                                {
                                    "type": "canvas_state",
                                    "canvases": canvas_update,
                                }
                            )
                        except Exception:
                            pass

                        return Command(
                            update={
                                "messages": [pointer_msg],
                                "canvases": canvas_update,
                            }
                        )
                except (json.JSONDecodeError, AttributeError, TypeError):
                    logger.warning(
                        "Failed to split canvas tool result into pointer + state"
                    )

            return result

    middleware_list = [
        BedrockPromptCachingMiddleware(),
        SparkyMiddleware(),
        CanvasMiddleware(),
        ContextEditingMiddleware(
            edits=[
                ClearToolUsesEdit(
                    trigger=180000,
                    clear_at_least=50000,
                    keep=5,
                    clear_tool_inputs=True,
                    exclude_tools=[
                        "generate_download_link",
                        "write_todos",
                        "retrieve_images",
                    ],
                )
            ]
        ),
    ]
    if additional_middleware:
        middleware_list.extend(additional_middleware)

    graph = create_agent(
        model,
        _tools,
        system_prompt=prompt,
        state_schema=SparkyState,
        checkpointer=checkpointer,
        middleware=middleware_list,
        context_schema=SparkyContext,
    )
    return graph
