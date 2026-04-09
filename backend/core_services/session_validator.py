"""
Session Validation for Core_Services.

Provides session ownership validation and session_id format validation.
Unlike Sparky's validator, this does NOT use an in-memory cache because
Core_Services is stateless and handles requests from all users.
"""

import uuid
from typing import Optional, Tuple, Dict, Any

from chat_history_service import chat_history_service


async def validate_session_ownership(
    session_id: str, user_id: str
) -> Tuple[str, Optional[Dict[str, Any]]]:
    """
    Validate that the given user owns the specified session.

    Args:
        session_id: The session ID from the request payload.
        user_id: The user identifier from the JWT sub claim.

    Returns:
        ("authorized", session_record) if the user owns the session,
        ("unauthorized", None) if the session belongs to a different user,
        ("session_not_found", None) if no session exists with that ID.
    """
    session = await chat_history_service.get_session(session_id)

    if session is None:
        return ("session_not_found", None)

    if session.get("user_id") != user_id:
        return ("unauthorized", None)

    return ("authorized", session)


def validate_session_id(session_id: Optional[str]) -> Optional[str]:
    """
    Validate session_id is present and a valid UUID.

    Returns:
        "validation_error" if invalid or missing, None if valid.
    """
    if not session_id:
        return "validation_error"
    try:
        uuid.UUID(session_id)
        return None
    except (ValueError, AttributeError):
        return "validation_error"
