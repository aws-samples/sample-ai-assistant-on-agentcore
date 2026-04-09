"""Code Interpreter client for Bedrock AgentCore Code Interpreter API.

Wraps the Bedrock AgentCore Code Interpreter boto3 API to manage sessions
and execute Python code. Sessions are cached per AgentCore session ID so
that files and state persist across multiple tool invocations within a
conversation.

"""

import asyncio
import json
import os
import boto3
from dataclasses import dataclass
from typing import Optional
from utils import logger

# Code Interpreter resource identifier (from Terraform-provisioned resource or managed default)
CODE_INTERPRETER_ID = os.environ.get("CODE_INTERPRETER_ID", "aws.codeinterpreter.v1")


@dataclass
class CodeExecutionResult:
    """Result from Code Interpreter execution."""

    status: str  # "success" | "error"
    stdout: str
    stderr: str
    error_message: Optional[str] = None


class CodeInterpreterError(Exception):
    """Raised when a Code Interpreter operation fails."""

    pass


class CodeInterpreterClient:
    """Client for Bedrock AgentCore Code Interpreter API.

    Manages Code Interpreter sessions and code execution. Sessions are
    cached in memory keyed by AgentCore session ID so that repeated
    calls within the same conversation reuse the same sandbox.
    """

    def __init__(self, region: str, s3_bucket: str, skills_s3_bucket: str = ""):
        self.region = region
        self.s3_bucket = s3_bucket
        self.skills_s3_bucket = skills_s3_bucket or s3_bucket
        self._sessions: dict[str, str] = {}  # agentcore_session_id -> ci_session_id
        self._client = boto3.client("bedrock-agentcore", region_name=region)

    async def get_or_create_session(
        self, agentcore_session_id: str, user_id: str | None = None
    ) -> str:
        """Get existing CI session or create a new one.

        Returns the Code Interpreter session ID. Caches the mapping so
        subsequent calls with the same agentcore_session_id return the
        same CI session without hitting the API again.

        If user_id is provided and this is a new session, downloads all
        PPT templates from S3 into /tmp/ppt_templates/ so generated code
        can reference them directly.

        """
        if agentcore_session_id in self._sessions:
            return self._sessions[agentcore_session_id]

        try:
            response = await asyncio.to_thread(
                lambda: self._client.start_code_interpreter_session(
                    codeInterpreterIdentifier=CODE_INTERPRETER_ID,
                    name=f"sparky-{agentcore_session_id}",
                    sessionTimeoutSeconds=7200,
                )
            )
            ci_session_id = response["sessionId"]
            self._sessions[agentcore_session_id] = ci_session_id
            logger.debug(
                f"Created Code Interpreter session {ci_session_id} "
                f"for AgentCore session {agentcore_session_id}"
            )
        except Exception as e:
            logger.error(f"Failed to create Code Interpreter session: {e}")
            raise CodeInterpreterError(
                f"Failed to create Code Interpreter session: {e}"
            ) from e

        return ci_session_id

    async def execute_code(
        self, agentcore_session_id: str, code: str, user_id: str | None = None
    ) -> CodeExecutionResult:
        """Execute Python code in the Code Interpreter session.

        Creates a session if one doesn't exist yet for this AgentCore
        session, then invokes the code interpreter with the given code.

        Args:
            agentcore_session_id: The AgentCore session ID
            code: Python code to execute
            user_id: Optional user ID for template provisioning on first session creation

        """
        ci_session_id = await self.get_or_create_session(
            agentcore_session_id, user_id=user_id
        )

        try:
            response = await asyncio.to_thread(
                lambda: self._client.invoke_code_interpreter(
                    codeInterpreterIdentifier=CODE_INTERPRETER_ID,
                    sessionId=ci_session_id,
                    name="executeCode",
                    arguments={"language": "python", "code": code},
                )
            )

            stdout_parts: list[str] = []
            stderr_parts: list[str] = []

            for event in response.get("stream", []):
                if "result" not in event:
                    continue
                result = event["result"]
                for content_item in result.get("content", []):
                    if content_item.get("type") == "text":
                        stdout_parts.append(content_item.get("text", ""))
                    elif content_item.get("type") == "error":
                        stderr_parts.append(content_item.get("text", ""))

            stdout = "\n".join(stdout_parts)
            stderr = "\n".join(stderr_parts)

            if stderr:
                return CodeExecutionResult(
                    status="error",
                    stdout=stdout,
                    stderr=stderr,
                    error_message=stderr,
                )

            return CodeExecutionResult(status="success", stdout=stdout, stderr="")

        except Exception as e:
            logger.error(f"Code execution failed: {e}")
            return CodeExecutionResult(
                status="error",
                stdout="",
                stderr=str(e),
                error_message=f"Code execution failed: {e}",
            )

    async def upload_data_files(self, ci_session_id: str, files: list[dict]) -> None:
        """Write data files into the CI session using executeCode.

        Uses Python code execution to write files, which is the proven
        pattern (same as _download_templates). All file content is passed
        as base64 and written as raw bytes to preserve binary formats
        (XLS/XLSX).

        Args:
            ci_session_id: The Code Interpreter session ID
            files: List of dicts with 'path' and 'data' (base64-encoded raw bytes)

        """
        try:
            # Build Python code that decodes base64 and writes raw bytes
            code_lines = ["import os, base64, json"]
            for f in files:
                path = f["path"]
                b64_data = f["data"]
                # Use json.dumps to safely escape path values and prevent code injection
                code_lines.append(
                    f"os.makedirs(os.path.dirname({json.dumps(path)}), exist_ok=True)"
                )
                code_lines.append(
                    f"with open({json.dumps(path)}, 'wb') as _f:\n"
                    f"    _f.write(base64.b64decode({json.dumps(b64_data)}))"
                )
            code_lines.append(f"print('WROTE_{len(files)}_FILES')")
            write_code = "\n".join(code_lines)

            response = await asyncio.to_thread(
                lambda: self._client.invoke_code_interpreter(
                    codeInterpreterIdentifier=CODE_INTERPRETER_ID,
                    sessionId=ci_session_id,
                    name="executeCode",
                    arguments={"language": "python", "code": write_code},
                )
            )

            stdout_parts: list[str] = []
            stderr_parts: list[str] = []
            for event in response.get("stream", []):
                if "result" not in event:
                    continue
                result = event["result"]
                for content_item in result.get("content", []):
                    if content_item.get("type") == "text":
                        stdout_parts.append(content_item.get("text", ""))
                    elif content_item.get("type") == "error":
                        stderr_parts.append(content_item.get("text", ""))

            stdout = "\n".join(stdout_parts)
            stderr = "\n".join(stderr_parts)

            if stderr:
                raise CodeInterpreterError(f"Failed to write data files: {stderr}")

            if f"WROTE_{len(files)}_FILES" not in stdout:
                logger.warning(f"Data file write may have failed: stdout={stdout}")

            logger.debug(
                f"Uploaded {len(files)} data files to CI session {ci_session_id}"
            )
        except CodeInterpreterError:
            raise
        except Exception as e:
            logger.error(f"Failed to upload data files: {e}")
            raise CodeInterpreterError(f"Failed to upload data files: {e}") from e

    async def close_session(self, agentcore_session_id: str) -> None:
        """Close a Code Interpreter session and remove it from the cache."""
        ci_session_id = self._sessions.pop(agentcore_session_id, None)
        if ci_session_id is None:
            return

        try:
            await asyncio.to_thread(
                lambda: self._client.stop_code_interpreter_session(
                    codeInterpreterIdentifier=CODE_INTERPRETER_ID,
                    sessionId=ci_session_id,
                )
            )
            logger.debug(f"Closed Code Interpreter session {ci_session_id}")
        except Exception as e:
            logger.warning(f"Failed to close Code Interpreter session: {e}")


# Module-level singleton initialized from environment config
REGION = os.environ.get("REGION", "us-east-1")
S3_BUCKET = os.environ.get("S3_BUCKET", "")
SKILLS_S3_BUCKET = os.environ.get("SKILLS_S3_BUCKET", "")

code_interpreter_client = CodeInterpreterClient(
    region=REGION, s3_bucket=S3_BUCKET, skills_s3_bucket=SKILLS_S3_BUCKET
)
