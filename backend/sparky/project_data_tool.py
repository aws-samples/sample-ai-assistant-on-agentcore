"""
Project File tool for Sparky Agent.

Loads any project file (CSV, Excel, Parquet, PDF, text, code, etc.) from a
project's S3 bucket into the Code Interpreter session so the LLM can read or
analyse them with Python.

The project_id and user_id arguments are injected by SparkyMiddleware.
"""

import asyncio
import json
import os
import base64

import boto3
from botocore.exceptions import ClientError
from langchain.tools import tool
from langchain_core.runnables import RunnableConfig

from code_interpreter import code_interpreter_client, CodeInterpreterError
from utils import logger

REGION = os.environ.get("REGION", "us-east-1")
PROJECTS_S3_BUCKET = os.environ.get("PROJECTS_S3_BUCKET")
PROJECT_FILES_TABLE = os.environ.get("PROJECT_FILES_TABLE")

FILENAME_INDEX = "project_id-filename-index"

# Statuses that mark a project file as available
_AVAILABLE_STATUSES = {"ready", "indexed"}

_dynamodb = boto3.resource("dynamodb", region_name=REGION)
_files_table = _dynamodb.Table(PROJECT_FILES_TABLE) if PROJECT_FILES_TABLE else None
_s3 = boto3.client("s3", region_name=REGION)


def _get_user_id_from_config(config: RunnableConfig) -> str:
    if config:
        configurable = config.get("configurable", {})
        return configurable.get("user_id") or configurable.get("actor_id") or "unknown"
    return "unknown"


def _lookup_data_file(project_id: str, filename: str) -> dict | None:
    """Query the project_id-filename-index GSI to find a file record."""
    if not PROJECT_FILES_TABLE or not _files_table:
        return None
    try:
        response = _files_table.query(
            IndexName=FILENAME_INDEX,
            KeyConditionExpression="project_id = :pid AND filename = :fname",
            ExpressionAttributeValues={":pid": project_id, ":fname": filename},
            Limit=1,
        )
        items = response.get("Items", [])
        return items[0] if items else None
    except ClientError as e:
        logger.error(
            f"Error looking up data file {filename} in project {project_id}: {e}"
        )
        return None


@tool
async def load_project_file(
    filename: str,
    config: RunnableConfig,
    project_id: str = "",
    user_id: str = "",
) -> str:
    """Load any file from the project into the Code Interpreter.

    Use this to load any project file — CSV, Excel, Parquet, TSV, JSON, text,
    code, PDF, or any other type — into the code execution environment so you
    can read or analyse it with Python.

    After calling this tool the file is available at the returned path inside
    the Code Interpreter. Use execute_code to read and process it.

    Args:
        filename: Exact filename to load. Must match one of the files listed
            in the project context.
        config: Injected automatically — do not supply.
        project_id: Injected automatically — do not supply.
        user_id: Injected automatically — do not supply.
    """
    if not project_id:
        return json.dumps({"error": "No project is currently bound to this session."})
    if not filename or not filename.strip():
        return json.dumps({"error": "filename is required."})
    if not PROJECTS_S3_BUCKET:
        return json.dumps({"error": "Project storage is not configured."})

    # Resolve user_id from config if not injected (fallback)
    if not user_id:
        user_id = _get_user_id_from_config(config)

    # Look up the file record
    file_record = await asyncio.to_thread(_lookup_data_file, project_id, filename)
    if not file_record:
        return json.dumps({"error": f"File '{filename}' not found in this project."})

    # Ownership check
    if file_record.get("user_id") != user_id:
        return json.dumps({"error": f"File '{filename}' not found in this project."})

    if file_record.get("status") not in _AVAILABLE_STATUSES:
        return json.dumps(
            {"error": f"File '{filename}' is not ready yet. Please try again shortly."}
        )

    s3_key = file_record.get("s3_key")
    if not s3_key:
        return json.dumps({"error": f"Storage key for '{filename}' is missing."})

    # Download from S3 with size limit
    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100 MB
    try:
        # Check file size before downloading
        head = await asyncio.to_thread(
            _s3.head_object, Bucket=PROJECTS_S3_BUCKET, Key=s3_key
        )
        content_length = head.get("ContentLength", 0)
        if content_length > MAX_FILE_SIZE:
            return json.dumps(
                {
                    "error": f"File '{filename}' is too large ({content_length // (1024 * 1024)}MB). Maximum size is 100MB."
                }
            )
        obj = await asyncio.to_thread(
            _s3.get_object, Bucket=PROJECTS_S3_BUCKET, Key=s3_key
        )
        file_bytes = await asyncio.to_thread(obj["Body"].read)
    except ClientError as e:
        logger.error(f"Failed to download project data file {s3_key}: {e}")
        return json.dumps({"error": f"Failed to retrieve '{filename}' from storage."})

    # Get CI session (keyed by LangGraph thread_id = agentcore session id)
    session_id = config.get("configurable", {}).get("thread_id", "")
    if not session_id:
        return json.dumps({"error": "Code Interpreter session not available."})

    try:
        ci_session_id = await code_interpreter_client.get_or_create_session(
            session_id, user_id=user_id
        )
    except CodeInterpreterError as e:
        logger.error(f"Failed to get CI session: {e}")
        return json.dumps({"error": "Failed to start code execution session."})

    # Upload into CI using the proven base64 write pattern
    # Sanitize filename to prevent path traversal
    safe_filename = os.path.basename(filename)
    ci_path = f"/tmp/project/{safe_filename}"
    b64_data = base64.b64encode(file_bytes).decode("ascii")
    try:
        await code_interpreter_client.upload_data_files(
            ci_session_id,
            [{"path": ci_path, "data": b64_data}],
        )
    except CodeInterpreterError as e:
        logger.error(f"Failed to upload data file to CI: {e}")
        return json.dumps(
            {"error": f"Failed to load '{filename}' into code environment."}
        )

    size_kb = len(file_bytes) / 1024
    return json.dumps(
        {
            "status": "loaded",
            "filename": filename,
            "path": ci_path,
            "size_kb": round(size_kb, 1),
            "message": (
                f"'{filename}' is now available at {ci_path} in the Code Interpreter. "
                "Use execute_code to read and process it with Python."
            ),
        }
    )
