"""
Thread anchor service (read-only) for Core-Services.

Core-Services only needs to list anchors when returning session history.
Write operations (create/delete/copy) are handled by Sparky.
"""

import asyncio
import os
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from utils import logger

REGION = os.environ.get("REGION", "us-east-1")
THREAD_ANCHORS_TABLE = os.environ.get("THREAD_ANCHORS_TABLE")

_dynamodb = boto3.resource("dynamodb", region_name=REGION)
_table = _dynamodb.Table(THREAD_ANCHORS_TABLE) if THREAD_ANCHORS_TABLE else None


def _deserialize(item: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if item is None:
        return None
    return {
        k: (
            int(v)
            if isinstance(v, Decimal) and v % 1 == 0
            else float(v)
            if isinstance(v, Decimal)
            else v
        )
        for k, v in item.items()
    }


async def list_anchors_for_session(session_id: str) -> List[Dict[str, Any]]:
    if not _table:
        return []
    items: List[Dict[str, Any]] = []
    query_params: Dict[str, Any] = {
        "KeyConditionExpression": "session_id = :sid",
        "ExpressionAttributeValues": {":sid": session_id},
    }
    try:
        while True:
            resp = await asyncio.to_thread(_table.query, **query_params)
            items.extend(_deserialize(i) for i in resp.get("Items", []))
            last_key = resp.get("LastEvaluatedKey")
            if not last_key:
                break
            query_params["ExclusiveStartKey"] = last_key
    except ClientError as e:
        logger.error(
            f"thread_anchor_service.list_anchors_for_session {session_id}: {e}"
        )
        return []
    return sorted(items, key=lambda a: a.get("created_at", ""))
