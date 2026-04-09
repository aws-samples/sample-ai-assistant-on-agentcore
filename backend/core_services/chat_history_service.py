"""
Chat History Service for Core-Services.

Provides CRUD operations for managing chat session history in DynamoDB.
Sessions are stored with user association and support description generation.
"""

from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
import os
import time
import boto3
from botocore.exceptions import ClientError

from config import CHAT_HISTORY_TABLE, REGION
from utils import logger

# Environment configuration
EXPIRY_DURATION_DAYS = int(os.environ.get("EXPIRY_DURATION_DAYS", "365"))

# GSI name for user queries
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
            self.table.put_item(
                Item=item, ConditionExpression="attribute_not_exists(session_id)"
            )
            logger.debug(f"Created session record: {session_id} for user: {user_id}")
            return item

        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code", "")

            if error_code == "ConditionalCheckFailedException":
                # Session already exists - this is expected if called multiple times
                logger.debug(f"Session record already exists: {session_id}")
                # Return the existing record
                existing = await self.get_session(session_id)
                return existing if existing else item
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
            response = self.table.get_item(Key={"session_id": session_id})
            return response.get("Item")
        except ClientError as e:
            logger.error(f"Error getting session {session_id}: {e}")
            raise

    async def get_user_sessions(
        self,
        user_id: str,
        limit: int = 20,
        last_evaluated_key: Optional[Dict[str, Any]] = None,
        bookmarked_filter: Optional[bool] = None,
    ) -> Dict[str, Any]:
        """
        Get paginated sessions for a user, ordered by created_at descending.

        Uses the user_id-index GSI to efficiently query sessions by user.
        Results are sorted by created_at in descending order (most recent first).

        Args:
            user_id: The authenticated user ID
            limit: Maximum number of sessions to return (default 20)
            last_evaluated_key: Pagination cursor from previous query
            bookmarked_filter: When False, exclude bookmarked sessions.
                               Legacy sessions without the attribute are treated as non-bookmarked.

        Returns:
            Dict containing:
            - sessions: List of session records
            - last_evaluated_key: Cursor for next page (None if no more pages)
            - has_more: Boolean indicating if more pages exist
        """
        try:
            expr_values = {":uid": user_id}
            query_params = {
                "IndexName": USER_ID_INDEX,
                "KeyConditionExpression": "user_id = :uid",
                "ScanIndexForward": False,  # Descending order by created_at
                "Limit": limit,
            }

            if bookmarked_filter is False:
                query_params["FilterExpression"] = (
                    "attribute_not_exists(bookmarked) OR bookmarked = :bval"
                )
                expr_values[":bval"] = False

            query_params["ExpressionAttributeValues"] = expr_values

            if last_evaluated_key:
                query_params["ExclusiveStartKey"] = last_evaluated_key

            response = self.table.query(**query_params)

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
            self.table.update_item(
                Key={"session_id": session_id},
                UpdateExpression="SET description = :desc",
                ExpressionAttributeValues={":desc": description},
                ConditionExpression="attribute_exists(session_id)",
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
            self.table.delete_item(Key={"session_id": session_id})
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

    async def toggle_bookmark(self, session_id: str, user_id: str) -> Dict[str, Any]:
        """
        Toggle the bookmarked state of a session.

        Flips the bookmarked Boolean on the session record. When bookmarking
        (false→true), enforces a per-user cap of 50 bookmarked sessions.
        Unbookmarking (true→false) always succeeds without a count check.

        Args:
            session_id: The session to toggle
            user_id: The authenticated user — must own the session

        Returns:
            Dict with session_id and the new bookmarked value

        Raises:
            ValueError: session_not_found, unauthorized, or bookmark_limit_reached
        """
        session = await self.get_session(session_id)
        if not session:
            raise ValueError("session_not_found")
        if session.get("user_id") != user_id:
            raise ValueError("unauthorized")

        current = session.get("bookmarked", False)
        new_value = not current

        # Enforce the 50-bookmark cap only when bookmarking
        if new_value:
            count = await self.count_bookmarked_sessions(user_id)
            if count >= 50:
                raise ValueError("bookmark_limit_reached")

        try:
            self.table.update_item(
                Key={"session_id": session_id},
                UpdateExpression="SET bookmarked = :val",
                ExpressionAttributeValues={":val": new_value},
                ConditionExpression="attribute_exists(session_id)",
            )
        except ClientError as e:
            logger.error(f"Error toggling bookmark for session {session_id}: {e}")
            raise

        logger.debug(f"Toggled bookmark for session {session_id} to {new_value}")
        return {"session_id": session_id, "bookmarked": new_value}

    async def count_bookmarked_sessions(self, user_id: str) -> int:
        """
        Count how many sessions a user currently has bookmarked.

        Uses the user_id-index GSI with SELECT COUNT and a filter on
        bookmarked = true so DynamoDB returns only the count, not the items.

        Args:
            user_id: The user whose bookmarks to count

        Returns:
            Number of bookmarked sessions
        """
        try:
            response = self.table.query(
                IndexName=USER_ID_INDEX,
                KeyConditionExpression="user_id = :uid",
                FilterExpression="bookmarked = :bval",
                ExpressionAttributeValues={":uid": user_id, ":bval": True},
                Select="COUNT",
            )
            return response.get("Count", 0)
        except ClientError as e:
            logger.error(f"Error counting bookmarked sessions for user {user_id}: {e}")
            raise

    async def get_bookmarked_sessions(self, user_id: str) -> List[Dict[str, Any]]:
        """
        Return all bookmarked sessions for a user, ordered by created_at descending.

        Paginates internally (loops on LastEvaluatedKey) and returns the full
        list. Safe because bookmarks are capped at 50 per user.

        Args:
            user_id: The user whose bookmarked sessions to fetch

        Returns:
            List of bookmarked session records
        """
        sessions: List[Dict[str, Any]] = []
        query_params = {
            "IndexName": USER_ID_INDEX,
            "KeyConditionExpression": "user_id = :uid",
            "FilterExpression": "bookmarked = :bval",
            "ExpressionAttributeValues": {":uid": user_id, ":bval": True},
            "ScanIndexForward": False,
        }

        try:
            while True:
                response = self.table.query(**query_params)
                sessions.extend(response.get("Items", []))
                last_key = response.get("LastEvaluatedKey")
                if not last_key:
                    break
                query_params["ExclusiveStartKey"] = last_key
        except ClientError as e:
            logger.error(f"Error fetching bookmarked sessions for user {user_id}: {e}")
            raise

        return sessions

    async def bind_project(self, session_id: str, project_id: str) -> bool:
        """
        Write project_id onto a chat session record.

        Replaces any existing binding (a session can be bound to at most
        one project at a time). Returns False if the session doesn't exist.
        """
        try:
            self.table.update_item(
                Key={"session_id": session_id},
                UpdateExpression="SET project_id = :pid",
                ExpressionAttributeValues={":pid": project_id},
                ConditionExpression="attribute_exists(session_id)",
            )
            logger.debug(f"Bound project {project_id} to session {session_id}")
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
                return False
            raise

    async def unbind_project(self, session_id: str) -> bool:
        """
        Remove the project_id attribute from a chat session record.

        Idempotent — succeeds even if no project was bound or the
        session doesn't exist.
        """
        try:
            self.table.update_item(
                Key={"session_id": session_id},
                UpdateExpression="REMOVE project_id",
            )
            logger.debug(f"Unbound project from session {session_id}")
            return True
        except ClientError as e:
            logger.error(f"Error unbinding project from session {session_id}: {e}")
            raise

    async def get_project_id(self, session_id: str) -> Optional[str]:
        """
        Return the project_id bound to a session, or None if not bound.
        """
        try:
            response = self.table.get_item(
                Key={"session_id": session_id},
                ProjectionExpression="project_id",
            )
            item = response.get("Item")
            return item.get("project_id") if item else None
        except ClientError as e:
            logger.error(f"Error fetching project_id for session {session_id}: {e}")
            raise

    async def clear_project_bindings_for_project(
        self, project_id: str, user_id: str
    ) -> int:
        """
        Unset project_id on all sessions owned by user_id that reference
        this project. Called during cascade project deletion.

        Queries the user_id GSI, filters client-side for matching project_id,
        then removes the attribute from each affected session.

        Returns the number of sessions unbound.
        """
        unbound = 0
        query_params: Dict[str, Any] = {
            "IndexName": USER_ID_INDEX,
            "KeyConditionExpression": "user_id = :uid",
            "ExpressionAttributeValues": {":uid": user_id},
            "ProjectionExpression": "session_id, project_id",
        }
        try:
            while True:
                response = self.table.query(**query_params)
                for session in response.get("Items", []):
                    if session.get("project_id") == project_id:
                        await self.unbind_project(session["session_id"])
                        unbound += 1
                last_key = response.get("LastEvaluatedKey")
                if not last_key:
                    break
                query_params["ExclusiveStartKey"] = last_key
        except ClientError as e:
            logger.error(
                f"Error clearing project bindings for project {project_id}: {e}"
            )
            raise

        logger.debug(f"Cleared {unbound} session binding(s) for project {project_id}")
        return unbound

    async def get_sessions_for_project(
        self, project_id: str, user_id: str
    ) -> List[Dict[str, Any]]:
        """
        Return all sessions owned by user_id that are bound to project_id.

        Queries the user_id GSI, filters client-side for matching project_id.
        Returns session_id, description, and created_at for each match,
        ordered by created_at descending.
        """
        sessions: List[Dict[str, Any]] = []
        query_params: Dict[str, Any] = {
            "IndexName": USER_ID_INDEX,
            "KeyConditionExpression": "user_id = :uid",
            "ExpressionAttributeValues": {":uid": user_id},
            "ProjectionExpression": "session_id, project_id, description, created_at",
            "ScanIndexForward": False,
        }
        try:
            while True:
                response = self.table.query(**query_params)
                for s in response.get("Items", []):
                    if s.get("project_id") == project_id:
                        sessions.append(
                            {
                                "session_id": s["session_id"],
                                "description": s.get("description"),
                                "created_at": s.get("created_at"),
                            }
                        )
                last_key = response.get("LastEvaluatedKey")
                if not last_key:
                    break
                query_params["ExclusiveStartKey"] = last_key
        except ClientError as e:
            logger.error(f"Error fetching sessions for project {project_id}: {e}")
            raise

        return sessions

    async def session_exists(self, session_id: str) -> bool:
        """
        Check if a session record exists in the Chat_History_Table.

        Args:
            session_id: The session ID to check

        Returns:
            True if session exists, False otherwise
        """
        try:
            response = self.table.get_item(
                Key={"session_id": session_id},
                ProjectionExpression="session_id",  # Only fetch the key
            )
            exists = "Item" in response
            logger.debug(f"Session {session_id} exists: {exists}")
            return exists

        except ClientError as e:
            logger.error(f"Error checking session existence {session_id}: {e}")
            raise


# Global service instance
chat_history_service = ChatHistoryService()
