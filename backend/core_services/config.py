from __future__ import annotations

import logging
import os
from typing import Annotated, Any

import boto3
from botocore.config import Config
from langgraph.graph import StateGraph, MessagesState
from langgraph_checkpoint_aws import (
    AgentCoreMemoryStore,
    DynamoDBSaver,
)

logger = logging.getLogger(__name__)


def _canvases_reducer(existing: dict, updates: dict) -> dict:
    """Merge canvas state updates, shallow-merging versions per canvas."""
    result = {**existing}
    for canvas_id, update in updates.items():
        if canvas_id in result:
            old = result[canvas_id]
            merged_versions = {**old["versions"], **update["versions"]}
            result[canvas_id] = {**old, **update, "versions": merged_versions}
        else:
            result[canvas_id] = update
    return result


class HistoryState(MessagesState):
    """Extends MessagesState with canvases so aget_state can deserialize them."""

    canvases: Annotated[dict, _canvases_reducer] = {}


# Environment Configuration
CHAT_HISTORY_TABLE = os.environ.get("CHAT_HISTORY_TABLE")
TOOL_CONFIG_TABLE = os.environ.get("TOOL_CONFIG_TABLE")
SKILLS_TABLE = os.environ.get("SKILLS_TABLE")
KB_ID = os.environ.get("KB_ID")
RERANK_MODEL_ARN = os.environ.get("RERANK_MODEL_ARN")
KB_SEARCH_TYPE = os.environ.get("KB_SEARCH_TYPE", "HYBRID")
REGION = os.environ.get("REGION", "us-east-1")
MODEL_ID = os.environ.get("MODEL_ID")
S3_BUCKET = os.environ.get("S3_BUCKET")
MEMORY_ID = os.environ.get("MEMORY_ID")
PROJECTS_TABLE = os.environ.get("PROJECTS_TABLE")
PROJECT_FILES_TABLE = os.environ.get("PROJECT_FILES_TABLE")
PROJECTS_S3_BUCKET = os.environ.get("PROJECTS_S3_BUCKET")
PROJECT_CANVASES_TABLE = os.environ.get("PROJECT_CANVASES_TABLE")
PROJECTS_KB_ID = os.environ.get("PROJECTS_KB_ID")
PROJECTS_KB_DATA_SOURCE_ID = os.environ.get("PROJECTS_KB_DATA_SOURCE_ID")
PROJECT_MEMORY_ID = os.environ.get("PROJECT_MEMORY_ID")


def create_dynamodb_client(region: str = None) -> boto3.client:
    """Create DynamoDB client"""
    return boto3.client(
        "dynamodb", region_name=region or REGION, config=Config(read_timeout=30)
    )


def create_bedrock_client(region: str = None) -> boto3.client:
    """Create Bedrock Runtime client for model invocations"""
    return boto3.client(
        "bedrock-runtime", region_name=region or REGION, config=Config(read_timeout=300)
    )


def create_bedrock_agent_client(region: str = None) -> boto3.client:
    """Create Bedrock Agent Runtime client for KB operations"""
    return boto3.client(
        "bedrock-agent-runtime",
        region_name=region or REGION,
        config=Config(read_timeout=60),
    )


def create_eventbridge_client(region: str = None) -> boto3.client:
    """Create EventBridge client for KB event publishing"""
    return boto3.client("events", region_name=region or REGION)


# Initialize clients
dynamodb_client = create_dynamodb_client()
bedrock_client = create_bedrock_client()
bedrock_agent_client = create_bedrock_agent_client()
eventbridge_client = create_eventbridge_client()

# ---------------------------------------------------------------------------
# Build checkpointer — DynamoDB only
# Core-services only reads checkpoints (aget_state / aget_state_history).
# ---------------------------------------------------------------------------

CHECKPOINT_TABLE = os.environ.get("CHECKPOINT_TABLE")
if not CHECKPOINT_TABLE:
    raise ValueError("CHECKPOINT_TABLE environment variable is required")

CHECKPOINT_BUCKET = os.environ.get("CHECKPOINT_BUCKET")
CHECKPOINT_BUCKET_ENDPOINT = os.environ.get("CHECKPOINT_BUCKET_ENDPOINT")
EXPIRY_DURATION_DAYS = int(os.environ.get("EXPIRY_DURATION_DAYS", 365))

_dynamo_kwargs: dict = {
    "table_name": CHECKPOINT_TABLE,
    "region_name": REGION,
    "ttl_seconds": EXPIRY_DURATION_DAYS * 86400,
    "enable_checkpoint_compression": True,
}
if CHECKPOINT_BUCKET:
    _s3_config: dict = {"bucket_name": CHECKPOINT_BUCKET}
    if CHECKPOINT_BUCKET_ENDPOINT:
        _s3_config["endpoint_url"] = CHECKPOINT_BUCKET_ENDPOINT
    _dynamo_kwargs["s3_offload_config"] = _s3_config
checkpointer = DynamoDBSaver(**_dynamo_kwargs)


def _build_history_graph():
    """Build a minimal LangGraph graph solely to provide aget_state() access."""
    builder = StateGraph(HistoryState)
    builder.add_node("noop", lambda state: state)
    builder.set_entry_point("noop")
    builder.set_finish_point("noop")
    return builder.compile(checkpointer=checkpointer)


history_graph = _build_history_graph()

# Project long-term memory store (optional — only initialised when PROJECT_MEMORY_ID is set)
project_memory_store = (
    AgentCoreMemoryStore(memory_id=PROJECT_MEMORY_ID, region_name=REGION)
    if PROJECT_MEMORY_ID
    else None
)
