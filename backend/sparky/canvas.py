"""Canvas tools for creating and updating rich-text documents alongside chat.

Provides per-type creation tools and a single update_canvas tool.  Each
creation tool encodes the canvas type in its name so the streaming parser
knows the type at tool_start — no partial-JSON metadata extraction needed.

Each tool returns metadata-only responses (no content restatement) with an
internal ``_snapshot`` field that the middleware strips before the LLM sees
it and stores as ToolMessage metadata.
"""

import json
import re
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
            "The exact text to find in the canvas. "
            "Use a short, distinctive phrase (5–15 words) that appears exactly once. "
            "Do not include leading/trailing whitespace or newline characters. "
            "Whitespace differences (newlines vs spaces) are handled automatically."
        ),
    )
    new_text: str = Field(
        ...,
        description="The text to substitute in place of old_text.",
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


# Single-char-to-single-char normalization table (preserves string positions).
# Applied to both old_text and canvas content before matching so that
# typographic variants (em dashes, curly quotes, etc.) don't cause mismatches
# regardless of whether the model or the editor produced them.
_CHAR_NORM = str.maketrans(
    {
        "\u2018": "'",  # left single quote  → '
        "\u2019": "'",  # right single quote → '
        "\u201c": '"',  # left double quote  → "
        "\u201d": '"',  # right double quote → "
        "\u2013": "-",  # en dash            → -
        "\u2014": "-",  # em dash            → -
        "\u2026": ".",  # ellipsis           → .
        "\u00a0": " ",  # non-breaking space → space
        "\u00b7": ".",  # middle dot         → .
    }
)


def _normalize_chars(text: str) -> str:
    """Normalize typographic characters to ASCII equivalents."""
    return text.translate(_CHAR_NORM)


def _build_search_pattern(old_text: str) -> str:
    """Convert plain old_text to a whitespace-flexible regex pattern.

    Normalizes typographic characters, splits on whitespace, escapes each
    token, and rejoins with \\s+ so the pattern matches regardless of spacing
    style or typographic character variants.
    """
    normalized = _normalize_chars(old_text.strip())
    tokens = re.split(r"\s+", normalized)
    return r"\s+".join(re.escape(t) for t in tokens if t)


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
        "Pass plain text in old_text — no regex syntax needed."
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

    # Apply each change sequentially
    matched_ranges = []
    current_content = latest_content
    for i, change in enumerate(changes):
        if not change.old_text or not change.old_text.strip():
            raise ToolException(f"Change {i + 1}: old_text is empty")

        pattern = _build_search_pattern(change.old_text)

        # Search against a char-normalized copy so typographic variants
        # (em dashes, curly quotes, non-breaking spaces) don't cause mismatches.
        # Since _normalize_chars is char-for-char, positions align with original.
        normalized_content = _normalize_chars(current_content)

        try:
            matches = list(re.finditer(pattern, normalized_content))
        except re.error as e:
            raise ToolException(f"Change {i + 1}: failed to build search pattern: {e}")

        if len(matches) > 1:
            raise ToolException(
                f"Change {i + 1}: old_text matched {len(matches)} locations. "
                f"Provide a longer, more distinctive old_text to match exactly one location."
            )

        match = matches[0] if matches else None
        if match is None:
            # Try to find the first distinctive word to give useful diagnostics.
            first_tokens = [
                t
                for t in re.split(r"\s+", _normalize_chars(change.old_text.strip()))
                if t
            ]
            if first_tokens:
                partial = re.search(re.escape(first_tokens[0]), normalized_content)
                if partial:
                    ctx_start = max(0, partial.start() - 10)
                    ctx_end = min(len(normalized_content), partial.end() + 120)
                    snippet = repr(normalized_content[ctx_start:ctx_end])
                    raise ToolException(
                        f"Change {i + 1}: first word found but full phrase didn't match. "
                        f"Content near '{first_tokens[0]}': {snippet}. "
                        f"Adjust old_text to match exactly what appears there."
                    )
                raise ToolException(
                    f"Change {i + 1}: '{first_tokens[0]}' not found in canvas — "
                    f"check that old_text matches the current canvas content exactly."
                )
            raise ToolException(f"Change {i + 1}: old_text did not match any content")

        start_line = current_content[: match.start()].count("\n") + 1
        end_line = current_content[: match.end()].count("\n") + 1
        matched_ranges.append(f"{start_line}-{end_line}")
        # Apply replacement to the original (non-normalized) content at matched positions.
        current_content = (
            current_content[: match.start()]
            + change.new_text
            + current_content[match.end() :]
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
