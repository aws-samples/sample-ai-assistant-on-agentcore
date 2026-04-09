"""
Expiry Cleanup Lambda Handler

This Lambda function processes SQS messages from the KB Cleanup Queue.
Each SQS message body contains a DynamoDB Stream REMOVE event forwarded
by an EventBridge Pipe. For each event, the handler:
  1. Parses the SQS message to extract session_id and user_id
  2. Deletes AgentCore Memory session events (non-blocking on failure)
  3. Deletes corresponding KB documents from the Bedrock Knowledge Base

Returns partial batch failure responses so only failed messages are retried.

"""

import json
import logging
import os
import time
from typing import Any, Dict, List, Optional, Tuple

import boto3
from botocore.config import Config

# Configure logging
LOG_LEVEL = os.environ.get("LOG_LEVEL", "INFO")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

# Environment variables
KB_ID = os.environ.get("KB_ID")
KB_DATA_SOURCE_ID = os.environ.get("KB_DATA_SOURCE_ID")
MEMORY_ID = os.environ.get("MEMORY_ID")
REGION = os.environ.get("REGION")

# Initialize clients
bedrock_agent_client = boto3.client("bedrock-agent", region_name=REGION)
agentcore_client = boto3.client(
    "bedrock-agentcore",
    region_name=REGION,
    config=Config(retries={"max_attempts": 8, "mode": "adaptive"}),
)

# Default max document IDs per session (matches kb_indexer pattern)
DEFAULT_MAX_MESSAGES = 100


def generate_document_id(session_id: str, message_index: int) -> str:
    """Generate a document identifier matching the KB indexer format.

    Args:
        session_id: The conversation session identifier
        message_index: The sequential message pair index

    Returns:
        Document ID in format "{session_id}_msg_{message_index}"
    """
    return f"{session_id}_msg_{message_index}"


def compute_ttl(current_time: int, expiry_days: int) -> int:
    """Compute the TTL epoch timestamp.

    Args:
        current_time: Current Unix epoch timestamp in seconds
        expiry_days: Number of days until expiry

    Returns:
        Unix epoch timestamp for when the item should expire
    """
    return current_time + expiry_days * 86400


def parse_sqs_record(
    record: Dict[str, Any],
) -> Tuple[Optional[str], Optional[str], str]:
    """Parse an SQS record to extract session_id and user_id.

    The SQS message body contains a JSON-encoded DynamoDB Stream REMOVE event
    forwarded by the EventBridge Pipe.

    Args:
        record: A single SQS event record

    Returns:
        Tuple of (session_id, user_id, message_id). session_id is None if
        the record is invalid/unparseable.
    """
    message_id = record.get("messageId", "unknown")

    try:
        parsed = json.loads(record["body"])
    except (json.JSONDecodeError, KeyError, TypeError) as e:
        logger.warning(
            "SQS message %s has invalid/missing body, skipping: %s",
            message_id,
            str(e),
        )
        return None, None, message_id

    old_image = parsed.get("dynamodb", {}).get("OldImage", {})

    session_id_attr = old_image.get("session_id")
    if not session_id_attr or not session_id_attr.get("S"):
        logger.warning(
            "SQS message %s missing session_id in OldImage, skipping",
            message_id,
        )
        return None, None, message_id

    session_id = session_id_attr["S"]

    user_id_attr = old_image.get("user_id")
    user_id = user_id_attr.get("S") if user_id_attr else None

    return session_id, user_id, message_id


def delete_memory_session(session_id: str, user_id: str) -> None:
    """Delete all AgentCore Memory events for a session.

    Lists events page-by-page and deletes each before fetching the next page
    to keep memory usage constant regardless of event count.

    Args:
        session_id: The session identifier
        user_id: The user identifier (used as actor_id)
    """
    try:
        deleted_count = 0
        paginator_params = {
            "memoryId": MEMORY_ID,
            "sessionId": session_id,
            "actorId": user_id,
        }
        response = agentcore_client.list_events(**paginator_params)

        while True:
            for event in response.get("events", []):
                event_id = event.get("eventId")
                if event_id:
                    agentcore_client.delete_event(
                        memoryId=MEMORY_ID,
                        sessionId=session_id,
                        actorId=user_id,
                        eventId=event_id,
                    )
                    deleted_count += 1
                    time.sleep(0.1)  # Throttle to avoid rate limiting

            next_token = response.get("nextToken")
            if not next_token:
                break
            paginator_params["nextToken"] = next_token
            response = agentcore_client.list_events(**paginator_params)

        logger.info(
            "Deleted %d memory events for session_id=%s",
            deleted_count,
            session_id,
        )
    except Exception as e:
        logger.error(
            "Failed to delete memory events for session_id=%s: %s",
            session_id,
            str(e),
            exc_info=True,
        )


def delete_session_documents(session_id: str) -> None:
    """Delete all KB documents for a session.

    Constructs document IDs using the format {session_id}_msg_{index}
    for up to DEFAULT_MAX_MESSAGES. Generates IDs per batch (max 25)
    to avoid allocating the full list in memory.

    Args:
        session_id: The session whose KB documents should be deleted
    """
    batch_size = 25
    for start in range(0, DEFAULT_MAX_MESSAGES, batch_size):
        end = min(start + batch_size, DEFAULT_MAX_MESSAGES)
        batch = [
            {
                "dataSourceType": "CUSTOM",
                "custom": {"id": generate_document_id(session_id, i)},
            }
            for i in range(start, end)
        ]
        bedrock_agent_client.delete_knowledge_base_documents(
            knowledgeBaseId=KB_ID,
            dataSourceId=KB_DATA_SOURCE_ID,
            documentIdentifiers=batch,
        )


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for SQS messages from the KB Cleanup Queue.

    Processes each SQS message, extracts session_id and user_id from the
    DynamoDB Stream event forwarded by EventBridge Pipe, deletes AgentCore
    Memory session events, then deletes KB documents. Returns partial batch
    failure responses so only failed messages are retried by SQS.

    Args:
        event: Lambda event containing SQS Records
        context: Lambda context object

    Returns:
        Dict with batchItemFailures list
    """
    records = event.get("Records", [])
    logger.debug("Processing %d SQS messages", len(records))

    batch_item_failures: List[Dict[str, str]] = []

    for record in records:
        session_id, user_id, message_id = parse_sqs_record(record)

        if not session_id:
            # Invalid/unparseable record — skip without adding to failures
            continue

        # Step 1: Delete AgentCore Memory session (non-blocking)
        if user_id:
            delete_memory_session(session_id, user_id)
        else:
            logger.warning(
                "Missing user_id for session_id=%s, skipping memory deletion",
                session_id,
            )

        # Step 2: Delete KB documents (failure → add to batch failures)
        try:
            logger.info("Deleting KB documents for session_id=%s", session_id)
            delete_session_documents(session_id)
            logger.info(
                "Successfully deleted KB documents for session_id=%s", session_id
            )
        except Exception as e:
            logger.error(
                "Failed to delete KB documents for session_id=%s: %s",
                session_id,
                str(e),
                exc_info=True,
            )
            batch_item_failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": batch_item_failures}
