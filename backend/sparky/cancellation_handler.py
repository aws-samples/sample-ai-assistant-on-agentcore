"""Stream cancellation handling — builds cleaned message state after user cancels a stream."""

import asyncio
import logging
from langchain_core.messages import AIMessage, AIMessageChunk, ToolMessage

logger = logging.getLogger(__name__)

# Set to hold references to background cancellation tasks, preventing GC
_background_cancel_tasks: set = set()


def is_tool_call(content_item: dict) -> bool:
    """Check if content item is a tool call (Bedrock format)."""
    return isinstance(content_item, dict) and content_item.get("type") == "tool_use"


def get_tool_call_id(content_item: dict) -> str | None:
    """Get tool call ID from Bedrock format."""
    if isinstance(content_item, dict) and content_item.get("type") == "tool_use":
        return content_item.get("id")
    return content_item.get("id") if isinstance(content_item, dict) else None


async def handle_cancellation(
    response_buffer: list,
    session_id: str,
    agent=None,
    user_id: str = None,
    agent_manager=None,
) -> list:
    """Handle stream cancellation and update agent state.

    Returns a list of tool-message dicts to yield to the frontend.
    """
    logger.debug(f"Handling cancellation for session: {session_id}")
    tool_messages: list[dict] = []

    cancel_agent = agent or (agent_manager.cached_agent if agent_manager else None)
    if not cancel_agent or not response_buffer:
        return []

    try:
        completed_tool_ids = {
            msg.tool_call_id for msg in response_buffer if isinstance(msg, ToolMessage)
        }

        pending_tool_calls_dict: dict = {}

        for i, element in enumerate(response_buffer):
            if not isinstance(element, AIMessageChunk):
                continue

            if hasattr(element, "tool_calls") and element.tool_calls:
                for tool_call in element.tool_calls:
                    _id = tool_call.get("id")
                    _name = tool_call.get("name")
                    if (
                        _id
                        and _id not in completed_tool_ids
                        and _id not in pending_tool_calls_dict
                    ):
                        pending_tool_calls_dict[_id] = {
                            "id": _id,
                            "name": _name,
                            "chunk": element,
                            "chunk_index": i,
                        }
            elif element.content:
                content_list = (
                    element.content if isinstance(element.content, list) else []
                )
                for content_item in content_list:
                    if is_tool_call(content_item):
                        _id = get_tool_call_id(content_item)
                        _name = content_item.get("name")
                        if (
                            _id
                            and _id not in completed_tool_ids
                            and _id not in pending_tool_calls_dict
                        ):
                            pending_tool_calls_dict[_id] = {
                                "id": _id,
                                "name": _name,
                                "chunk": element,
                                "chunk_index": i,
                            }

        pending_tool_calls = list(pending_tool_calls_dict.values())

        if pending_tool_calls:
            logger.debug(
                f"Found {len(pending_tool_calls)} unique pending tool calls to cancel"
            )
            chunks_to_update: dict = {}

            for tool_info in pending_tool_calls:
                _id = tool_info["id"]
                _name = tool_info["name"]
                chunk_index = tool_info["chunk_index"]

                if chunk_index not in chunks_to_update:
                    chunks_to_update[chunk_index] = {
                        "chunk": tool_info["chunk"],
                        "cancelled_tools": [],
                    }
                chunks_to_update[chunk_index]["cancelled_tools"].append(
                    {"id": _id, "name": _name}
                )

                response_buffer.append(
                    ToolMessage(
                        tool_call_id=_id,
                        name=_name,
                        status="error",
                        content='{"response": "Tool invocation cancelled by user"}',
                    )
                )
                tool_messages.append(
                    {
                        "type": "tool",
                        "tool_name": _name,
                        "id": _id,
                        "tool_start": False,
                        "content": '{"response": "Tool invocation cancelled by user"}',
                        "error": True,
                    }
                )

            for chunk_index, update_info in chunks_to_update.items():
                original_chunk = update_info["chunk"]
                cancelled_tools = update_info["cancelled_tools"]
                cancelled_content = []
                cancelled_tool_calls = []

                for idx, tool in enumerate(cancelled_tools):
                    cancelled_content.append(
                        {
                            "type": "tool_use",
                            "name": tool["name"],
                            "id": tool["id"],
                            "input": {"cancelled": True},
                            "index": idx + 1,
                        }
                    )
                    cancelled_tool_calls.append(
                        {
                            "name": tool["name"],
                            "args": {"cancelled": True},
                            "id": tool["id"],
                            "type": "tool_call",
                        }
                    )

                response_buffer[chunk_index] = AIMessageChunk(
                    content=cancelled_content,
                    tool_calls=cancelled_tool_calls,
                    response_metadata={"stopReason": "tool_use"},
                    id=original_chunk.id,
                )
        else:
            # Handle non-tool cancellations (reasoning content, etc.)
            last_element = response_buffer[-1] if response_buffer else None
            if isinstance(last_element, AIMessageChunk) and last_element.content:
                if (
                    isinstance(last_element.content, list)
                    and len(last_element.content) > 0
                ):
                    first_content = last_element.content[0]
                    content_type = (
                        first_content.get("type")
                        if isinstance(first_content, dict)
                        else None
                    )
                    if content_type == "reasoning_content":
                        _id = last_element.id
                        index = first_content.get("index", 10) + 1
                        response_buffer.append(
                            AIMessageChunk(
                                content=[
                                    {"type": "text", "text": "[empty]", "index": index}
                                ],
                                id=_id,
                            )
                        )
                        logger.debug(f"Adding cancellation message for {content_type}")

        # Combine consecutive AIMessageChunk objects
        combined_messages = _combine_and_validate(response_buffer)

        _task = asyncio.create_task(
            cancel_agent.aupdate_state(
                config={"configurable": {"thread_id": session_id, "actor_id": user_id}},
                values={"messages": combined_messages},
            )
        )
        # Store task reference to prevent GC before completion
        _background_cancel_tasks.add(_task)
        _task.add_done_callback(_background_cancel_tasks.discard)

        return tool_messages if tool_messages else []

    except Exception as e:
        logger.error(f"Error updating agent state during cancellation: {str(e)}")
        import traceback as tb

        logger.error(f"Traceback: {tb.format_exc()}")
        return []


# ---------------------------------------------------------------------------
# Helpers for combining / validating message buffers
# ---------------------------------------------------------------------------


def _combine_and_validate(response_buffer: list) -> list:
    """Combine consecutive AIMessageChunks and validate tool message consistency."""
    combined_messages = []
    current_ai_chunk: list = []

    for msg in response_buffer:
        if isinstance(msg, AIMessageChunk):
            current_ai_chunk.append(msg)
        else:
            if current_ai_chunk:
                combined_messages.append(_combine_ai_chunks(current_ai_chunk))
                current_ai_chunk = []
            combined_messages.append(msg)

    if current_ai_chunk:
        combined_messages.append(_combine_ai_chunks(current_ai_chunk))

    return _validate_tool_message_consistency(combined_messages)


def _combine_ai_chunks(chunks: list) -> AIMessageChunk:
    """Safely combine AIMessageChunk objects, deduplicating tool calls by ID."""
    if len(chunks) == 1:
        return chunks[0]

    all_tool_calls: list = []
    seen_tool_ids: set = set()
    all_content: list = []
    response_metadata: dict = {}
    chunk_id = chunks[0].id if chunks else None

    for chunk in chunks:
        if hasattr(chunk, "tool_calls") and chunk.tool_calls:
            for tool_call in chunk.tool_calls:
                tool_id = tool_call.get("id")
                if tool_id and tool_id not in seen_tool_ids:
                    all_tool_calls.append(tool_call)
                    seen_tool_ids.add(tool_id)

        if chunk.content:
            if isinstance(chunk.content, list):
                for item in chunk.content:
                    if is_tool_call(item):
                        tid = get_tool_call_id(item)
                        if tid and tid not in seen_tool_ids:
                            all_content.append(item)
                            seen_tool_ids.add(tid)
                    else:
                        all_content.append(item)
            elif isinstance(chunk.content, str):
                all_content.append(chunk.content)

        if hasattr(chunk, "response_metadata") and chunk.response_metadata:
            response_metadata.update(chunk.response_metadata)

    # Smart merge
    if not all_content:
        all_content = ""
    elif all(isinstance(c, str) for c in all_content):
        all_content = "".join(all_content)
    elif all(isinstance(c, dict) for c in all_content):
        all_content = _merge_dict_content(all_content, seen_tool_ids)

    return AIMessageChunk(
        content=all_content,
        tool_calls=all_tool_calls,
        response_metadata=response_metadata,
        id=chunk_id,
    )


def _merge_dict_content(content_items: list, seen_tool_ids: set) -> list:
    """Merge consecutive text-type dict items while preserving other types."""
    merged: list = []
    text_buffer: list[str] = []

    def flush():
        nonlocal text_buffer
        if text_buffer:
            merged_text = "".join(text_buffer)
            if merged_text:
                merged.append({"type": "text", "text": merged_text})
            text_buffer = []

    for item in content_items:
        if not isinstance(item, dict):
            flush()
            merged.append(item)
            continue
        if item.get("type") == "text":
            if item.get("citations"):
                flush()
                merged.append(item)
            else:
                text_buffer.append(item.get("text", ""))
        else:
            flush()
            merged.append(item)

    flush()
    return merged if merged else ""


def _validate_tool_message_consistency(messages: list) -> list:
    """Ensure tool_use blocks and ToolMessages are consistent."""
    cleaned: list = []
    tool_use_map: dict = {}
    tool_result_ids: set = set()

    for msg in messages:
        if isinstance(msg, (AIMessage, AIMessageChunk)) and msg.content:
            valid_content = []
            content_list = (
                msg.content if isinstance(msg.content, list) else [msg.content]
            )
            for item in content_list:
                if is_tool_call(item):
                    tid = get_tool_call_id(item)
                    if tid and "input" in item:
                        valid_content.append(item)
                        tool_use_map[tid] = (len(cleaned), item.get("name"))
                    else:
                        logger.warning(f"Skipping incomplete tool_use block: {item}")
                else:
                    valid_content.append(item)

            if valid_content:
                cls = AIMessageChunk if isinstance(msg, AIMessageChunk) else AIMessage
                cleaned.append(
                    cls(
                        content=valid_content,
                        tool_calls=msg.tool_calls if hasattr(msg, "tool_calls") else [],
                        response_metadata=msg.response_metadata,
                        id=msg.id,
                    )
                )
        elif isinstance(msg, ToolMessage):
            if msg.tool_call_id not in tool_result_ids:
                tool_result_ids.add(msg.tool_call_id)
                cleaned.append(msg)
            else:
                logger.warning(
                    f"Skipping duplicate ToolMessage for tool_call_id: {msg.tool_call_id}"
                )
        else:
            cleaned.append(msg)

    # Add synthetic ToolMessages for orphaned tool_use blocks
    missing = set(tool_use_map.keys()) - tool_result_ids
    if missing:
        logger.debug(
            f"Adding synthetic ToolMessages for orphaned tool_use blocks: {missing}"
        )
        synthetics = []
        for tid in missing:
            idx, name = tool_use_map[tid]
            synthetics.append(
                (
                    idx + 1,
                    ToolMessage(
                        tool_call_id=tid,
                        name=name,
                        status="error",
                        content='{"response": "Tool execution was cancelled or interrupted"}',
                    ),
                )
            )
        synthetics.sort(key=lambda x: x[0], reverse=True)
        for insert_idx, synth in synthetics:
            if insert_idx <= len(cleaned):
                cleaned.insert(insert_idx, synth)
            else:
                cleaned.append(synth)

    return cleaned
