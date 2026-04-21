"""
Thread anchor service — DynamoDB CRUD for thread anchors.

Anchors link a Thread (side-conversation) to a specific span of text inside
an AI message in a parent session. They are deliberately stored OUTSIDE the
LangGraph checkpointer state: writing anchor updates into the parent
session's state caused checkpoint corruption on older graph topologies, and
concurrent thread operations would race the parent state writer.

Table layout:
  PK: session_id      — parent chat id
  SK: thread_id       — the Thread's own UUID
  user_id             — owner, for GSI + authz checks
  thread_graph_id     — LangGraph thread_id for the Thread's checkpoints
  turn_index          — zero-based turn in the parent session
  ai_message_index    — which AIMessage within that turn
  quoted_text         — highlighted span the user captured
  start_offset / end_offset — char offsets (informational only)
  title               — short label for the drawer header
  created_at          — ISO8601 UTC; also range key for user_id GSI
"""

from __future__ import annotations

import asyncio
import os
import time
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from utils import logger

REGION = os.environ.get("REGION", "us-east-1")
THREAD_ANCHORS_TABLE = os.environ.get("THREAD_ANCHORS_TABLE")
EXPIRY_DURATION_DAYS = int(os.environ.get("EXPIRY_DURATION_DAYS", "365"))

_dynamodb = boto3.resource("dynamodb", region_name=REGION)
_table = _dynamodb.Table(THREAD_ANCHORS_TABLE) if THREAD_ANCHORS_TABLE else None


def _ensure_table() -> None:
    if _table is None:
        raise RuntimeError("THREAD_ANCHORS_TABLE env var is not configured")


def _serialize(anchor: Dict[str, Any]) -> Dict[str, Any]:
    """Trim None values — DynamoDB doesn't accept nulls on all SDK paths."""
    return {k: v for k, v in anchor.items() if v is not None}


def _deserialize(item: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Convert DynamoDB's `Decimal` numerics back to plain Python ints/floats
    so the item round-trips cleanly through json.dumps / FastAPI's encoder."""
    if item is None:
        return None
    out: Dict[str, Any] = {}
    for k, v in item.items():
        if isinstance(v, Decimal):
            out[k] = int(v) if v % 1 == 0 else float(v)
        else:
            out[k] = v
    return out


async def put_anchor(anchor: Dict[str, Any]) -> None:
    """Insert or overwrite an anchor. `anchor` must include session_id and thread_id.

    Stamps `expiry_ttl` if absent so anchors age out on the same schedule as the
    parent session's checkpoints (see the DynamoDB table's TTL setting)."""
    _ensure_table()
    if not anchor.get("session_id") or not anchor.get("thread_id"):
        raise ValueError("anchor must include session_id and thread_id")
    if "expiry_ttl" not in anchor:
        anchor = {
            **anchor,
            "expiry_ttl": int(time.time()) + (EXPIRY_DURATION_DAYS * 86400),
        }
    await asyncio.to_thread(_table.put_item, Item=_serialize(anchor))


async def get_anchor(session_id: str, thread_id: str) -> Optional[Dict[str, Any]]:
    """Fetch a single anchor. DynamoDB errors are logged and surfaced as
    `None` — callers treat the result as "not found", so make sure failures
    are visible in CloudWatch instead of silently masked."""
    _ensure_table()
    try:
        resp = await asyncio.to_thread(
            _table.get_item,
            Key={"session_id": session_id, "thread_id": thread_id},
        )
    except ClientError as e:
        logger.warning(
            f"thread_anchor_service.get_anchor {session_id}/{thread_id} "
            f"failed (returning None): {e}"
        )
        return None
    return _deserialize(resp.get("Item"))


async def list_anchors_for_session(session_id: str) -> List[Dict[str, Any]]:
    """Return all anchors bound to this session, oldest-first."""
    _ensure_table()
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
            f"thread_anchor_service.list_anchors_for_session {session_id} failed: {e}"
        )
        return []
    return sorted(items, key=lambda a: a.get("created_at", ""))


async def delete_anchor(session_id: str, thread_id: str) -> bool:
    """Delete a single anchor. Returns True if a record was actually removed."""
    _ensure_table()
    try:
        resp = await asyncio.to_thread(
            _table.delete_item,
            Key={"session_id": session_id, "thread_id": thread_id},
            ReturnValues="ALL_OLD",
        )
    except ClientError as e:
        logger.error(
            f"thread_anchor_service.delete_anchor {session_id}/{thread_id}: {e}"
        )
        return False
    return bool(resp.get("Attributes"))


async def delete_session_anchors(session_id: str) -> List[Dict[str, Any]]:
    """Delete every anchor bound to `session_id`. Returns the deleted items so
    the caller can also clean up the referenced thread checkpoints."""
    _ensure_table()
    anchors = await list_anchors_for_session(session_id)
    if not anchors:
        return []

    def _batch_delete() -> None:
        with _table.batch_writer() as batch:
            for a in anchors:
                batch.delete_item(
                    Key={
                        "session_id": a["session_id"],
                        "thread_id": a["thread_id"],
                    }
                )

    try:
        await asyncio.to_thread(_batch_delete)
    except ClientError as e:
        logger.error(f"thread_anchor_service.delete_session_anchors {session_id}: {e}")
        raise
    return anchors
