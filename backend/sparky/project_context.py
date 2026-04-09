"""
Project context helper for Sparky Agent.

Fetches project metadata and indexed filenames from DynamoDB with an
in-process TTL cache (15 minutes per project+user pair). A different
project_id in the request is automatically a cache miss.
"""

import asyncio
import os
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from utils import logger

REGION = os.environ.get("REGION", "us-east-1")
PROJECTS_TABLE = os.environ.get("PROJECTS_TABLE")
PROJECT_FILES_TABLE = os.environ.get("PROJECT_FILES_TABLE")
PROJECT_CANVASES_TABLE = os.environ.get("PROJECT_CANVASES_TABLE")

_dynamodb = boto3.resource("dynamodb", region_name=REGION)
_projects_table = _dynamodb.Table(PROJECTS_TABLE) if PROJECTS_TABLE else None
_project_files_table = (
    _dynamodb.Table(PROJECT_FILES_TABLE) if PROJECT_FILES_TABLE else None
)

_CACHE_TTL = 15 * 60  # seconds


@dataclass
class _ProjectContextEntry:
    project: Optional[Dict[str, Any]]
    filenames: List[str]
    data_files: List[str]
    canvases: List[dict]
    expires_at: float


# key: (user_id, project_id)
_cache: Dict[tuple, _ProjectContextEntry] = {}


@dataclass
class ProjectContext:
    """Resolved project context passed to SparkyContext."""

    project: Optional[Dict[str, Any]]
    name: str = ""
    description: str = ""
    filenames: List[str] = field(default_factory=list)  # KB-indexed documents
    data_files: List[str] = field(default_factory=list)  # Structured data files
    canvases: List[dict] = field(default_factory=list)  # Saved canvas artifacts


async def get_project_context(
    project_id: str, user_id: str
) -> Optional[ProjectContext]:
    """Fetch and cache project metadata + indexed filenames.

    Returns None if the project does not exist or is not owned by user_id.
    Results are cached for 15 minutes keyed by (user_id, project_id).
    """
    cache_key = (user_id, project_id)
    now = time.monotonic()

    entry = _cache.get(cache_key)
    if entry and entry.expires_at > now:
        if entry.project is None:
            return None
        return _to_context(entry)

    project = await _fetch_project(project_id, user_id)
    filenames, data_files = (
        await _fetch_project_files(project_id) if project else ([], [])
    )
    canvases = await _fetch_project_canvases(project_id) if project else []

    _cache[cache_key] = _ProjectContextEntry(
        project=project,
        filenames=filenames,
        data_files=data_files,
        canvases=canvases,
        expires_at=now + _CACHE_TTL,
    )

    if project is None:
        return None
    return _to_context(_cache[cache_key])


def _to_context(entry: _ProjectContextEntry) -> ProjectContext:
    return ProjectContext(
        project=entry.project,
        name=entry.project.get("name", ""),
        description=entry.project.get("description", ""),
        filenames=entry.filenames,
        data_files=entry.data_files,
        canvases=entry.canvases,
    )


async def _fetch_project(project_id: str, user_id: str) -> Optional[Dict[str, Any]]:
    if not PROJECTS_TABLE or not _projects_table:
        logger.warning("PROJECTS_TABLE not configured — skipping project lookup")
        return None
    try:
        response = await asyncio.to_thread(
            _projects_table.get_item, Key={"project_id": project_id}
        )
        item = response.get("Item")
        if not item:
            return None
        if item.get("user_id") != user_id:
            logger.warning(
                f"Project {project_id} ownership mismatch: "
                f"owner={item.get('user_id')} requester={user_id}"
            )
            return None
        return item
    except ClientError as e:
        logger.error(f"Error fetching project {project_id}: {e}")
        return None


async def _fetch_project_files(project_id: str) -> tuple[List[str], List[str]]:
    """Return (document_filenames, data_filenames) for the project.

    Documents: status IN (indexed, processing), category != "data"
    Data files: status = "ready", category = "data"
    Files without a category field are treated as documents (backwards compat).
    """
    if not PROJECT_FILES_TABLE or not _project_files_table:
        return [], []
    try:
        documents: List[str] = []
        data_files: List[str] = []
        query_params: Dict[str, Any] = {
            "KeyConditionExpression": "project_id = :pid",
            "ExpressionAttributeValues": {":pid": project_id},
            "ProjectionExpression": "filename, #s, category",
            "ExpressionAttributeNames": {"#s": "status"},
        }
        while True:
            response = await asyncio.to_thread(
                _project_files_table.query, **query_params
            )
            for item in response.get("Items", []):
                fname = item.get("filename")
                if not fname:
                    continue
                status = item.get("status", "")
                category = item.get("category", "document")
                if category == "data" and status == "ready":
                    data_files.append(fname)
                elif category != "data" and status in ("indexed", "processing"):
                    documents.append(fname)
            last_key = response.get("LastEvaluatedKey")
            if not last_key:
                break
            query_params["ExclusiveStartKey"] = last_key
        return sorted(documents), sorted(data_files)
    except ClientError as e:
        logger.error(f"Error fetching project files for project {project_id}: {e}")
        return [], []


async def _fetch_project_canvases(project_id: str) -> List[dict]:
    """Return list of saved canvas artifact metadata for the project."""
    try:
        from project_canvas_service import list_canvases

        return await list_canvases(project_id)
    except Exception as e:
        logger.error(f"Error fetching project canvases for project {project_id}: {e}")
        return []


# Keep for backwards compatibility (handlers.py still calls this directly)
async def get_project_for_user(
    project_id: str, user_id: str
) -> Optional[Dict[str, Any]]:
    ctx = await get_project_context(project_id, user_id)
    return ctx.project if ctx else None
