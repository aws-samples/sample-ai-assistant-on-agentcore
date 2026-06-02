"""
KB Indexer Lambda Handler

This Lambda function processes SQS events for Knowledge Base indexing operations.
It handles two event types:
- ingest: Adds conversation documents to Bedrock Knowledge Base
- delete: Removes all documents for a session from Bedrock Knowledge Base

"""

import json
import logging
import os
from typing import Any, Dict, List

import boto3

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Environment variables
KB_ID = os.environ.get("KB_ID")
KB_DATA_SOURCE_ID = os.environ.get("KB_DATA_SOURCE_ID")

# Initialize Bedrock Agent client
bedrock_agent_client = boto3.client("bedrock-agent")


def generate_document_id(session_id: str, message_index: int) -> str:
    """Generate a unique document identifier.

    Args:
        session_id: The conversation session identifier
        message_index: The sequential message pair index

    Returns:
        Document ID in format "{session_id}_msg_{message_index}"

    """
    return f"{session_id}_msg_{message_index}"


def build_document_content(
    session_id: str, message_index: int, user_message: str, ai_response: str
) -> Dict[str, Any]:
    """Build the document content structure for KB ingestion.

    Args:
        session_id: The conversation session identifier
        message_index: The sequential message pair index
        user_message: The user's message text
        ai_response: The AI's response text

    Returns:
        Document content structure for IngestKnowledgeBaseDocuments API

    """
    document_id = generate_document_id(session_id, message_index)

    # Combine user message and AI response into document text
    document_text = f"User: {user_message}\n\nAssistant: {ai_response}"

    return {
        "dataSourceType": "CUSTOM",
        "custom": {
            "customDocumentIdentifier": {"id": document_id},
            "inlineContent": {"textContent": {"data": document_text}, "type": "TEXT"},
            "sourceType": "IN_LINE",
        },
    }


def build_document_metadata(
    user_id: str,
    session_id: str,
    message_index: int,
    timestamp: str,
    description: str = None,
) -> Dict[str, Any]:
    """Build the document metadata structure for KB ingestion.

    Args:
        user_id: The authenticated user's identifier
        session_id: The conversation session identifier
        message_index: The sequential message pair index
        timestamp: ISO 8601 formatted timestamp
        description: Optional chat session description/title

    Returns:
        Document metadata structure for IngestKnowledgeBaseDocuments API

    """
    attributes = [
        {"key": "user_id", "value": {"stringValue": user_id, "type": "STRING"}},
        {"key": "session_id", "value": {"stringValue": session_id, "type": "STRING"}},
        {
            "key": "message_index",
            "value": {"numberValue": message_index, "type": "NUMBER"},
        },
        {"key": "timestamp", "value": {"stringValue": timestamp, "type": "STRING"}},
    ]

    # Add description if provided
    if description:
        attributes.append(
            {
                "key": "description",
                "value": {"stringValue": description, "type": "STRING"},
            }
        )

    return {"inlineAttributes": attributes, "type": "IN_LINE_ATTRIBUTE"}


def ingest_document(message: Dict[str, Any]) -> None:
    """Ingest a conversation document into Bedrock Knowledge Base.

    Args:
        message: The SQS message payload containing conversation data

    Raises:
        ClientError: If the IngestKnowledgeBaseDocuments API call fails

    """
    session_id = message["session_id"]
    user_id = message["user_id"]
    message_index = message["message_index"]
    user_message = message["user_message"]
    ai_response = message["ai_response"]
    timestamp = message["timestamp"]
    description = message.get("description")

    document_content = build_document_content(
        session_id=session_id,
        message_index=message_index,
        user_message=user_message,
        ai_response=ai_response,
    )

    document_metadata = build_document_metadata(
        user_id=user_id,
        session_id=session_id,
        message_index=message_index,
        timestamp=timestamp,
        description=description,
    )

    document = {"content": document_content, "metadata": document_metadata}

    logger.debug(
        f"Ingesting document for session={session_id}, message_index={message_index}"
    )

    response = bedrock_agent_client.ingest_knowledge_base_documents(
        knowledgeBaseId=KB_ID, dataSourceId=KB_DATA_SOURCE_ID, documents=[document]
    )

    logger.debug(
        f"Successfully ingested document: "
        f"session={session_id}, message_index={message_index}, "
        f"response={response}"
    )


def delete_session_documents(session_id: str, message_count: int = None) -> None:
    """Delete all documents for a session from the Knowledge Base.

    If message_count is provided, constructs document IDs directly using the
    known format {session_id}_msg_{index} for efficient batch deletion.
    Otherwise falls back to a reasonable default max (100 messages).

    Args:
        session_id: The session identifier whose documents should be deleted
        message_count: Optional count of messages to delete. If None, uses
                      default max of 100.

    """
    # Use provided count or default to 100 (reasonable max for a chat session)
    count = message_count if message_count is not None else 100

    if count <= 0:
        logger.debug(f"No documents to delete for session={session_id}")
        return

    # Construct document IDs directly using known format
    document_ids = [generate_document_id(session_id, i) for i in range(count)]

    # Build document identifiers for batch deletion
    document_identifiers = [
        {"dataSourceType": "CUSTOM", "custom": {"id": doc_id}}
        for doc_id in document_ids
    ]

    logger.debug(f"Deleting up to {count} documents for session={session_id}")

    # DeleteKnowledgeBaseDocuments accepts max 25 identifiers per call
    batch_size = 25
    for start in range(0, len(document_identifiers), batch_size):
        batch = document_identifiers[start : start + batch_size]
        response = bedrock_agent_client.delete_knowledge_base_documents(
            knowledgeBaseId=KB_ID,
            dataSourceId=KB_DATA_SOURCE_ID,
            documentIdentifiers=batch,
        )

        logger.debug(
            f"Delete batch request completed for session={session_id}, "
            f"batch_start={start}, response={response}"
        )


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """Lambda handler for processing SQS events.

    Processes each SQS record and routes to appropriate handler based on
    event_type (ingest or delete).

    Args:
        event: Lambda event containing SQS records
        context: Lambda context object

    Returns:
        Dict with batchItemFailures — only the records that failed are reported,
        so SQS retries just those messages instead of the whole batch. The event
        source mapping has function_response_types=["ReportBatchItemFailures"].

    """
    records = event.get("Records", [])
    logger.debug(f"Processing {len(records)} SQS records")

    batch_item_failures: List[Dict[str, str]] = []

    for record in records:
        message_id = record.get("messageId", "unknown")
        try:
            message = json.loads(record["body"])
            event_type = message.get("event_type")

            logger.debug(
                f"Processing event_type={event_type}, "
                f"session_id={message.get('session_id')}"
            )

            if event_type == "ingest":
                ingest_document(message)
            elif event_type == "delete":
                delete_session_documents(
                    session_id=message["session_id"],
                    message_count=message.get("message_count"),
                )
            else:
                # Unknown/malformed event types are not retryable — log and drop
                # so a single poison message can't be retried forever or fail the
                # batch. (No itemIdentifier appended → treated as succeeded.)
                logger.warning(
                    f"Unknown event_type: {event_type}, message_id={message_id}"
                )

        except Exception as e:
            # Report only this record as failed so good messages in the same
            # batch are not re-driven / DLQ'd alongside it.
            logger.error(f"Error processing record {message_id}: {e}", exc_info=True)
            batch_item_failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": batch_item_failures}
