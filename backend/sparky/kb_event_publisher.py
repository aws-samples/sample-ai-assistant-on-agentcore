"""
KB Event Publisher module for publishing conversation events to SQS for Knowledge Base indexing.

This module provides functionality to asynchronously publish conversation pairs
to an SQS queue, which triggers a Lambda function to ingest documents in
Amazon Bedrock Knowledge Base.

"""

import json
import os
import asyncio
from datetime import datetime, timezone
from typing import Optional, Union, List, Dict, Any
import boto3
from utils import logger


def extract_text_content(content: Union[str, List[Any]]) -> str:
    """Extract only text content from a message, stripping images/documents.

    Handles both simple string content and multimodal content lists.
    Filters out: image blocks, document blocks, cachePoint markers.

    Args:
        content: Either a string or a list of content blocks (multimodal format)

    Returns:
        Extracted text content as a single string

    """
    if isinstance(content, str):
        return content

    if not isinstance(content, list):
        return str(content) if content else ""

    text_parts = []
    for item in content:
        if isinstance(item, dict):
            item_type = item.get("type")
            # Extract text from text blocks
            if item_type == "text":
                text_value = item.get("text", "")
                if text_value:
                    text_parts.append(text_value)
            # Skip image, document, cachePoint, and other non-text types
            elif item_type in (
                "image",
                "document",
                "image_url",
                "tool_use",
                "tool_result",
            ):
                continue
            # Skip cachePoint markers
            elif "cachePoint" in item:
                continue
        elif isinstance(item, str):
            text_parts.append(item)

    return " ".join(text_parts).strip()


class KBEventPublisher:
    """Publishes conversation events to SQS for KB indexing.

    This class handles asynchronous publishing of conversation pairs
    to an SQS queue. Events are processed by a Lambda function that
    ingests documents in Amazon Bedrock Knowledge Base.

    Attributes:
        queue_url: The SQS queue URL for KB indexing events
        sqs_client: Boto3 SQS client (None if disabled)
        enabled: Whether KB indexing is enabled

    """

    def __init__(self, queue_url: Optional[str] = None):
        """Initialize the KB Event Publisher.

        Args:
            queue_url: SQS queue URL. If None, reads from KB_INDEXING_QUEUE_URL
                      environment variable. If still None, publishing is disabled.

        """
        self.queue_url = queue_url or os.environ.get("KB_INDEXING_QUEUE_URL")
        self.enabled = self.queue_url is not None

        if self.enabled:
            self.sqs_client = boto3.client("sqs")
            logger.debug(f"KB Event Publisher initialized with queue: {self.queue_url}")
        else:
            self.sqs_client = None
            logger.debug("KB Event Publisher disabled - no queue URL configured")

    async def publish_conversation(
        self,
        session_id: str,
        user_id: str,
        message_index: int,
        user_message: str,
        ai_response: str,
        description: Optional[str] = None,
    ) -> bool:
        """Publish a conversation pair for KB indexing.

        Publishes an ingest event to SQS containing the conversation content
        and metadata. Uses fire-and-forget pattern to avoid blocking.

        Args:
            session_id: The conversation thread/session identifier
            user_id: The authenticated user's identifier
            message_index: Sequential index of this message pair in the session
            user_message: The user's message text (already extracted from multimodal)
            ai_response: The AI's response text
            description: Optional chat session description/title

        Returns:
            True if publish succeeded, False otherwise

        """
        if not self.enabled:
            logger.debug("KB indexing disabled, skipping conversation publish")
            return False

        try:
            event_payload = {
                "event_type": "ingest",
                "session_id": session_id,
                "user_id": user_id,
                "message_index": message_index,
                "user_message": user_message,
                "ai_response": ai_response,
                "description": description,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }

            # Run SQS send in executor to avoid blocking async loop
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None, self._send_message, json.dumps(event_payload)
            )

            logger.debug(
                f"Published KB ingest event for session={session_id}, "
                f"message_index={message_index}"
            )
            return True

        except Exception as e:
            # Log error but don't affect user experience
            logger.error(
                f"Failed to publish KB ingest event for session={session_id}: {e}"
            )
            return False

    def _send_message(self, message_body: str) -> Dict[str, Any]:
        """Send a message to the SQS queue (synchronous).

        This is called via run_in_executor to avoid blocking the async loop.

        Args:
            message_body: JSON string of the event payload

        Returns:
            SQS SendMessage response

        Raises:
            ClientError: If SQS send fails
        """
        return self.sqs_client.send_message(
            QueueUrl=self.queue_url, MessageBody=message_body
        )


# Global instance - initialized lazily based on environment
_kb_event_publisher: Optional[KBEventPublisher] = None


def get_kb_event_publisher() -> KBEventPublisher:
    """Get the global KB Event Publisher instance.

    Creates the instance on first call, using the KB_INDEXING_QUEUE_URL
    environment variable to determine if publishing is enabled.

    Returns:
        The global KBEventPublisher instance
    """
    global _kb_event_publisher
    if _kb_event_publisher is None:
        _kb_event_publisher = KBEventPublisher()
    return _kb_event_publisher
