"""
Project Canvas Artifacts service.

Save, retrieve, list, and delete canvas artifacts stored per-project.
Canvas content is stored in S3 (PROJECTS_S3_BUCKET under canvases/{project_id}/{canvas_id}).
Metadata is stored in DynamoDB (PROJECT_CANVASES_TABLE, PK=project_id, SK=canvas_id).
"""

import asyncio
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from utils import logger

REGION = os.environ.get("REGION", "us-east-1")
PROJECT_CANVASES_TABLE = os.environ.get("PROJECT_CANVASES_TABLE")
PROJECTS_S3_BUCKET = os.environ.get("PROJECTS_S3_BUCKET")
_dynamodb = boto3.resource("dynamodb", region_name=REGION)
_s3 = boto3.client("s3", region_name=REGION)
_canvas_table = (
    _dynamodb.Table(PROJECT_CANVASES_TABLE) if PROJECT_CANVASES_TABLE else None
)


def _canvas_s3_key(project_id: str, canvas_id: str) -> str:
    return f"canvases/{project_id}/{canvas_id}"


async def save_canvas(
    project_id: str,
    canvas_id: str,
    name: str,
    canvas_type: str,
    content: str,
    session_id: str,
    user_id: str,
) -> Dict[str, Any]:
    """Save (or overwrite) a canvas artifact to a project.

    Stores content in S3 and metadata in DynamoDB. If the canvas_id already
    exists for this project, the previous version is overwritten.
    Returns the saved metadata dict: {canvas_id, name, type, saved_at}.
    """
    if not _canvas_table or not PROJECTS_S3_BUCKET:
        raise RuntimeError(
            "PROJECT_CANVASES_TABLE or PROJECTS_S3_BUCKET not configured"
        )

    saved_at = datetime.now(timezone.utc).isoformat()
    s3_key = _canvas_s3_key(project_id, canvas_id)

    content_bytes = content.encode("utf-8")

    # Write DynamoDB first (metadata), then S3 (content).
    # If S3 fails we clean up the DynamoDB record so nothing is orphaned.
    item = {
        "project_id": project_id,
        "canvas_id": canvas_id,
        "name": name,
        "type": canvas_type,
        "session_id": session_id,
        "user_id": user_id,
        "saved_at": saved_at,
        "s3_key": s3_key,
    }
    await asyncio.to_thread(_canvas_table.put_item, Item=item)

    try:
        await asyncio.to_thread(
            _s3.put_object,
            Bucket=PROJECTS_S3_BUCKET,
            Key=s3_key,
            Body=content_bytes,
            ContentType="text/plain; charset=utf-8",
        )
    except Exception:
        # Compensating cleanup — remove the metadata record
        try:
            await asyncio.to_thread(
                _canvas_table.delete_item,
                Key={"project_id": project_id, "canvas_id": canvas_id},
            )
        except Exception as cleanup_err:
            logger.warning(f"Failed to clean up DynamoDB after S3 error: {cleanup_err}")
        raise
    return {
        "canvas_id": canvas_id,
        "name": name,
        "type": canvas_type,
        "saved_at": saved_at,
    }


async def get_canvas_content(project_id: str, canvas_id: str) -> Optional[str]:
    """Fetch canvas content from S3.

    Verifies the record exists in DynamoDB then retrieves the content from S3.
    Returns None if not found.
    """
    if not _canvas_table or not PROJECTS_S3_BUCKET:
        return None

    try:
        resp = await asyncio.to_thread(
            _canvas_table.get_item,
            Key={"project_id": project_id, "canvas_id": canvas_id},
        )
    except ClientError as e:
        logger.error(f"DynamoDB get_item failed for canvas {canvas_id}: {e}")
        return None

    item = resp.get("Item")
    if not item:
        return None

    s3_key = item.get("s3_key", _canvas_s3_key(project_id, canvas_id))

    def _read_s3():
        s3_resp = _s3.get_object(Bucket=PROJECTS_S3_BUCKET, Key=s3_key)
        return s3_resp["Body"].read()

    try:
        body_bytes = await asyncio.to_thread(_read_s3)
        return body_bytes.decode("utf-8")
    except ClientError as e:
        logger.error(f"S3 get_object failed for canvas {canvas_id}: {e}")
        return None


async def list_canvases(project_id: str) -> List[Dict[str, Any]]:
    """List all canvas artifacts saved for a project.

    Returns a list of metadata dicts: [{canvas_id, name, type, saved_at}],
    sorted ascending by saved_at.
    """
    if not _canvas_table:
        return []

    items: List[Dict[str, Any]] = []
    query_params: Dict[str, Any] = {
        "KeyConditionExpression": "project_id = :pid",
        "ExpressionAttributeValues": {":pid": project_id},
        "ProjectionExpression": "canvas_id, #n, #t, saved_at",
        "ExpressionAttributeNames": {"#n": "name", "#t": "type"},
    }
    try:
        while True:
            resp = await asyncio.to_thread(_canvas_table.query, **query_params)
            for item in resp.get("Items", []):
                items.append(
                    {
                        "canvas_id": item["canvas_id"],
                        "name": item.get("name", ""),
                        "type": item.get("type", "document"),
                        "saved_at": item.get("saved_at", ""),
                    }
                )
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break
            query_params["ExclusiveStartKey"] = last_key
    except ClientError as e:
        logger.error(f"Error listing canvases for project {project_id}: {e}")

    return sorted(items, key=lambda x: x.get("saved_at", ""))


async def delete_canvas(project_id: str, canvas_id: str) -> bool:
    """Delete a canvas artifact (DynamoDB record + S3 object).

    Returns True on success, False if the record was not found.
    Project-level ownership validation is done by the caller.
    """
    if not _canvas_table or not PROJECTS_S3_BUCKET:
        return False

    try:
        resp = await asyncio.to_thread(
            _canvas_table.delete_item,
            Key={"project_id": project_id, "canvas_id": canvas_id},
            ReturnValues="ALL_OLD",
        )
    except ClientError as e:
        logger.error(f"DynamoDB delete_item failed for canvas {canvas_id}: {e}")
        return False

    deleted_item = resp.get("Attributes")
    if not deleted_item:
        return False

    s3_key = deleted_item.get("s3_key", _canvas_s3_key(project_id, canvas_id))
    try:
        await asyncio.to_thread(
            _s3.delete_object,
            Bucket=PROJECTS_S3_BUCKET,
            Key=s3_key,
        )
    except ClientError as e:
        logger.warning(
            f"S3 delete_object failed for canvas {canvas_id} "
            f"(DynamoDB record already removed): {e}"
        )

    return True
