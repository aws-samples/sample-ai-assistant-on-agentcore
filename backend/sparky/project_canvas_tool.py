"""
Tool for loading a saved canvas artifact from the current project.

`project_id` is injected by SparkyMiddleware.awrap_tool_call — the LLM never supplies it.
"""

from langchain_core.tools import tool

from utils import logger


@tool
async def load_project_canvas(canvas_id: str, project_id: str = "") -> str:
    """Load a saved canvas artifact from the current project.

    Use this tool when the user asks you to view or reference a canvas that was
    previously saved to the project. The canvas is read-only — if the user wants
    to edit it, create a new canvas in this session.

    Args:
        canvas_id: The ID of the canvas to load (shown in the project panel).
        project_id: Injected automatically — do not supply this argument.
    """
    if not project_id:
        return '{"error": "No project is bound to this session."}'

    try:
        import json as _json
        from project_canvas_service import get_canvas_content

        content = await get_canvas_content(project_id, canvas_id)
        if content is None:
            return _json.dumps(
                {"error": f"Canvas {canvas_id!r} not found in this project."}
            )
        # Enforce size limit (100 MB)
        MAX_CANVAS_SIZE = 100 * 1024 * 1024
        if len(content.encode("utf-8", errors="replace")) > MAX_CANVAS_SIZE:
            return _json.dumps({"error": "Canvas content is too large to load."})
        return content
    except Exception as e:
        import json as _json

        logger.error(f"load_project_canvas failed: {e}")
        return _json.dumps({"error": "Failed to load canvas."})
