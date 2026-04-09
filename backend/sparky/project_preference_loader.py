"""
Project user-preference loader for Sparky Agent.

Retrieves user preferences from AgentCore Memory (USER_PREFERENCE strategy)
for the project bound to the current session. Results are cached with a 15-minute
TTL and injected into the system prompt so the agent always has them as background
context without needing to call a tool.

Preferences are scoped per user×project via the same composite actorId used
for conversational memory: "{user_id_hex}_{project_id_hex}".
"""

import asyncio
import time
from dataclasses import dataclass

from project_memory_tool import composite_actor_id
from utils import logger

_CACHE_TTL = 15 * 60  # seconds
_TOP_K = 20


@dataclass
class _PreferenceEntry:
    text: str  # Formatted preferences block, "" if none found
    expires_at: float


# key: (user_id, project_id)
_cache: dict[tuple, _PreferenceEntry] = {}


async def get_project_preferences(project_id: str, user_id: str) -> str:
    """Return a formatted string of user preferences for this project.

    Fetches from AgentCore Memory USER_PREFERENCE strategy, cached for 15 minutes.
    Returns "" if no preferences exist or PROJECT_MEMORY_ID is not configured.
    """
    from config import memory_store

    if not memory_store:
        return ""

    cache_key = (user_id, project_id)
    now = time.monotonic()

    entry = _cache.get(cache_key)
    if entry and entry.expires_at > now:
        return entry.text

    text = await _fetch_preferences(memory_store, user_id, project_id)
    _cache[cache_key] = _PreferenceEntry(text=text, expires_at=now + _CACHE_TTL)
    return text


def invalidate(user_id: str, project_id: str) -> None:
    """Evict cached preferences for a user×project pair (e.g. after session end)."""
    _cache.pop((user_id, project_id), None)


async def _fetch_preferences(memory_store, user_id: str, project_id: str) -> str:
    """Fetch and format preferences from AgentCore Memory."""
    actor_id = composite_actor_id(user_id, project_id)
    # Direct API call — avoids _convert_namespace_to_string prepending "/"
    namespace_str = f"preferences/{actor_id}"

    try:
        response = await asyncio.to_thread(
            memory_store.client.retrieve_memory_records,
            memoryId=memory_store.memory_id,
            namespace=namespace_str,
            searchCriteria={
                "searchQuery": (
                    "user preferences working style communication style "
                    "technical conventions coding style tone"
                ),
                "topK": _TOP_K,
            },
            maxResults=_TOP_K,
        )
    except Exception as e:
        logger.warning(f"Project preferences fetch failed: {e}")
        return ""

    records = response.get("memoryRecordSummaries", [])
    if not records:
        return ""

    lines = []
    for r in records:
        content = r.get("content", {})
        text = content.get("text", "") if isinstance(content, dict) else str(content)
        if text:
            lines.append(f"- {text}")

    return "\n".join(lines)
