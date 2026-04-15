from utils import logger
import time
import random
import string
import json
import base64
import io
import math
from langchain_core.messages import ToolMessage, HumanMessage, AIMessage

# Thumbnail settings
THUMBNAIL_MAX_SIZE = (150, 150)  # Max width/height for thumbnails


def _sanitize_for_json(obj):
    """
    Recursively sanitize a Python object to ensure it's JSON-serializable.
    Handles NaN, Infinity, numpy types, and other non-serializable values.
    """
    if obj is None:
        return None
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    if isinstance(obj, int):
        return obj
    if isinstance(obj, str):
        return obj
    if isinstance(obj, dict):
        return {str(k): _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(item) for item in obj]
    # Fallback: convert to string for any unknown types (numpy, etc.)
    try:
        # Try to convert numpy-like numeric types
        return (
            float(obj)
            if not math.isnan(float(obj)) and not math.isinf(float(obj))
            else None
        )
    except (TypeError, ValueError):
        return str(obj)


def _create_image_thumbnail(base64_data: str, media_type: str) -> str:
    """
    Create a lower resolution thumbnail from base64 image data.

    Args:
        base64_data: Base64 encoded image data
        media_type: MIME type of the image (e.g., "image/png")

    Returns:
        Base64 encoded thumbnail image data
    """
    try:
        from PIL import Image

        # Decode base64 to bytes
        image_bytes = base64.b64decode(base64_data)

        # Open image with PIL
        image = Image.open(io.BytesIO(image_bytes))

        # Create thumbnail (maintains aspect ratio)
        image.thumbnail(THUMBNAIL_MAX_SIZE, Image.Resampling.LANCZOS)

        # Convert back to bytes
        output_buffer = io.BytesIO()

        # Determine format from media type
        format_map = {
            "image/jpeg": "JPEG",
            "image/png": "PNG",
            "image/gif": "GIF",
            "image/webp": "WEBP",
        }
        output_format = format_map.get(media_type, "PNG")

        # Save with reduced quality for smaller size
        if output_format == "JPEG":
            image.save(output_buffer, format=output_format, quality=70, optimize=True)
        else:
            image.save(output_buffer, format=output_format, optimize=True)

        # Encode back to base64
        output_buffer.seek(0)
        return base64.b64encode(output_buffer.read()).decode("utf-8")

    except ImportError:
        logger.warning("PIL not available, returning original image data")
        return base64_data
    except Exception as e:
        logger.warning(f"Failed to create thumbnail: {e}, returning original")
        return base64_data


def _build_citation_markers(citations: list) -> str:
    """Build citation markers without text (for citation-only blocks)."""
    if not citations:
        return ""

    markers = []
    for idx, cite in enumerate(citations):
        doc_title = cite.get("title", "Document")
        location = cite.get("location", {})
        doc_page = location.get("document_page", {})
        start_page = doc_page.get("start")
        end_page = doc_page.get("end")

        if start_page is not None and end_page is not None:
            if start_page == end_page:
                page_str = f"p.{start_page}"
            else:
                page_str = f"pp.{start_page}-{end_page}"
        elif start_page is not None:
            page_str = f"p.{start_page}"
        else:
            page_str = ""

        source_text = ""
        source_content = cite.get("source_content", [])
        if source_content and len(source_content) > 0:
            full_text = source_content[0].get("text", "")
            source_text = " ".join(full_text.split())[:100]
            if len(full_text) > 100:
                source_text += "..."
            source_text = source_text.replace('"', "&quot;")

        markers.append(
            f'<cite data-doc="{doc_title}" data-pages="{page_str}" data-text="{source_text}">[{idx + 1}]</cite> '
        )

    return "".join(markers)


def _inject_citation_tags(text: str, citations: list) -> str:
    """
    Prepend citation markers to text based on Claude's citation format.
    Includes document title, page numbers, and source text preview.

    Claude citations have this structure:
    {
        "title": "document_name",
        "source_content": [{"text": "..."}],
        "location": {
            "document_page": {
                "document_index": 0,
                "start": 21,  # page number
                "end": 22     # page number
            }
        }
    }
    """
    if not citations or not text:
        return text

    # Build citation markers for each citation
    citation_markers = []
    for idx, cite in enumerate(citations):
        # Get document title
        doc_title = cite.get("title", "Document")

        # Get page info from location
        location = cite.get("location", {})
        doc_page = location.get("document_page", {})
        start_page = doc_page.get("start")
        end_page = doc_page.get("end")

        # Format page range
        if start_page is not None and end_page is not None:
            if start_page == end_page:
                page_str = f"p.{start_page}"
            else:
                page_str = f"pp.{start_page}-{end_page}"
        elif start_page is not None:
            page_str = f"p.{start_page}"
        else:
            page_str = ""

        # Get source text preview (first 100 chars)
        source_text = ""
        source_content = cite.get("source_content", [])
        if source_content and len(source_content) > 0:
            full_text = source_content[0].get("text", "")
            # Clean up whitespace and take first 100 chars
            source_text = " ".join(full_text.split())[:100]
            if len(full_text) > 100:
                source_text += "..."
            # Escape quotes for HTML attribute
            source_text = source_text.replace('"', "&quot;")

        # Create citation marker with all info
        citation_markers.append(
            f'<cite data-doc="{doc_title}" data-pages="{page_str}" data-text="{source_text}">[{idx + 1}]</cite> '
        )

    # Prepend citation markers, preserving any leading whitespace/newlines
    if citation_markers:
        # Find leading whitespace
        stripped = text.lstrip()
        leading_ws = text[: len(text) - len(stripped)]
        # Insert citation after leading whitespace (no extra space - text already has it)
        return leading_ws + "".join(citation_markers) + stripped

    return text


async def get_history(agent, id, user_id: str):
    if not agent:
        logger.error("No agent available for history retrieval")
        return None

    if not user_id:
        logger.error("No user_id provided for history retrieval")
        return None

    try:
        config = {"configurable": {"thread_id": id, "actor_id": user_id}}

        state = await agent.aget_state(config)

        if state and state.values:
            msg = state.values.get("messages", [])
            if msg:
                interrupt = None
                if hasattr(state, "tasks") and state.tasks:
                    for task in state.tasks:
                        if hasattr(task, "interrupts") and task.interrupts:
                            interrupt = task.interrupts[0].value
                            break

                # Build a map of turn_index → checkpoint_id by walking the
                # checkpoint history.  Each checkpoint stores the full message
                # list at that point; we count human messages to derive the
                # turn index.  History is returned newest-first, so we iterate
                # until we've covered all turns.
                turn_checkpoint_map = {}
                try:
                    total_turns = sum(
                        1 for m in msg if hasattr(m, "type") and m.type == "human"
                    )
                    seen_turns = set()
                    async for cp_tuple in agent.aget_state_history(config):
                        cp_msgs = cp_tuple.values.get("messages", [])
                        human_count = sum(
                            1
                            for m in cp_msgs
                            if hasattr(m, "type") and m.type == "human"
                        )
                        # This checkpoint represents the state after turn (human_count - 1)
                        turn_idx = human_count - 1
                        if turn_idx >= 0 and turn_idx not in seen_turns:
                            cp_id = cp_tuple.config.get("configurable", {}).get(
                                "checkpoint_id"
                            )
                            if cp_id:
                                turn_checkpoint_map[turn_idx] = cp_id
                                seen_turns.add(turn_idx)
                        if len(seen_turns) >= total_turns:
                            break
                except Exception as e:
                    logger.debug(f"Could not build turn checkpoint map: {e}")

                formatted_history = format_chat_for_frontend(
                    msg, interrupt, turn_checkpoint_map
                )
                canvases = state.values.get("canvases", {})
                return {"history": formatted_history, "canvases": canvases}

        return None
    except Exception as e:
        logger.error(f"Error fetching history for thread_id={id}: {e}")
        return None


def format_chat_for_frontend(
    backend_messages, interrupt=None, turn_checkpoint_map=None
):
    """
    Convert backend message format to frontend format.

    Args:
        backend_messages: List of message objects from backend (HumanMessages, AIMessages, ToolMessages)
        interrupt: Optional interrupt data to add at the end
        turn_checkpoint_map: Optional dict mapping turn_index to checkpoint_id for branching

    Returns:
        List of chatTurn objects for frontend consumption
    """
    chat_turns = []
    chat_turns = []
    current_turn = None
    current_turn_token_stats = {}
    turn_index = -1
    if turn_checkpoint_map is None:
        turn_checkpoint_map = {}

    def generate_turn_id():
        timestamp = int(time.time() * 1000)
        random_suffix = "".join(
            random.choices(string.ascii_lowercase + string.digits, k=9)  # nosec B311
        )
        return f"turn_{timestamp}_{random_suffix}"

    def _make_end_marker(turn_idx, token_stats):
        marker = {"end": True}
        cp_id = turn_checkpoint_map.get(turn_idx)
        if cp_id:
            marker["checkpoint_id"] = cp_id
        if token_stats:
            marker["token_stats"] = token_stats
        return marker

    def _accumulate_usage(stats, message):
        u = getattr(message, "usage_metadata", None) or {}
        if not u:
            return stats
        details = u.get("input_token_details", {})
        return {
            "input_tokens": stats.get("input_tokens", 0) + (u.get("input_tokens") or 0),
            "output_tokens": stats.get("output_tokens", 0)
            + (u.get("output_tokens") or 0),
            "cache_creation_input_tokens": stats.get("cache_creation_input_tokens", 0)
            + (details.get("cache_creation") or 0),
            "cache_read_input_tokens": stats.get("cache_read_input_tokens", 0)
            + (details.get("cache_read") or 0),
        }

    for message in backend_messages:
        if getattr(message, "metadata", None) and message.metadata.get("sparky:hidden"):
            continue

        if isinstance(message, HumanMessage):
            # Start a new turn
            if current_turn:
                current_turn["aiMessage"].append(
                    _make_end_marker(turn_index, current_turn_token_stats)
                )
                chat_turns.append(current_turn)

            turn_index += 1
            current_turn_token_stats = {}

            # Extract user message and attachments from content
            user_message = ""
            attachments = []

            if message.content:
                if isinstance(message.content, str):
                    # Simple string content
                    user_message = message.content
                elif isinstance(message.content, list) and len(message.content) > 0:
                    # List format - multimodal content with text and attachments
                    import re

                    _spreadsheet_pattern = re.compile(
                        r"^\[Spreadsheet:\s+(.+?)\]\s+Columns:"
                    )
                    for content_item in message.content:
                        if isinstance(content_item, dict):
                            item_type = content_item.get("type", "")

                            if item_type == "text":
                                text_val = content_item.get("text", "")
                                # Check if this is a spreadsheet header block
                                match = _spreadsheet_pattern.match(text_val)
                                if match:
                                    filename = match.group(1)
                                    ext = (
                                        filename.rsplit(".", 1)[-1].lower()
                                        if "." in filename
                                        else ""
                                    )
                                    ext_to_mime = {
                                        "csv": "text/csv",
                                        "xls": "application/vnd.ms-excel",
                                        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                    }
                                    attachments.append(
                                        {
                                            "type": ext_to_mime.get(ext, "text/csv"),
                                            "name": filename,
                                        }
                                    )
                                else:
                                    # Regular text content - this is the user message
                                    user_message = text_val
                            elif item_type == "image":
                                # Image attachment - create thumbnail for history
                                source = content_item.get("source", {})
                                image_data = source.get("data", "")
                                thumbnail_data = _create_image_thumbnail(
                                    image_data, source.get("media_type", "image/png")
                                )
                                attachments.append(
                                    {
                                        "type": source.get("media_type", "image/png"),
                                        "data": thumbnail_data,
                                        "name": f"image_{len(attachments) + 1}",
                                        "is_thumbnail": True,
                                    }
                                )
                            elif item_type == "document" or "document" in content_item:
                                # Document attachment - handle both formats:
                                # 1. {"type": "document", "document": {...}} - Bedrock native format
                                # 2. {"type": "document", "source": {...}} - alternative format
                                doc = content_item.get("document", {})
                                if doc:
                                    # Native Bedrock document format
                                    doc_format = doc.get("format", "pdf")
                                    doc_name = doc.get(
                                        "name", f"document_{len(attachments) + 1}"
                                    )
                                else:
                                    # Alternative format with source
                                    doc_source = content_item.get("source", {})
                                    doc_format = "pdf"  # Default
                                    doc_name = content_item.get(
                                        "name", f"document_{len(attachments) + 1}"
                                    )

                                # Map format to proper MIME type
                                format_to_mime = {
                                    "pdf": "application/pdf",
                                    "txt": "text/plain",
                                    "csv": "text/csv",
                                    "html": "text/html",
                                    "md": "text/markdown",
                                    "doc": "application/msword",
                                    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                                    "xls": "application/vnd.ms-excel",
                                    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                                }
                                mime_type = format_to_mime.get(
                                    doc_format, f"application/{doc_format}"
                                )
                                attachments.append(
                                    {
                                        "type": mime_type,
                                        "name": doc_name,
                                        # No data field - just metadata for display
                                    }
                                )
                        elif isinstance(content_item, str):
                            # String item - treat as user message
                            user_message = content_item

                    # Fallback: if no text found, get the last item
                    if not user_message and len(message.content) > 0:
                        last_item = message.content[-1]
                        if isinstance(last_item, dict):
                            user_message = last_item.get("text", "")
                        elif isinstance(last_item, str):
                            user_message = last_item

                elif isinstance(message.content, dict):
                    # Dict format - extract text field
                    user_message = message.content.get("text", "")

            current_turn = {
                "id": generate_turn_id(),
                "userMessage": user_message,
                "aiMessage": [],
            }

            # Add attachments to the turn if present
            if attachments:
                current_turn["attachments"] = attachments

        elif isinstance(message, AIMessage):
            if not current_turn:
                # Handle case where AI message comes without user message
                current_turn = {
                    "id": generate_turn_id(),
                    "userMessage": "",
                    "aiMessage": [],
                }

            current_turn_token_stats = _accumulate_usage(
                current_turn_token_stats, message
            )

            # If content is a plain string, emit it as a single text block
            if isinstance(message.content, str):
                if message.content.strip():
                    current_turn["aiMessage"].append(
                        {"type": "text", "content": message.content}
                    )
                continue

            # Process each content item in the AIMessage
            emitted_tool_ids = set()
            for content_item in message.content:
                if content_item.get("type") == "reasoning_content":
                    # Bedrock format
                    current_turn["aiMessage"].append(
                        {
                            "type": "think",
                            "content": content_item["reasoning_content"].get(
                                "text", " "
                            ),
                        }
                    )
                elif content_item.get("type") == "tool_use":
                    tool_entry = {
                        "type": "tool",
                        "id": content_item["id"],
                        "tool_name": content_item["name"],
                        "tool_start": True,
                    }
                    # Include tool input/content if available (needed for charts, etc.)
                    if content_item.get("input"):
                        tool_input = content_item["input"]
                        # Parse JSON string if needed
                        if isinstance(tool_input, str):
                            try:
                                tool_entry["content"] = json.loads(tool_input)
                            except json.JSONDecodeError:
                                tool_entry["content"] = tool_input
                        else:
                            tool_entry["content"] = tool_input
                    current_turn["aiMessage"].append(tool_entry)
                    emitted_tool_ids.add(content_item["id"])
                else:
                    # Regular text content (may include citations)
                    # Don't strip - preserve original whitespace/newlines
                    text_content = content_item.get("text", "")
                    citations = content_item.get("citations", [])

                    # Handle citation-only blocks (empty text with citations)
                    if citations and not text_content.strip():
                        # Just add citation markers
                        citation_markers = _build_citation_markers(citations)
                        if (
                            current_turn["aiMessage"]
                            and current_turn["aiMessage"][-1].get("type") == "text"
                        ):
                            current_turn["aiMessage"][-1]["content"] += citation_markers
                        continue

                    if text_content.strip():  # Only add non-empty text
                        # Inject citation tags if citations present
                        if citations:
                            text_content = _inject_citation_tags(
                                text_content, citations
                            )

                        # Don't consolidate - send each text block separately like streaming does
                        # The frontend handles multiple text blocks correctly
                        text_entry = {"type": "text", "content": text_content}
                        current_turn["aiMessage"].append(text_entry)

            # Fallback: emit tool_start events from message.tool_calls for any
            # tool calls not already emitted via the content array.  LangChain
            # stores tool calls in .tool_calls; some providers don't duplicate
            # them as tool_use items in the content array.
            if hasattr(message, "tool_calls") and message.tool_calls:
                for tc in message.tool_calls:
                    tc_id = tc.get("id")
                    if tc_id and tc_id not in emitted_tool_ids:
                        tool_entry = {
                            "type": "tool",
                            "id": tc_id,
                            "tool_name": tc.get("name"),
                            "tool_start": True,
                        }
                        tc_args = tc.get("args")
                        if tc_args:
                            if isinstance(tc_args, str):
                                try:
                                    tool_entry["content"] = json.loads(tc_args)
                                except (json.JSONDecodeError, TypeError):
                                    tool_entry["content"] = tc_args
                            else:
                                tool_entry["content"] = tc_args
                        current_turn["aiMessage"].append(tool_entry)
                        emitted_tool_ids.add(tc_id)

        elif isinstance(message, ToolMessage):
            if current_turn:
                try:
                    # content may already be a parsed object (list/dict) from LangGraph
                    if isinstance(message.content, (list, dict)):
                        content = message.content
                    else:
                        content = json.loads(message.content)
                    # Sanitize to ensure JSON serializability (handles NaN, Infinity, numpy types)
                    content = _sanitize_for_json(content)
                    tool_entry = {
                        "type": "tool",
                        "id": message.tool_call_id,
                        "tool_name": message.name,
                        "tool_start": False,
                        "content": content,
                        "error": message.status == "error",
                    }
                    # Include response_metadata (e.g. canvas snapshots) when present
                    _rm = getattr(message, "response_metadata", None)
                    if _rm:
                        tool_entry["metadata"] = _rm
                    current_turn["aiMessage"].append(tool_entry)
                except Exception:
                    logger.debug("Unable to parse tool message content")
                    current_turn["aiMessage"].append(
                        {
                            "type": "tool",
                            "id": message.tool_call_id,
                            "tool_name": message.name,
                            "tool_start": False,
                            "content": str(message.content)
                            if not isinstance(message.content, str)
                            else message.content,
                        }
                    )

    # Handle the last turn
    if current_turn:
        # Add interrupt as final message if provided
        if interrupt:
            current_turn["aiMessage"].append(
                {"type": "interrupt", "content": interrupt}
            )
        else:
            current_turn["aiMessage"].append(
                _make_end_marker(turn_index, current_turn_token_stats)
            )
        chat_turns.append(current_turn)
    # Create a new turn for the interrupt if there's no current turn
    elif interrupt:
        chat_turns.append(
            {
                "id": generate_turn_id(),
                "userMessage": "",
                "aiMessage": [{"type": "interrupt", "content": interrupt}],
            }
        )

    return chat_turns
