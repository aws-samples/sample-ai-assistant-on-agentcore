"""Canvas tools for creating and updating rich-text documents alongside chat.

Provides per-type creation tools and a single update_canvas tool.  Each
creation tool encodes the canvas type in its name so the streaming parser
knows the type at tool_start — no partial-JSON metadata extraction needed.

Each tool returns metadata-only responses (no content restatement) with an
internal ``_snapshot`` field that the middleware strips before the LLM sees
it and stores as ToolMessage metadata.
"""

import json
import random
import string

from pydantic import BaseModel, Field, model_validator
from langchain_core.tools import tool, ToolException
from langchain.tools import ToolRuntime


# Mapping from tool name → canvas type (used by streaming parser + frontend)
CANVAS_TYPE_BY_TOOL = {
    "create_document": "document",
    "create_html_canvas": "html",
    "create_code_canvas": "code",
    "create_diagram": "diagram",
    "create_svg": "svg",
    "create_mermaid": "mermaid",
}

# Set of canvas creation tool IDs (excludes update_canvas)
CANVAS_CREATION_TOOL_IDS = {
    "create_document",
    "create_html_canvas",
    "create_code_canvas",
    "create_diagram",
    "create_svg",
    "create_mermaid",
}


class CanvasChange(BaseModel):
    """A plain-text substitution to apply to canvas content."""

    old_text: str = Field(
        ...,
        description=(
            "The exact text to find in the canvas. Must match character-for-character — "
            "including punctuation, casing, and whitespace — as it appears in the "
            "[Canvas Context] block of your system prompt. Use a short, distinctive "
            "phrase (5–15 words)."
        ),
    )
    new_text: str = Field(
        ...,
        description="The text to substitute in place of old_text.",
    )
    match_all: bool = Field(
        default=False,
        description=(
            "When false (default), replace only the first occurrence of old_text. "
            "When true, replace every occurrence. Use true for renames or global "
            "substitutions; leave false for targeted single-location edits."
        ),
    )


class UpdateCanvasArgs(BaseModel):
    """Arguments for update_canvas."""

    canvas_id: str = Field(..., description="The ID of the canvas to update.")
    changes: list[CanvasChange] = Field(
        ...,
        min_length=1,
        max_length=5,
        description=(
            "List of plain-text substitutions to apply sequentially. "
            'Each item must be an object with "old_text" and "new_text" string fields. '
            'Example: [{"old_text": "Hello world", "new_text": "Hi there"}]'
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def coerce_changes(cls, values: dict) -> dict:
        """Accept changes as a JSON string in case the model serialises it that way."""
        raw = values.get("changes")
        if isinstance(raw, str):
            try:
                values["changes"] = json.loads(raw)
            except (json.JSONDecodeError, ValueError):
                pass
        return values


def generate_canvas_id(tool_call_id: str = "") -> str:
    """Derive a canvas ID from the tool_call_id (last 8 chars, lowercased).
    Falls back to random 8-char alphanumeric if no tool_call_id provided."""
    if tool_call_id and len(tool_call_id) >= 8:
        return tool_call_id[-8:].lower()
    chars = string.ascii_lowercase + string.digits
    return "".join(random.choices(chars, k=8))


async def _create_canvas_impl(
    canvas_type: str, title: str, content: str, language: str, tool_call_id: str
) -> dict:
    """Shared implementation for all create_* canvas tools."""
    canvas_id = generate_canvas_id(tool_call_id)
    result = {
        "canvas_id": canvas_id,
        "title": title,
        "type": canvas_type,
        "status": "created",
        "_snapshot": content,
    }
    if language:
        result["language"] = language
    return result


# ---------------------------------------------------------------------------
# Per-type creation tools
# ---------------------------------------------------------------------------


@tool(
    name_or_callable="create_document",
    description=(
        "Create a markdown rich-text canvas for articles, reports, proposals, "
        "emails, notes, and any structured prose."
    ),
)
async def create_document(title: str, content: str, tool_call_id: str = "") -> dict:
    return await _create_canvas_impl("document", title, content, "", tool_call_id)


@tool(
    name_or_callable="create_html_canvas",
    description=(
        "Create an HTML canvas with inline CSS and JavaScript that renders live. "
        "For anything visual, interactive, spatial, or explorable — simulations, "
        "games, animations, calculators, data visualizations, UI mockups."
    ),
)
async def create_html_canvas(title: str, content: str, tool_call_id: str = "") -> dict:
    return await _create_canvas_impl("html", title, content, "", tool_call_id)


@tool(
    name_or_callable="create_code_canvas",
    description=(
        "Create a source code canvas (any language, no preview — just a code editor)."
    ),
)
async def create_code_canvas(
    title: str, content: str, language: str = "", tool_call_id: str = ""
) -> dict:
    return await _create_canvas_impl("code", title, content, language, tool_call_id)


@tool(
    name_or_callable="create_diagram",
    description=(
        "Create a draw.io XML diagram canvas for architecture diagrams with "
        "cloud provider icons (AWS, Azure, GCP)."
    ),
)
async def create_diagram(title: str, content: str, tool_call_id: str = "") -> dict:
    return await _create_canvas_impl("diagram", title, content, "", tool_call_id)


@tool(
    name_or_callable="create_svg",
    description=(
        "Create an SVG canvas for custom vector graphics needing precise control. "
        "Use only when mermaid cannot express the visual."
    ),
)
async def create_svg(title: str, content: str, tool_call_id: str = "") -> dict:
    return await _create_canvas_impl("svg", title, content, "", tool_call_id)


@tool(
    name_or_callable="create_mermaid",
    description=(
        "Create a Mermaid diagram canvas. Preferred for structured diagrams: "
        "flowcharts, sequence, class, state, ER, Gantt, pie, mindmaps, timelines, "
        "user journeys, quadrant, requirement, gitgraph, C4, sankey, and block diagrams."
    ),
)
async def create_mermaid(title: str, content: str, tool_call_id: str = "") -> dict:
    return await _create_canvas_impl("mermaid", title, content, "", tool_call_id)


# All creation tools for easy import
ALL_CREATE_TOOLS = [
    create_document,
    create_html_canvas,
    create_code_canvas,
    create_diagram,
    create_svg,
    create_mermaid,
]


@tool(
    name_or_callable="update_canvas",
    description=(
        "Update specific parts of an existing canvas by finding exact text and replacing it. "
        "old_text must match the canvas content character-for-character (punctuation, casing, "
        "whitespace) and must appear exactly once — copy it verbatim from the [Canvas Context] "
        "block of your system prompt."
    ),
    args_schema=UpdateCanvasArgs,
)
async def update_canvas(
    canvas_id: str,
    changes: list[CanvasChange],
    runtime: ToolRuntime = None,
) -> dict:
    """Update an existing canvas by applying a list of plain-text substitutions."""
    # Read current canvas content from graph state (single source of truth)
    canvases = runtime.state.get("canvases", {}) if runtime else {}
    canvas = canvases.get(canvas_id)
    if canvas is None:
        raise ToolException(f"Canvas '{canvas_id}' not found in state")

    latest_version = canvas["versions"][canvas["latest_version_id"]]
    latest_content = latest_version["content"]

    # Apply each change sequentially — exact string match.
    # match_all=False (default) replaces the first occurrence; True replaces all.
    matched_ranges = []
    current_content = latest_content
    for i, change in enumerate(changes):
        if not change.old_text:
            raise ToolException(f"Change {i + 1}: old_text is empty")

        count = current_content.count(change.old_text)
        if count == 0:
            raise ToolException(
                f"Change {i + 1}: old_text not found. "
                f"Copy it character-for-character from the [Canvas Context] block in "
                f"your system prompt — including punctuation and whitespace."
            )

        if change.match_all:
            # Record the range of the first occurrence for reporting, then replace all.
            start = current_content.index(change.old_text)
            end = start + len(change.old_text)
            start_line = current_content[:start].count("\n") + 1
            end_line = current_content[:end].count("\n") + 1
            suffix = f" (+{count - 1} more)" if count > 1 else ""
            matched_ranges.append(f"{start_line}-{end_line}{suffix}")
            current_content = current_content.replace(change.old_text, change.new_text)
        else:
            start = current_content.index(change.old_text)
            end = start + len(change.old_text)
            start_line = current_content[:start].count("\n") + 1
            end_line = current_content[:end].count("\n") + 1
            matched_ranges.append(f"{start_line}-{end_line}")
            current_content = (
                current_content[:start] + change.new_text + current_content[end:]
            )

    return {
        "canvas_id": canvas_id,
        "title": canvas.get("name", ""),
        "status": "updated",
        "type": canvas.get("type", "document"),
        "matched_lines": matched_ranges
        if len(matched_ranges) > 1
        else matched_ranges[0],
        "_snapshot": current_content,
    }
