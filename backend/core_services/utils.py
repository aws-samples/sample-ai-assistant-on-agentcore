import json
import logging
import traceback
import base64
import ipaddress
import socket
from decimal import Decimal
from typing import Any, Dict
from urllib.parse import urlparse
from fastapi.responses import JSONResponse

# Configure logger
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def validate_mcp_url(url: str) -> None:
    """Validate a user-supplied MCP server URL to prevent SSRF attacks.

    Enforces HTTPS only, rejects embedded credentials, and rejects hostnames
    that resolve to loopback, private, link-local, reserved, multicast, or
    unspecified addresses (covering cloud metadata endpoints such as
    169.254.169.254 and fd00:ec2::254).

    Must be called immediately before each connection attempt so the
    resolve-then-validate window stays small. Raises ValueError if the URL is
    not safe to connect to. Kept self-contained (no cross-package import) so the
    core_services runtime does not depend on the sparky package.
    """
    parsed = urlparse(url)
    if parsed.scheme != "https":
        raise ValueError(
            f"Unsupported URL scheme: {parsed.scheme or '(none)'}. Only https is allowed."
        )

    if parsed.username or parsed.password:
        raise ValueError("MCP server URL must not contain embedded credentials.")

    hostname = parsed.hostname
    if not hostname:
        raise ValueError("URL is missing a hostname.")

    _blocked_hostnames = {"localhost", "metadata.google.internal"}
    _blocked_suffixes = (".localhost", ".internal", ".local")
    host_lower = hostname.lower().rstrip(".")
    if host_lower in _blocked_hostnames or host_lower.endswith(_blocked_suffixes):
        raise ValueError(f"MCP server URL targets a blocked hostname: {hostname}")

    try:
        resolved = socket.getaddrinfo(
            hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
    except socket.gaierror as e:
        raise ValueError(f"Cannot resolve MCP server hostname '{hostname}': {e}")

    if not resolved:
        raise ValueError(f"MCP server hostname '{hostname}' did not resolve.")

    for _family, _type, _proto, _canonname, sockaddr in resolved:
        ip = ipaddress.ip_address(sockaddr[0])
        mapped = getattr(ip, "ipv4_mapped", None)
        if mapped is not None:
            ip = mapped
        if (
            ip.is_loopback
            or ip.is_private
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise ValueError(f"MCP server URL resolves to a blocked address: {ip}")


# CORS Headers for API responses
CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "*",
}


def error_envelope(error_code: str, message: str, details: dict = None) -> JSONResponse:
    """Return an HTTP 200 JSONResponse with a structured error body."""
    body = {
        "type": "error",
        "error_code": error_code,
        "message": message,
    }
    if details is not None:
        body["details"] = details
    return JSONResponse(body, headers=CORS_HEADERS)


def log_error(error: Exception, custom_message: str = None) -> None:
    """Log error as dictionary with error message and traceback details"""
    error_dict = {
        "error": custom_message or str(error),
        "details": traceback.format_exc(),
    }
    logger.error(json.dumps(error_dict, indent=2))


def decode_jwt_token(token: str) -> Dict[str, Any]:
    """
    Decode JWT token without verification to extract claims.
    The token is already validated by the API Gateway/Authorizer.

    Args:
        token: JWT token string (with or without 'Bearer ' prefix)

    Returns:
        Dictionary containing the decoded JWT payload
    """
    # Remove 'Bearer ' prefix if present
    if token.startswith("Bearer "):
        token = token[7:]

    # JWT has 3 parts: header.payload.signature
    parts = token.split(".")
    if len(parts) != 3:
        raise ValueError("Invalid JWT token format")

    # Decode the payload (second part)
    payload = parts[1]

    # Add padding if needed (base64 requires padding to be multiple of 4)
    padding = 4 - len(payload) % 4
    if padding != 4:
        payload += "=" * padding

    # Decode base64url to JSON
    decoded_bytes = base64.urlsafe_b64decode(payload)
    return json.loads(decoded_bytes.decode("utf-8"))


def fix_decimals(obj: Any) -> Any:
    """Recursively convert DynamoDB Decimal values to int or float."""
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: fix_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [fix_decimals(v) for v in obj]
    return obj


def get_user_id_from_token(authorization_header: str) -> str:
    """
    Extract user_id (sub claim) from JWT token in Authorization header.

    Args:
        authorization_header: The Authorization header value

    Returns:
        The user_id (sub claim) from the token
    """
    claims = decode_jwt_token(authorization_header)
    return claims.get("sub")
