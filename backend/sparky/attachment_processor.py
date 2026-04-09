"""
Attachment processor module for handling file attachments in chat messages.

This module provides validation and processing of file attachments,
converting them to LLM-compatible content blocks.
"""

import logging
from dataclasses import dataclass
from typing import List, Optional, Set

logger = logging.getLogger(__name__)

# Constants for file validation
MAX_FILE_SIZE_BYTES = 4718592  # 4.5MB in bytes
MAX_SPREADSHEET_SIZE_BYTES = 52428800  # 50MB in bytes

ALLOWED_IMAGE_TYPES: Set[str] = {"image/jpeg", "image/png", "image/gif", "image/webp"}

ALLOWED_DOCUMENT_TYPES: Set[str] = {
    "application/pdf",
    "application/json",
    "text/yaml",
    "application/x-yaml",
    "text/plain",
    "text/csv",
    "text/html",
    "text/markdown",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}

ALLOWED_TYPES: Set[str] = ALLOWED_IMAGE_TYPES | ALLOWED_DOCUMENT_TYPES

SPREADSHEET_TYPES: Set[str] = {
    "text/csv",
    "text/yaml",
    "application/x-yaml",
    "application/json",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


@dataclass
class Attachment:
    """Represents a file attachment with its metadata and content."""

    name: str
    type: str  # MIME type
    size: int
    data: str  # Base64 encoded content


@dataclass
class AttachmentValidationResult:
    """Result of validating an attachment."""

    valid: bool
    error: Optional[str] = None
    attachment: Optional[Attachment] = None
    filename: Optional[str] = None
    reason: Optional[str] = None


def validate_file_type(mime_type: str) -> bool:
    """
    Validate that a file's MIME type is in the allowed list.

    Args:
        mime_type: The MIME type string to validate

    Returns:
        True if the MIME type is allowed, False otherwise
    """
    return mime_type in ALLOWED_TYPES


def is_spreadsheet_type(mime_type: str) -> bool:
    """Check if a MIME type is a spreadsheet type."""
    return mime_type in SPREADSHEET_TYPES


def is_large_document(attachment: Attachment) -> bool:
    """
    Check if a non-image, non-spreadsheet document exceeds the 4.5MB threshold.

    Returns True when the attachment is a document type (not image, not spreadsheet)
    and its size exceeds MAX_FILE_SIZE_BYTES.
    """
    if attachment.type in ALLOWED_IMAGE_TYPES:
        return False
    if is_spreadsheet_type(attachment.type):
        return False
    return attachment.size > MAX_FILE_SIZE_BYTES


def get_max_file_size(mime_type: str) -> int:
    """Return the max file size in bytes for the given MIME type."""
    return (
        MAX_SPREADSHEET_SIZE_BYTES
        if is_spreadsheet_type(mime_type)
        else MAX_FILE_SIZE_BYTES
    )


def validate_file_size(size: int, mime_type: str = "") -> bool:
    """
    Validate that a file's size does not exceed the maximum limit.

    Uses tiered limits: 50MB for spreadsheet types, 4.5MB otherwise.

    Args:
        size: The file size in bytes
        mime_type: The MIME type string (used for tiered size limits)

    Returns:
        True if the size is within limits, False otherwise
    """
    return size <= get_max_file_size(mime_type)


def validate_attachment(attachment_dict: dict) -> AttachmentValidationResult:
    """
    Validate a single attachment dictionary.

    Validates that:
    - All required fields are present (name, type, size, data)
    - Field types are correct
    - File type is allowed
    - File size is within limits

    Args:
        attachment_dict: Dictionary containing attachment data

    Returns:
        AttachmentValidationResult with validation status and details
    """
    # Check required fields exist
    required_fields = ["name", "type", "size", "data"]
    for field in required_fields:
        if field not in attachment_dict:
            return AttachmentValidationResult(
                valid=False,
                error=f"Missing required field: {field}",
                filename=attachment_dict.get("name"),
                reason="malformed_data",
            )

    name = attachment_dict["name"]
    mime_type = attachment_dict["type"]
    size = attachment_dict["size"]
    data = attachment_dict["data"]

    # Validate field types
    if not isinstance(name, str):
        return AttachmentValidationResult(
            valid=False,
            error="Invalid field type: name must be a string",
            filename=str(name) if name else None,
            reason="malformed_data",
        )

    if not isinstance(mime_type, str):
        return AttachmentValidationResult(
            valid=False,
            error="Invalid field type: type must be a string",
            filename=name,
            reason="malformed_data",
        )

    if not isinstance(size, int) or size < 0:
        return AttachmentValidationResult(
            valid=False,
            error="Invalid field type: size must be a non-negative integer",
            filename=name,
            reason="malformed_data",
        )

    if not isinstance(data, str):
        return AttachmentValidationResult(
            valid=False,
            error="Invalid field type: data must be a string",
            filename=name,
            reason="malformed_data",
        )

    # Validate file type
    if not validate_file_type(mime_type):
        allowed_types_str = ", ".join(sorted(ALLOWED_TYPES))
        return AttachmentValidationResult(
            valid=False,
            error=f"Unsupported file type '{mime_type}' for file '{name}'. Allowed types: {allowed_types_str}",
            filename=name,
            reason="unsupported_type",
        )

    # Validate file size
    if not validate_file_size(size, mime_type):
        max_size_mb = get_max_file_size(mime_type) / (1024 * 1024)
        return AttachmentValidationResult(
            valid=False,
            error=f"File '{name}' exceeds maximum size of {max_size_mb:.1f}MB",
            filename=name,
            reason="file_too_large",
        )

    # Create valid attachment
    attachment = Attachment(name=name, type=mime_type, size=size, data=data)

    return AttachmentValidationResult(valid=True, attachment=attachment, filename=name)


def validate_all_attachments(attachments: List[dict]) -> AttachmentValidationResult:
    """
    Validate a list of attachment dictionaries.

    Args:
        attachments: List of attachment dictionaries to validate

    Returns:
        AttachmentValidationResult with overall validation status.
        If any attachment fails validation, returns the first error.
    """
    if not isinstance(attachments, list):
        return AttachmentValidationResult(
            valid=False, error="Attachments must be a list", reason="malformed_data"
        )

    for attachment_dict in attachments:
        if not isinstance(attachment_dict, dict):
            return AttachmentValidationResult(
                valid=False,
                error="Each attachment must be an object",
                reason="malformed_data",
            )

        result = validate_attachment(attachment_dict)
        if not result.valid:
            return result

    return AttachmentValidationResult(valid=True)


def build_image_content_block(attachment: Attachment) -> dict:
    """
    Build an LLM-compatible image content block from an attachment.

    Args:
        attachment: An Attachment object containing image data

    Returns:
        A dict with type "image" and source containing base64 data and media_type
    """
    return {
        "type": "image",
        "source": {
            "type": "base64",
            "media_type": attachment.type,
            "data": attachment.data,
        },
    }


def build_document_content_block(
    attachment: Attachment, enable_citations: bool = True
) -> dict:
    """
    Build an LLM-compatible document content block from an attachment.

    All document types use the Bedrock native document format with "type": "document".
    Citations are only enabled for PDF documents.

    Args:
        attachment: An Attachment object containing document data
        enable_citations: Whether to enable citations for PDF documents (default True)

    Returns:
        A dict with the document content block in the appropriate format
    """
    import base64
    import re
    from utils import logger

    # Map MIME types to document format strings
    format_map = {
        "application/pdf": "pdf",
        "text/plain": "txt",
        "text/csv": "csv",
        "text/html": "html",
        "text/markdown": "md",
        "application/msword": "doc",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/vnd.ms-excel": "xls",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        "application/vnd.ms-powerpoint": "ppt",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    }

    doc_format = format_map.get(attachment.type, "txt")

    try:
        # Decode base64 to get raw bytes
        doc_bytes = base64.b64decode(attachment.data)
        logger.debug(f"FILE NAME: {attachment.name}")

        # Clean the document name - only allow alphanumeric, underscores, hyphens
        # Remove extension and special characters
        clean_name = re.sub(r"[^a-zA-Z0-9_-]", "_", attachment.name.rsplit(".", 1)[0])
        # Remove consecutive underscores and trim
        clean_name = re.sub(r"_+", "_", clean_name).strip("_")
        # Ensure name is not empty
        if not clean_name:
            clean_name = "document"

        # Build document block with "type": "document" at top level
        document_block = {
            "type": "document",
            "document": {
                "format": doc_format,
                "name": clean_name,
                "source": {"bytes": doc_bytes},
            },
        }

        # Only enable citations for PDF documents
        if attachment.type == "application/pdf" and enable_citations:
            document_block["document"]["citations"] = {"enabled": True}

        return document_block

    except Exception as e:
        logger.error(f"Error processing document attachment '{attachment.name}': {e}")
        return {
            "type": "text",
            "text": f"[Error processing document: {attachment.name}]",
        }


def build_spreadsheet_content_block(attachment: Attachment) -> dict:
    """Build a text content block that tells the agent where the file is in CI."""
    return {
        "type": "text",
        "text": f"<document>\nFile: {attachment.name}\nPath: /tmp/data/{attachment.name}\nType: {attachment.type}\nThis file has been uploaded to the Code Interpreter environment. Use execute_code with pandas to read and process it.\n</document>",
    }


def build_ci_notification_block(attachment: Attachment) -> dict:
    """
    Build a text content block notifying the LLM that a file is available in CI.

    This is a general-purpose replacement for build_spreadsheet_content_block,
    used for any file routed to the Code Interpreter environment.

    Args:
        attachment: An Attachment object with file metadata

    Returns:
        A dict with type "text" containing the file name, CI path, and MIME type
    """
    return {
        "type": "text",
        "text": (
            f"<document>\n"
            f"File: {attachment.name}\n"
            f"Path: /tmp/data/{attachment.name}\n"
            f"Type: {attachment.type}\n"
            f"This file has been uploaded to the Code Interpreter environment. "
            f"Use execute_code with pandas to read and process it.\n"
            f"</document>"
        ),
    }


def build_content_blocks(
    text: str, attachments: List[Attachment]
) -> tuple[List[dict], List[Attachment]]:
    """
    Build a list of LLM-compatible content blocks from text and attachments.

    Order: attachment blocks first, then text block last.
    This order is required for proper Bedrock document processing.

    Routing rules:
    - Spreadsheets: CI notification block only, added to ci_bound list
    - Images: image content block + CI notification block, added to ci_bound list
    - Documents ≤ threshold: document content block (existing behavior)
    - Documents > threshold: CI notification block only, added to ci_bound list

    Args:
        text: The text message content
        attachments: List of Attachment objects to include

    Returns:
        A tuple of (llm_content_blocks, ci_bound_attachments)
    """
    content_blocks = []
    ci_bound_attachments: List[Attachment] = []

    for attachment in attachments:
        if attachment.type in ALLOWED_IMAGE_TYPES:
            content_blocks.append(build_image_content_block(attachment))
            content_blocks.append(build_ci_notification_block(attachment))
            ci_bound_attachments.append(attachment)
        elif is_spreadsheet_type(attachment.type):
            content_blocks.append(build_ci_notification_block(attachment))
            ci_bound_attachments.append(attachment)
        elif attachment.type in ALLOWED_DOCUMENT_TYPES:
            if is_large_document(attachment):
                content_blocks.append(build_ci_notification_block(attachment))
                ci_bound_attachments.append(attachment)
            else:
                content_blocks.append(build_document_content_block(attachment))

    if text:
        content_blocks.append({"type": "text", "text": text})

    return content_blocks, ci_bound_attachments
