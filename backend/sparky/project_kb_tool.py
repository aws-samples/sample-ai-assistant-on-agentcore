"""
Project Knowledge Base tool for Sparky Agent.

Retrieves relevant information from files uploaded to the project bound
to the current session. The project_id argument is injected by SparkyMiddleware
so the LLM only needs to supply the search query.
"""

import asyncio
import json
import os
from typing import Literal

import boto3
from langchain.tools import tool

from utils import logger

REGION = os.environ.get("REGION", "us-east-1")
PROJECTS_KB_ID = os.environ.get("PROJECTS_KB_ID")

_bedrock_agent_runtime = boto3.client("bedrock-agent-runtime", region_name=REGION)

_RELEVANCE_THRESHOLDS: dict[str, float] = {
    "low": 0.25,
    "medium": 0.5,
    "high": 0.8,
}


@tool
async def search_project_knowledge_base(
    query: str,
    filename_filter: str = "",
    relevance: Literal["low", "medium", "high"] = "medium",
    limit: Literal[5, 10, 15, 25] = 10,
    project_id: str = "",
    tool_call_id: str = "",
) -> str:
    """Search the project knowledge base for relevant information from uploaded files.

    Use this tool to find information from documents uploaded to the current project.
    Results include relevant passages and their source filenames.

    Args:
        query:           The search query describing what information to find.
        filename_filter: Optional filename to restrict results to a single file.
                         Use the exact filename as listed in the project (e.g. "report.pdf").
                         Leave empty to search across all project files.
        relevance:       Minimum relevance threshold for returned results.
                         "low"    — broad search, includes loosely related passages (score ≥ 0.25).
                         "medium" — balanced search, moderately relevant passages (score ≥ 0.5). Default.
                         "high"   — precise search, only strongly relevant passages (score ≥ 0.8).
                         Use "low" for exploratory queries; "high" when accuracy is critical.
        limit:           Maximum number of results to return. Options: 5, 10, 15, 25. Default 10.
                         Use higher values when broad coverage is needed; lower for focused retrieval.
        project_id:      Injected automatically — do not supply.
        tool_call_id:    Injected automatically — do not supply.
    """
    if not PROJECTS_KB_ID:
        return json.dumps({"error": "Project knowledge base is not configured."})

    if not project_id:
        return json.dumps({"error": "No project is currently bound to this session."})

    min_score = _RELEVANCE_THRESHOLDS.get(relevance, _RELEVANCE_THRESHOLDS["medium"])

    try:
        project_filter = {"equals": {"key": "project_id", "value": project_id}}
        if filename_filter:
            kb_filter = {
                "andAll": [
                    project_filter,
                    {"equals": {"key": "filename", "value": filename_filter}},
                ]
            }
        else:
            kb_filter = project_filter

        response = await asyncio.to_thread(
            _bedrock_agent_runtime.retrieve,
            knowledgeBaseId=PROJECTS_KB_ID,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": limit,
                    "filter": kb_filter,
                }
            },
        )

        results = response.get("retrievalResults", [])
        if not results:
            return json.dumps(
                {
                    "results": [],
                    "message": "No relevant information found in project files.",
                }
            )

        formatted = []
        for r in results:
            content = r.get("content", {}).get("text", "")
            score = r.get("score", 0)

            if score < min_score:
                continue

            # Prefer filename from metadata sidecar attributes
            metadata = r.get("metadata", {})
            source = metadata.get("filename", "")

            # Fall back to S3 URI basename if metadata is absent
            if not source:
                location = r.get("location", {})
                uri = location.get("s3Location", {}).get("uri", "")
                if uri:
                    basename = uri.rsplit("/", 1)[-1]
                    # Strip .metadata.json suffix if present
                    if basename.endswith(".metadata.json"):
                        basename = basename[: -len(".metadata.json")]
                    source = basename

            formatted.append({"content": content, "source": source, "score": score})

        if not formatted:
            return json.dumps(
                {
                    "results": [],
                    "message": "No relevant information found at the requested relevance level. Try lowering the relevance threshold.",
                }
            )

        return json.dumps({"results": formatted})

    except Exception as e:
        logger.error(f"Error searching project knowledge base: {e}")
        return json.dumps({"error": "Failed to search project knowledge base."})
