"""
Session Ownership Validator for Sparky Agent.

Validates that the authenticated user owns the target session before
allowing request processing.

Sessions created via create_session are registered in memory and never
need a DynamoDB lookup for the lifetime of the process.  Sessions that
are resumed without a prior create_session (e.g. prepare, direct invoke)
are validated against DynamoDB and then cached in the same in-memory set.
"""

from typing import Literal
from chat_history_service import chat_history_service
from utils import logger

# Validation result type
ValidationResult = Literal["authorized", "unauthorized", "session_not_found"]

# In-memory set of verified (session_id, user_sub) pairs.
# Populated either by register_session (create_session path) or by a
# successful DynamoDB ownership check.  Entries live for the lifetime of
# the process — which matches the agentcore runtime session lifetime.
_authorized_sessions: set[tuple[str, str]] = set()


def register_session(session_id: str, user_sub: str) -> None:
    """
    Register a newly created session as authorized in memory.

    Called from the create_session handler so that all subsequent
    requests for this session skip the DynamoDB ownership lookup.
    """
    _authorized_sessions.add((session_id, user_sub))
    logger.debug(f"Registered session={session_id} for user={user_sub}")


def deregister_session(session_id: str, user_sub: str) -> None:
    """
    Remove a session from the in-memory authorization cache.

    Called after a session is deleted so that the cache entry doesn't
    linger for the lifetime of the process.
    """
    _authorized_sessions.discard((session_id, user_sub))
    logger.debug(f"Deregistered session={session_id} for user={user_sub}")


async def validate_session_ownership(
    session_id: str, user_sub: str
) -> ValidationResult:
    """
    Validate that the given user owns the specified session.

    Fast path: if the session was created (or previously validated) in
    this process, return authorized immediately from the in-memory set.

    Slow path: query DynamoDB via chat_history_service.  On success the
    pair is added to the in-memory set so future calls are instant.

    Args:
        session_id: The Bedrock session ID from the request header.
        user_sub: The user identifier from the JWT sub claim.

    Returns:
        "authorized" if the user owns the session,
        "unauthorized" if the session belongs to a different user,
        "session_not_found" if no session exists with that ID.
    """
    if (session_id, user_sub) in _authorized_sessions:
        logger.debug(f"Session validation in-memory hit for session={session_id}")
        return "authorized"

    session = await chat_history_service.get_session(session_id)

    if session is None:
        return "session_not_found"

    if session["user_id"] != user_sub:
        return "unauthorized"

    # Verified — remember for the lifetime of the process
    _authorized_sessions.add((session_id, user_sub))
    return "authorized"
