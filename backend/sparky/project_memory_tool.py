"""
Project long-term memory tool for Sparky Agent.

Retrieves project-relevant insights extracted from past sessions via
AgentCoreMemoryStore. The composite_actor_id helper encodes both user_id and
project_id into the actorId field, partitioning memories per user×project
without requiring a separate memory strategy per project.

The project_id and user_id arguments are injected by SparkyMiddleware.
"""

import asyncio
import json
import os
from typing import Literal

from langchain.tools import tool

from utils import logger


def composite_actor_id(user_id: str, project_id: str) -> str:
    """Encode user_id and project_id into a single actorId for namespace isolation.

    UUIDs stripped of dashes are joined with '_'. Since UUIDs never contain '_',
    the composite is always unambiguously parseable.
    """
    return f"{user_id.replace('-', '')}_{project_id.replace('-', '')}"


MEMORY_TOP_K = int(os.environ.get("PROJECT_MEMORY_TOP_K", "20"))

_RELEVANCE_THRESHOLDS: dict[str, float] = {
    "low": 0.25,
    "medium": 0.5,
    "high": 0.8,
}


@tool
async def recall_project_memory(
    query: str,
    relevance: Literal["low", "medium", "high"] = "medium",
    limit: int = MEMORY_TOP_K,
    project_id: str = "",  # injected by SparkyMiddleware
    user_id: str = "",  # injected by SparkyMiddleware
) -> str:
    """Recall stored insights and facts from past sessions in this project.

    Use this when you need to remember decisions, progress, constraints,
    solutions, or any facts discussed in previous sessions for this project.
    Provide a specific query describing what you want to recall.

    Args:
        query:      What to recall (e.g. "What was decided about the auth design?").
        relevance:  Minimum relevance threshold for returned memories.
                    "low"    — broad recall, includes loosely related memories (score ≥ 0.25).
                    "medium" — balanced recall, moderately relevant memories (score ≥ 0.5). Default.
                    "high"   — precise recall, only strongly relevant memories (score ≥ 0.8).
                    Use "low" when exploring or unsure; "high" when you need confident facts.
        limit:      Maximum number of memories to return (default 10).
        project_id: Injected automatically — do not supply.
        user_id:    Injected automatically — do not supply.
    """
    from config import memory_store

    if not memory_store:
        return json.dumps(
            {"memories": [], "message": "Project memory is not configured."}
        )
    if not project_id or not user_id:
        return json.dumps(
            {"memories": [], "message": "No project bound to this session."}
        )
    if not query or not query.strip():
        return json.dumps({"error": "query is required."})

    min_score = _RELEVANCE_THRESHOLDS.get(relevance, _RELEVANCE_THRESHOLDS["medium"])
    actor_id = composite_actor_id(user_id, project_id)
    # Call the client directly — the store's _convert_namespace_to_string adds a
    # leading slash ("/projects/...") which doesn't match the stored namespace
    # ("projects/...") from the strategy template.
    namespace_str = f"projects/{actor_id}"

    try:
        response = await asyncio.to_thread(
            memory_store.client.retrieve_memory_records,
            memoryId=memory_store.memory_id,
            namespace=namespace_str,
            searchCriteria={"searchQuery": query, "topK": limit},
            maxResults=limit,
        )
        raw_records = response.get("memoryRecordSummaries", [])
    except Exception as e:
        logger.error(f"Project memory search failed: {e}")
        return json.dumps({"error": "Failed to search project memory."})

    results = [
        {
            "content": r.get("content", {}).get("text", "") or r.get("content", ""),
            "score": r.get("score"),
        }
        for r in raw_records
        if r.get("content") and (r.get("score") or 0) >= min_score
    ]

    if not results:
        return json.dumps(
            {
                "memories": [],
                "message": (
                    "No prior insights found for this project. "
                    "Memories are extracted asynchronously and may take a few minutes "
                    "to appear after the first session."
                ),
            }
        )

    return json.dumps({"memories": results})
