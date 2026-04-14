"""
Project Service for Core-Services.

DynamoDB CRUD for the `projects` and `project_files` tables.
All write paths enforce ownership (user_id must match) and the
filename-uniqueness constraint (project_id-filename-index GSI).
"""

import asyncio
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from config import PROJECT_FILES_TABLE, PROJECT_CANVASES_TABLE, PROJECTS_TABLE, REGION
from utils import fix_decimals as _fix_decimals, logger

USER_ID_INDEX = "user_id-created_at-index"
FILENAME_INDEX = "project_id-filename-index"
MAX_FILES_PER_PROJECT = 100

# File extensions that are treated as structured data (loaded into Code Interpreter)
# rather than indexed in the knowledge base.
STRUCTURED_EXTENSIONS = {
    ".csv",
    ".tsv",
    ".xls",
    ".xlsx",
    ".ppt",
    ".pptx",
    ".parquet",
    ".jsonl",
    ".arrow",
    ".feather",
}


def file_category(filename: str) -> str:
    """Return 'data' for structured files, 'document' for KB-indexable files."""
    ext = os.path.splitext(filename.lower())[1]
    return "data" if ext in STRUCTURED_EXTENSIONS else "document"


class ProjectService:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb", region_name=REGION)
        self.projects = self.dynamodb.Table(PROJECTS_TABLE)
        self.project_files = self.dynamodb.Table(PROJECT_FILES_TABLE)
        self.project_canvases = (
            self.dynamodb.Table(PROJECT_CANVASES_TABLE)
            if PROJECT_CANVASES_TABLE
            else None
        )

    # =========================================================================
    # Projects table
    # =========================================================================

    async def create_project(
        self, user_id: str, name: str, description: str = ""
    ) -> Dict[str, Any]:
        if not name or not name.strip():
            raise ValueError("Project name cannot be empty.")
        name = name.strip()[:200]
        project_id = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        item = {
            "project_id": project_id,
            "user_id": user_id,
            "name": name,
            "description": description,
            "file_count": 0,
            "created_at": now,
            "updated_at": now,
        }
        await asyncio.to_thread(lambda: self.projects.put_item(Item=item))
        logger.debug(f"Created project {project_id} for user {user_id}")
        return _fix_decimals(item)

    async def get_project(self, project_id: str) -> Optional[Dict[str, Any]]:
        response = await asyncio.to_thread(
            lambda: self.projects.get_item(Key={"project_id": project_id})
        )
        item = response.get("Item")
        return _fix_decimals(item) if item else None

    async def get_project_for_user(
        self, project_id: str, user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Return project only if it belongs to user_id, else None."""
        project = await self.get_project(project_id)
        if project and project.get("user_id") == user_id:
            return project
        return None

    async def list_projects(
        self, user_id: str, cursor: Optional[Dict] = None
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "IndexName": USER_ID_INDEX,
            "KeyConditionExpression": "user_id = :uid",
            "ExpressionAttributeValues": {":uid": user_id},
            "ScanIndexForward": False,  # newest first
            "Limit": 50,
        }
        if cursor:
            params["ExclusiveStartKey"] = cursor

        response = await asyncio.to_thread(lambda: self.projects.query(**params))
        projects = _fix_decimals(response.get("Items", []))
        if projects and self.project_canvases:
            counts = await asyncio.gather(
                *[
                    asyncio.to_thread(self._get_canvas_count, p["project_id"])
                    for p in projects
                ]
            )
            for p, count in zip(projects, counts):
                p["canvas_count"] = count
        return {
            "projects": projects,
            "next_cursor": response.get("LastEvaluatedKey"),
        }

    def _get_canvas_count(self, project_id: str) -> int:
        """Count canvas artifacts for a project directly from the canvases table."""
        try:
            total = 0
            params: Dict[str, Any] = {
                "KeyConditionExpression": "project_id = :pid",
                "ExpressionAttributeValues": {":pid": project_id},
                "Select": "COUNT",
            }
            while True:
                resp = self.project_canvases.query(**params)
                total += resp.get("Count", 0)
                last_key = resp.get("LastEvaluatedKey")
                if not last_key:
                    break
                params["ExclusiveStartKey"] = last_key
            return total
        except Exception as e:
            logger.warning(f"Failed to count canvases for {project_id}: {e}")
            return 0

    async def update_project(
        self,
        project_id: str,
        user_id: str,
        name: Optional[str] = None,
        description: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update name and/or description. Returns updated project or None if not found/unauthorized."""
        project = await self.get_project_for_user(project_id, user_id)
        if not project:
            return None

        now = datetime.now(timezone.utc).isoformat()
        expressions = ["updated_at = :updated_at"]
        values: Dict[str, Any] = {":updated_at": now}

        if name is not None:
            expressions.append("#n = :name")
            values[":name"] = name
        if description is not None:
            expressions.append("description = :desc")
            values[":desc"] = description

        update_expr = "SET " + ", ".join(expressions)
        kwargs: Dict[str, Any] = {
            "Key": {"project_id": project_id},
            "UpdateExpression": update_expr,
            "ExpressionAttributeValues": values,
            "ReturnValues": "ALL_NEW",
        }
        if name is not None:
            kwargs["ExpressionAttributeNames"] = {"#n": "name"}

        response = await asyncio.to_thread(lambda: self.projects.update_item(**kwargs))
        attrs = response.get("Attributes")
        return _fix_decimals(attrs) if attrs else None

    async def delete_project(self, project_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.projects.delete_item(Key={"project_id": project_id})
        )
        logger.debug(f"Deleted project {project_id}")

    async def increment_file_count(self, project_id: str, delta: int) -> None:
        """Atomic counter update — use +1 on upload confirm, -1 on delete."""
        try:
            condition = "attribute_exists(project_id)"
            if delta < 0:
                condition += " AND file_count > :zero"
            expr_values: Dict[str, Any] = {":delta": delta}
            if delta < 0:
                expr_values[":zero"] = 0
            await asyncio.to_thread(
                lambda: self.projects.update_item(
                    Key={"project_id": project_id},
                    UpdateExpression="ADD file_count :delta",
                    ExpressionAttributeValues=expr_values,
                    ConditionExpression=condition,
                )
            )
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise

    # =========================================================================
    # Project files table
    # =========================================================================

    async def check_filename_exists(self, project_id: str, filename: str) -> bool:
        """Query the filename GSI for an exact match. Used for duplicate detection."""
        response = await asyncio.to_thread(
            lambda: self.project_files.query(
                IndexName=FILENAME_INDEX,
                KeyConditionExpression="project_id = :pid AND filename = :fname",
                ExpressionAttributeValues={
                    ":pid": project_id,
                    ":fname": filename,
                },
                Select="COUNT",
            )
        )
        return response.get("Count", 0) > 0

    async def register_file_upload(
        self,
        project_id: str,
        user_id: str,
        file_id: str,
        filename: str,
        s3_key: str,
        metadata_s3_key: str,
        content_type: str,
        size_bytes: int,
    ) -> Dict[str, Any]:
        """Write initial file record with status=uploading."""
        now = datetime.now(timezone.utc).isoformat()
        item = {
            "project_id": project_id,
            "file_id": file_id,
            "user_id": user_id,
            "filename": filename,
            "s3_key": s3_key,
            "metadata_s3_key": metadata_s3_key,
            "content_type": content_type,
            "size_bytes": size_bytes,
            "status": "uploading",
            "category": file_category(filename),
            "ingestion_job_id": "",
            "created_at": now,
        }
        await asyncio.to_thread(lambda: self.project_files.put_item(Item=item))
        logger.debug(f"Registered file {file_id} for project {project_id}")
        return _fix_decimals(item)

    async def get_file(self, project_id: str, file_id: str) -> Optional[Dict[str, Any]]:
        response = await asyncio.to_thread(
            lambda: self.project_files.get_item(
                Key={"project_id": project_id, "file_id": file_id}
            )
        )
        item = response.get("Item")
        return _fix_decimals(item) if item else None

    async def get_file_for_user(
        self, project_id: str, file_id: str, user_id: str
    ) -> Optional[Dict[str, Any]]:
        """Return file only if it belongs to user_id, else None."""
        file = await self.get_file(project_id, file_id)
        if file and file.get("user_id") == user_id:
            return file
        return None

    async def update_file_status(
        self,
        project_id: str,
        file_id: str,
        status: str,
        ingestion_job_id: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        update_expr = "SET #s = :status"
        values: Dict[str, Any] = {":status": status}

        if ingestion_job_id is not None:
            update_expr += ", ingestion_job_id = :job_id"
            values[":job_id"] = ingestion_job_id

        response = await asyncio.to_thread(
            lambda: self.project_files.update_item(
                Key={"project_id": project_id, "file_id": file_id},
                UpdateExpression=update_expr,
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues=values,
                ReturnValues="ALL_NEW",
            )
        )
        attrs = response.get("Attributes")
        return _fix_decimals(attrs) if attrs else None

    async def list_project_files(
        self, project_id: str, cursor: Optional[Dict] = None
    ) -> Dict[str, Any]:
        params: Dict[str, Any] = {
            "KeyConditionExpression": "project_id = :pid",
            "ExpressionAttributeValues": {":pid": project_id},
            "Limit": 100,
        }
        if cursor:
            params["ExclusiveStartKey"] = cursor

        response = await asyncio.to_thread(lambda: self.project_files.query(**params))
        return {
            "files": _fix_decimals(response.get("Items", [])),
            "next_cursor": response.get("LastEvaluatedKey"),
        }

    async def list_all_project_files(self, project_id: str) -> List[Dict[str, Any]]:
        """Paginate through all files — used for cascade delete."""

        def _paginate():
            files: List[Dict[str, Any]] = []
            params: Dict[str, Any] = {
                "KeyConditionExpression": "project_id = :pid",
                "ExpressionAttributeValues": {":pid": project_id},
            }
            while True:
                response = self.project_files.query(**params)
                files.extend(_fix_decimals(response.get("Items", [])))
                last_key = response.get("LastEvaluatedKey")
                if not last_key:
                    break
                params["ExclusiveStartKey"] = last_key
            return files

        return await asyncio.to_thread(_paginate)

    async def delete_file_record(self, project_id: str, file_id: str) -> None:
        await asyncio.to_thread(
            lambda: self.project_files.delete_item(
                Key={"project_id": project_id, "file_id": file_id}
            )
        )
        logger.debug(f"Deleted file record {file_id} from project {project_id}")


project_service = ProjectService()
