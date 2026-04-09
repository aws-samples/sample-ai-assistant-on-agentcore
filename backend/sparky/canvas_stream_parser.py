"""Canvas tool streaming — parses partial JSON from tool_call input chunks
to extract canvas content for real-time streaming to the frontend.

All events are emitted as tool_update dicts so the frontend handles canvas
streaming through the same tool lifecycle as every other tool:
  tool_start → tool_update* → tool_completion

Event shapes (all have type="tool", tool_update=True):
  canvas_event="meta"         — title, canvas_type, canvas_id, language
  canvas_event="chunk"        — text (partial content token)
  canvas_event="update_start" — canvas_id, pattern

Content decoding strategy:
  Once inside the JSON string value (after `"content": "` or `"replacement": "`),
  we accumulate the raw JSON-encoded string and use `json.loads` to decode the
  whole thing.  We diff against what was previously decoded to extract only the
  new text for each chunk event.  This avoids hand-rolled unescaping that breaks
  at chunk boundaries.
"""

import json
from typing import Any  # noqa: F401


def _tool_update(tool_id: str, tool_name: str, content: dict) -> dict:
    """Build a tool_update envelope for a canvas streaming event."""
    return {
        "type": "tool",
        "id": tool_id,
        "tool_name": tool_name,
        "tool_update": True,
        "content": content,
    }


def _try_decode_json_string(raw: str) -> str | None:
    """Try to decode a partial JSON string value.

    *raw* is the accumulated characters AFTER the opening `"` of a JSON string
    value (without the opening quote itself).  We wrap it as `"<raw>"` and try
    `json.loads`.  If the raw ends mid-escape the decode will fail — we then
    retry after trimming the trailing incomplete escape.
    """
    # Strip trailing `"}` or `"` that signal end-of-value / end-of-object
    s = raw
    if s.endswith('"}'):
        s = s[:-2]
    elif s.endswith('"'):
        s = s[:-1]

    # Fast path — try full decode
    try:
        return json.loads('"' + s + '"')
    except (json.JSONDecodeError, ValueError):
        pass

    # The string likely ends with an incomplete escape like `\` or `\u00`.
    # Trim characters from the end until it decodes.
    for trim in range(1, min(7, len(s) + 1)):
        try:
            return json.loads('"' + s[:-trim] + '"')
        except (json.JSONDecodeError, ValueError):
            continue

    return None


class CanvasStreamParser:
    """Per-session state machine for parsing canvas tool call input chunks."""

    def __init__(self):
        self._sessions: dict[str, dict] = {}

    def start_tracking(self, session_id: str, tool_id: str, tool_name: str) -> None:
        """Begin tracking a canvas tool call for a session."""
        from canvas import CANVAS_TYPE_BY_TOOL

        is_create = tool_name in CANVAS_TYPE_BY_TOOL
        canvas_type = CANVAS_TYPE_BY_TOOL.get(tool_name, "document")

        self._sessions[session_id] = {
            "tool_id": tool_id,
            "tool_name": tool_name,
            "is_create": is_create,
            "canvas_type": canvas_type,
            "accumulated": "",
            "content_started": False,
            "pattern_sent": False,
            "meta_sent": False,
            "raw_content": "",
            "decoded_len": 0,
            "content_key": ('"content": "' if is_create else '"new_text": "'),
        }

    def stop_tracking(self, session_id: str) -> None:
        """Stop tracking for a session (tool completed)."""
        self._sessions.pop(session_id, None)

    def is_tracking(self, session_id: str) -> bool:
        return session_id in self._sessions

    def process_chunk(self, session_id: str, raw_input: str) -> dict | list | None:
        """Process a partial tool call input chunk.

        Returns a tool_update dict, list of tool_update dicts, or None.
        """
        cs = self._sessions.get(session_id)
        if not cs or not raw_input or not isinstance(raw_input, str):
            return None

        cs["accumulated"] += raw_input
        events: list[dict] = []

        # --- For create tools: emit meta + start content as soon as "content": " is found ---
        if cs["is_create"] and not cs["content_started"]:
            content_key = cs["content_key"]
            idx = cs["accumulated"].find(content_key)
            if idx != -1:
                cs["content_started"] = True
                after_key = cs["accumulated"][idx + len(content_key) :]
                cs["raw_content"] = after_key

                # Emit meta immediately — type is known from tool name,
                # title is extracted from the pre-content region.
                if not cs["meta_sent"]:
                    meta_event = self._emit_meta(cs, cs["accumulated"][:idx])
                    events.append(meta_event)

                # Try to emit first content chunk
                chunk_event = self._emit_new_content(cs)
                if chunk_event:
                    events.append(chunk_event)

                return events if events else None
            else:
                # Content key not found yet — try to emit meta early if title is available
                if not cs["meta_sent"]:
                    title = _extract_json_string_value(cs["accumulated"], '"title": "')
                    if title:
                        events.append(self._emit_meta(cs, cs["accumulated"]))
                        return events[0] if len(events) == 1 else events
                return None

        # --- For update tools: emit update_start once replacement key is found ---
        if not cs["is_create"] and not cs["content_started"]:
            if not cs.get("pattern_sent"):
                replacement_idx = cs["accumulated"].find('"new_text": "')
                if replacement_idx != -1:
                    pattern_value = _extract_pattern_value(
                        cs["accumulated"], replacement_idx
                    )
                    canvas_id = _extract_json_string_value(
                        cs["accumulated"], '"canvas_id": "'
                    )
                    cs["pattern_sent"] = True

                    key = cs["content_key"]
                    idx = cs["accumulated"].find(key)
                    if idx != -1:
                        cs["content_started"] = True
                        after_key = cs["accumulated"][idx + len(key) :]
                        cs["raw_content"] = after_key

                    events.append(
                        _tool_update(
                            cs["tool_id"],
                            cs["tool_name"],
                            {
                                "canvas_event": "update_start",
                                "canvas_id": canvas_id,
                                "pattern": pattern_value,
                            },
                        )
                    )

                    if cs["content_started"]:
                        chunk_event = self._emit_new_content(cs)
                        if chunk_event:
                            events.append(chunk_event)

                    return events if events else None
            # Check if content key appeared
            key = cs["content_key"]
            idx = cs["accumulated"].find(key)
            if idx != -1:
                cs["content_started"] = True
                after_key = cs["accumulated"][idx + len(key) :]
                cs["raw_content"] = after_key
                chunk_event = self._emit_new_content(cs)
                return chunk_event
            return None

        # --- Content is streaming — accumulate and emit new decoded text ---
        cs["raw_content"] += raw_input
        return self._emit_new_content(cs)

    def _emit_new_content(self, cs: dict) -> dict | None:
        """Decode accumulated raw content and emit only the new portion."""
        decoded = _try_decode_json_string(cs["raw_content"])
        if decoded is None:
            return None

        prev_len = cs["decoded_len"]
        if len(decoded) <= prev_len:
            return None

        new_text = decoded[prev_len:]
        cs["decoded_len"] = len(decoded)
        return _tool_update(
            cs["tool_id"],
            cs["tool_name"],
            {"canvas_event": "chunk", "text": new_text},
        )

    def _emit_meta(self, cs: dict, search_region: str) -> dict:
        """Emit a meta event for a create tool.

        Type is known from the tool name.  Title and language are extracted
        from *search_region* (the accumulated buffer before the content key).
        """
        cs["meta_sent"] = True

        title_value = _extract_json_string_value(search_region, '"title": "')
        language = _extract_json_string_value(search_region, '"language": "')

        tool_id = cs["tool_id"]
        canvas_id = tool_id[-8:].lower() if len(tool_id) >= 8 else tool_id

        meta_content: dict[str, str] = {
            "canvas_event": "meta",
            "canvas_id": canvas_id,
            "title": title_value,
            "canvas_type": cs["canvas_type"],
        }
        if language:
            meta_content["language"] = language

        return _tool_update(tool_id, cs["tool_name"], meta_content)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_json_string_value(accumulated: str, key: str) -> str:
    """Extract a simple JSON string value given a key like '"title": "'."""
    start = accumulated.find(key)
    if start == -1:
        return ""
    value_start = start + len(key)
    end = accumulated.find('"', value_start)
    if end == -1:
        return ""
    raw = accumulated[value_start:end]
    return _try_decode_json_string(raw) or raw


def _extract_pattern_value(accumulated: str, replacement_idx: int) -> str:
    """Extract the old_text value from accumulated JSON before the new_text key."""
    pattern_key = '"old_text": "'
    pattern_start = accumulated.find(pattern_key)
    if pattern_start == -1:
        return ""
    value_start = pattern_start + len(pattern_key)
    raw = accumulated[value_start:replacement_idx].rstrip()
    if raw.endswith('",'):
        raw = raw[:-2]
    elif raw.endswith('"'):
        raw = raw[:-1]
    return _try_decode_json_string(raw) or raw
