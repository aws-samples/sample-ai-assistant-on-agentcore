from functools import wraps
import json
import logging
import traceback
from fastapi.responses import StreamingResponse, JSONResponse
from exceptions import MissingHeader
import hashlib
from typing import Any, Dict, List, Optional, AsyncGenerator
from graph import create_react_agent
from langgraph_checkpoint_aws.async_saver import AsyncBedrockSessionSaver
from langchain_aws import ChatBedrockConverse
from langchain_core.messages import BaseMessage
from prompt import system_prompt
from config import MAX_CONVERSATION_IMAGES
import inspect
import os

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)
REGION = os.environ.get("REGION", "us-east-1")

CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


def error_envelope(error_code: str, message: str, details: dict = None) -> JSONResponse:
    """Return an HTTP 200 JSONResponse with a structured error body."""
    body = {
        "type": "error",
        "error_code": error_code,
        "message": message,
    }
    if details is not None:
        body["details"] = details
    return JSONResponse(body, headers=CORS_HEADERS)


def stream_error_chunk(error_code: str, message: str, details: dict = None) -> dict:
    """Return a dict suitable for yielding as an SSE error chunk."""
    chunk = {
        "type": "error",
        "error_code": error_code,
        "message": message,
    }
    if details is not None:
        chunk["details"] = details
    return chunk


def filter_conversation_images(
    messages: List[BaseMessage],
    max_images: int = MAX_CONVERSATION_IMAGES,
) -> List[BaseMessage]:
    """Filter older image content blocks from conversation messages.

    Two-pass algorithm: count total images, then remove the oldest if over limit.
    Returns new message objects; does not mutate the input.
    """
    if max_images < 0:
        max_images = 0

    # Pass 1: count total image blocks
    total_images = 0
    for msg in messages:
        content = msg.content
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "image":
                total_images += 1

    if total_images <= max_images:
        return list(messages)

    images_to_remove = total_images - max_images

    # Pass 2: rebuild messages, skipping the oldest images
    removed = 0
    result = []
    for msg in messages:
        content = msg.content
        if not isinstance(content, list):
            result.append(msg.copy())
            continue

        new_content = []
        for block in content:
            if (
                isinstance(block, dict)
                and block.get("type") == "image"
                and removed < images_to_remove
            ):
                removed += 1
            else:
                new_content.append(block)

        if not new_content:
            # Replace image-only messages with a placeholder to preserve conversation structure
            new_content = [{"type": "text", "text": "[image removed]"}]

        new_msg = msg.model_copy()
        new_msg.content = new_content
        result.append(new_msg)

    return result


def extract_budget_level(input_data: Dict[str, Any]) -> Optional[int]:
    """Extract budget level from input data"""
    budget_level = input_data.get("budget_level")
    return int(budget_level) if budget_level is not None else None


def log_error(error: Exception, custom_message: str = None):
    """Log error as dictionary with error message and traceback details"""
    error_dict = {
        "error": custom_message or str(error),
        "details": traceback.format_exc(),
    }

    logger.error(json.dumps(error_dict, indent=2))


def _safe_json_dumps(obj):
    """JSON serialize with NaN/Infinity replaced by null."""
    import math

    def _clean(o):
        if isinstance(o, float):
            if math.isnan(o) or math.isinf(o):
                return None
            return o
        if isinstance(o, dict):
            return {k: _clean(v) for k, v in o.items()}
        if isinstance(o, (list, tuple)):
            return [_clean(v) for v in o]
        return o

    return json.dumps(_clean(obj))


def sse_stream(media_type: str = "text/event-stream"):
    """Optimized decorator that wraps yielded content with SSE formatting"""

    def decorator(func):
        @wraps(func)
        async def wrapper(*args, **kwargs):
            try:
                # Call the original function
                result = func(*args, **kwargs)

                # Check if it's a coroutine (async function)
                if inspect.iscoroutine(result):
                    result = await result

                # Check if it's a generator/async generator or a regular return value
                if inspect.isasyncgen(result) or inspect.isgenerator(result):
                    # Handle streaming response
                    async def sse_generator() -> AsyncGenerator[str, None]:
                        # Padding to defeat proxy/ALB buffering for small SSE messages.
                        # Some intermediaries buffer until ~4-8KB before flushing.
                        _PAD = " " * 2048
                        try:
                            async for item in result:
                                if isinstance(item, dict):
                                    line = f"data: {_safe_json_dumps(item)}\n\n"
                                    # Pad canvas_chunk events so proxies flush immediately
                                    if item.get("type") == "canvas_chunk":
                                        line = (
                                            f"data: {_safe_json_dumps(item)}{_PAD}\n\n"
                                        )
                                    yield line
                                elif isinstance(item, str):
                                    if item.startswith("data:"):
                                        yield item
                                    else:
                                        yield f"data: {item}\n\n"
                                else:
                                    yield f"data: {_safe_json_dumps(str(item))}\n\n"
                        except MissingHeader as e:
                            yield f"data: {_safe_json_dumps(stream_error_chunk('auth_error', e.detail))}\n\n"
                            yield f"data: {_safe_json_dumps({'end': True})}\n\n"
                        except Exception as e:
                            log_error(e)
                            yield f"data: {_safe_json_dumps(stream_error_chunk('internal_error', str(e)))}\n\n"
                            yield f"data: {_safe_json_dumps({'end': True})}\n\n"

                    return StreamingResponse(
                        sse_generator(),
                        media_type=media_type,
                        headers={
                            "Cache-Control": "no-cache",
                            "Connection": "keep-alive",
                            "X-Accel-Buffering": "no",
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "POST, OPTIONS",
                            "Access-Control-Allow-Headers": "*",
                        },
                    )
                else:
                    # Handle immediate JSON response
                    return JSONResponse(
                        content=result,
                        headers={
                            "Access-Control-Allow-Origin": "*",
                            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
                            "Access-Control-Allow-Headers": "*",
                        },
                    )

            except MissingHeader as e:
                return error_envelope("auth_error", e.detail)
            except Exception as e:
                log_error(e)
                return error_envelope("internal_error", "An unexpected error occurred")

        return wrapper

    return decorator


def get_tools_hash(tools: List) -> str:
    """Generate a hash for the current tool set to detect changes"""
    tool_names = sorted([f"{tool.__module__}.{tool.name}" for tool in tools])
    return hashlib.md5(str(tool_names).encode()).hexdigest()  # nosec B324


async def get_or_create_agent(
    all_available_tools: List,
    llm: ChatBedrockConverse,
    checkpointer: AsyncBedrockSessionSaver,
    boto_client,
    logger,
    # Global state parameters
    current_tools_hash,
    cached_agent,
    skills: List = None,
    public_skills: List = None,
    optional_tool_names: List[str] = None,
):
    """Get existing agent or create new one if tools changed"""

    # Use all available tools directly
    new_tools_hash = get_tools_hash(all_available_tools)

    # Check if we need to update
    needs_update = current_tools_hash != new_tools_hash or cached_agent is None

    if needs_update:
        logger.debug(
            f"Creating agent with tools: {[tool.name for tool in all_available_tools]}"
        )

        try:
            prompt = system_prompt(skills, public_skills=public_skills)

            # Create new agent
            new_agent = create_react_agent(
                model=llm,
                tools=all_available_tools,
                prompt=prompt,
                checkpointer=checkpointer,
                optional_tool_names=optional_tool_names,
            )

            logger.debug("Agent successfully created/updated")

            # Return the new agent and updated tools hash
            return (new_agent, new_tools_hash)

        except Exception as e:
            logger.error(f"Failed to create agent: {e}")
            raise e
    else:
        logger.debug("Reusing existing agent - tools unchanged")

        return (cached_agent, current_tools_hash)
