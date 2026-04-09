"""
Chat History Service for Sparky Agent.

Provides CRUD operations for managing chat session history in DynamoDB.
Sessions are stored with user association and support description generation.
"""

from typing import Optional, Dict, Any
from datetime import datetime, timezone
import asyncio
import time
import boto3
from botocore.exceptions import ClientError
import os
import logging

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Environment configuration
CHAT_HISTORY_TABLE = os.environ.get("CHAT_HISTORY_TABLE", "sparky-chat-history")
REGION = os.environ.get("REGION", "us-east-1")
EXPIRY_DURATION_DAYS = int(os.environ.get("EXPIRY_DURATION_DAYS", "365"))
USER_ID_INDEX = "user_id-index"


class ChatHistoryService:
    """
    Service for managing chat session history in DynamoDB.

    Provides operations for:
    - Creating session records (one-time insert on first message)
    - Fetching user sessions (ordered by created_at desc)
    - Updating session descriptions
    - Deleting sessions
    - Checking session existence
    """

    def __init__(self, table_name: Optional[str] = None, region: Optional[str] = None):
        """
        Initialize ChatHistoryService with DynamoDB table configuration.

        Args:
            table_name: DynamoDB table name. Defaults to CHAT_HISTORY_TABLE env var.
            region: AWS region. Defaults to REGION env var.
        """
        self.table_name = table_name or CHAT_HISTORY_TABLE
        self.region = region or REGION
        self.dynamodb = boto3.resource("dynamodb", region_name=self.region)
        self.table = self.dynamodb.Table(self.table_name)
        logger.debug(f"ChatHistoryService initialized with table: {self.table_name}")

    async def create_session_record(
        self, session_id: str, user_id: str
    ) -> Dict[str, Any]:
        """
        Create a new session record in the Chat_History_Table.

        This is a one-time insert operation that occurs when the first message
        is sent in a session. Uses a conditional write to prevent duplicate
        records if called multiple times.

        Args:
            session_id: The Bedrock session ID (primary key)
            user_id: The authenticated user ID from JWT token

        Returns:
            Dict containing the created session record with session_id, user_id,
            created_at, and description (initially None)

        Raises:
            ClientError: If DynamoDB operation fails (except ConditionalCheckFailed)
        """
        created_at = datetime.now(timezone.utc).isoformat()
        expiry_ttl = int(time.time()) + (EXPIRY_DURATION_DAYS * 86400)

        item = {
            "session_id": session_id,
            "user_id": user_id,
            "created_at": created_at,
            "description": None,
            "expiry_ttl": expiry_ttl,
        }

        try:
            # Use conditional write to ensure one-time insert
            await asyncio.to_thread(
                lambda: self.table.put_item(
                    Item=item,
                    ConditionExpression="attribute_not_exists(session_id)",
                )
            )
            logger.debug(f"Created session record: {session_id} for user: {user_id}")
            return item

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")

            if error_code == "ConditionalCheckFailedException":
                # Session already exists - this is expected if called multiple times
                logger.debug(f"Session record already exists: {session_id}")
                # Return the original item as a best-effort fallback —
                # avoid re-entrant DynamoDB call that could mask the original error.
                return item
            else:
                logger.error(f"Error creating session record: {e}")
                raise

    async def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        """
        Get a single session record by session_id.

        Args:
            session_id: The session ID to retrieve

        Returns:
            Session record dict or None if not found
        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.get_item(Key={"session_id": session_id})
            )
            return response.get("Item")
        except ClientError as e:
            logger.error(f"Error getting session {session_id}: {e}")
            raise

    async def get_project_id(self, session_id: str) -> Optional[str]:
        """Return the project_id bound to a session, or None if not bound.

        Args:
            session_id: The session ID to query

        Returns:
            The project_id string, or None if no project is bound or session not found
        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.get_item(
                    Key={"session_id": session_id},
                    ProjectionExpression="project_id",
                )
            )
            item = response.get("Item")
            return item.get("project_id") if item else None
        except ClientError as e:
            logger.error(f"Error fetching project_id for session {session_id}: {e}")
            return None

    async def get_user_sessions(
        self,
        user_id: str,
        limit: int = 20,
        last_evaluated_key: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Get paginated sessions for a user, ordered by created_at descending.

        Uses the user_id-index GSI to efficiently query sessions by user.
        Results are sorted by created_at in descending order (most recent first).

        Args:
            user_id: The authenticated user ID
            limit: Maximum number of sessions to return (default 20)
            last_evaluated_key: Pagination cursor from previous query

        Returns:
            Dict containing:
            - sessions: List of session records
            - last_evaluated_key: Cursor for next page (None if no more pages)
            - has_more: Boolean indicating if more pages exist
        """
        try:
            query_params = {
                "IndexName": USER_ID_INDEX,
                "KeyConditionExpression": "user_id = :uid",
                "ExpressionAttributeValues": {":uid": user_id},
                "ScanIndexForward": False,  # Descending order by created_at
                "Limit": limit,
            }

            if last_evaluated_key:
                query_params["ExclusiveStartKey"] = last_evaluated_key

            response = await asyncio.to_thread(lambda: self.table.query(**query_params))

            sessions = response.get("Items", [])
            next_key = response.get("LastEvaluatedKey")

            return {
                "sessions": sessions,
                "last_evaluated_key": next_key,
                "has_more": next_key is not None,
            }

        except ClientError as e:
            logger.error(f"Error fetching sessions for user {user_id}: {e}")
            raise

    async def update_session_description(
        self, session_id: str, description: str
    ) -> bool:
        """
        Update a session with a generated description.

        Args:
            session_id: The session ID to update
            description: The generated description text

        Returns:
            True if update was successful, False otherwise
        """
        try:
            await asyncio.to_thread(
                lambda: self.table.update_item(
                    Key={"session_id": session_id},
                    UpdateExpression="SET description = :desc",
                    ExpressionAttributeValues={":desc": description},
                    ConditionExpression="attribute_exists(session_id)",
                )
            )
            logger.debug(f"Updated description for session: {session_id}")
            return True

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")

            if error_code == "ConditionalCheckFailedException":
                logger.warning(
                    f"Session not found for description update: {session_id}"
                )
                return False
            else:
                logger.error(f"Error updating session description: {e}")
                raise

    async def delete_session(self, session_id: str) -> bool:
        """
        Delete a session record from the Chat_History_Table.

        This operation is idempotent - returns True even if the session
        doesn't exist (already deleted).

        Args:
            session_id: The session ID to delete

        Returns:
            True if deletion was successful or session didn't exist
        """
        try:
            await asyncio.to_thread(
                lambda: self.table.delete_item(Key={"session_id": session_id})
            )
            logger.debug(f"Deleted session record: {session_id}")
            return True

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")

            if error_code == "ResourceNotFoundException":
                # Session doesn't exist - this is fine (idempotent delete)
                logger.debug(f"Session not found (already deleted): {session_id}")
                return True
            else:
                logger.error(f"Error deleting session {session_id}: {e}")
                raise

    async def session_exists(self, session_id: str) -> bool:
        """
        Check if a session record exists in the Chat_History_Table.

        Args:
            session_id: The session ID to check

        Returns:
            True if session exists, False otherwise
        """
        try:
            response = await asyncio.to_thread(
                lambda: self.table.get_item(
                    Key={"session_id": session_id},
                    ProjectionExpression="session_id",  # Only fetch the key
                )
            )
            exists = "Item" in response
            logger.debug(f"Session {session_id} exists: {exists}")
            return exists

        except ClientError as e:
            logger.error(f"Error checking session existence {session_id}: {e}")
            raise


# Global service instance
chat_history_service = ChatHistoryService()
