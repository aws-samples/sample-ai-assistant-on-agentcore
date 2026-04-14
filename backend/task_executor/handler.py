"""Scheduled task executor Lambda.

Processes SQS messages from EventBridge Scheduler, reads the task definition,
creates an execution record, and fires an async invocation to the Sparky
AgentCore runtime which handles the long-running execution and result recording.
"""

import base64
import json
import logging
import os
import time
import urllib.parse
import uuid
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import boto3

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

TASK_JOBS_TABLE = os.environ.get("TASK_JOBS_TABLE")
TASK_EXECUTIONS_TABLE = os.environ.get("TASK_EXECUTIONS_TABLE")
SPARKY_RUNTIME_ARN = os.environ.get("SPARKY_RUNTIME_ARN")
REGION = os.environ.get("REGION", os.environ.get("AWS_REGION", "us-east-1"))

COGNITO_TOKEN_URL = os.environ.get("COGNITO_TOKEN_URL")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID")
COGNITO_CLIENT_SECRET = os.environ.get("COGNITO_CLIENT_SECRET")
COGNITO_SCOPE = os.environ.get("COGNITO_SCOPE", "sparky-api/invoke")

_REQUIRED_ENV = {
    "TASK_JOBS_TABLE": TASK_JOBS_TABLE,
    "TASK_EXECUTIONS_TABLE": TASK_EXECUTIONS_TABLE,
    "SPARKY_RUNTIME_ARN": SPARKY_RUNTIME_ARN,
    "COGNITO_TOKEN_URL": COGNITO_TOKEN_URL,
    "COGNITO_CLIENT_ID": COGNITO_CLIENT_ID,
    "COGNITO_CLIENT_SECRET": COGNITO_CLIENT_SECRET,
}
_missing = [k for k, v in _REQUIRED_ENV.items() if not v]
if _missing:
    raise EnvironmentError(
        f"Missing required environment variables: {', '.join(_missing)}"
    )

dynamodb = boto3.resource("dynamodb", region_name=REGION)
jobs_table = dynamodb.Table(TASK_JOBS_TABLE)
executions_table = dynamodb.Table(TASK_EXECUTIONS_TABLE)

_cached_token = {"access_token": None, "expires_at": 0}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _get_access_token() -> str:
    """Get a JWT access token via Cognito client credentials flow, with caching."""
    if _cached_token["access_token"] and time.time() < _cached_token["expires_at"] - 60:
        return _cached_token["access_token"]

    creds = base64.b64encode(
        f"{COGNITO_CLIENT_ID}:{COGNITO_CLIENT_SECRET}".encode()
    ).decode()
    data = urllib.parse.urlencode(
        {
            "grant_type": "client_credentials",
            "scope": COGNITO_SCOPE,
        }
    ).encode()

    req = Request(
        COGNITO_TOKEN_URL,
        data=data,
        method="POST",
        headers={
            "Content-Type": "application/x-www-form-urlencoded",
            "Authorization": f"Basic {creds}",
        },
    )
    try:
        with urlopen(req, timeout=10) as resp:
            token_data = json.loads(resp.read())
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:500]
        logger.error("Failed to obtain access token: HTTP %s — %s", e.code, body)
        raise RuntimeError(f"Authentication failed: HTTP {e.code}") from e
    except URLError as e:
        logger.error("Failed to connect to Cognito: %s", e.reason)
        raise RuntimeError(f"Authentication failed: {e.reason}") from e

    _cached_token["access_token"] = token_data["access_token"]
    _cached_token["expires_at"] = time.time() + token_data.get("expires_in", 3600)
    return _cached_token["access_token"]


def _invoke_runtime_async(
    prompt: str,
    session_id: str,
    user_id: str,
    job_id: str,
    execution_id: str,
) -> None:
    """Fire-and-forget: tell Sparky to run the task asynchronously."""
    token = _get_access_token()
    encoded_arn = urllib.parse.quote(SPARKY_RUNTIME_ARN, safe="")
    url = f"https://bedrock-agentcore.{REGION}.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
    }

    # Single call — Sparky handles create_session internally for this type
    body = json.dumps(
        {
            "input": {
                "type": "run_scheduled_task",
                "prompt": prompt,
                "user_id": user_id,
                "job_id": job_id,
                "execution_id": execution_id,
            }
        }
    ).encode()

    req = Request(url, data=body, method="POST", headers=headers)
    try:
        with urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            logger.info("Runtime accepted task: %s", result)
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:1000]
        logger.error("Runtime invocation failed: HTTP %s — %s", e.code, body)
        raise RuntimeError(f"Failed to invoke runtime: HTTP {e.code} — {body[:200]}") from e
    except URLError as e:
        logger.error("Runtime invocation failed: %s", e.reason)
        raise RuntimeError(f"Failed to invoke runtime: {e.reason}") from e


def handler(event, context):
    """Process SQS batch of scheduled task messages."""
    failures = []

    for record in event.get("Records", []):
        message_id = record["messageId"]
        execution_id = str(uuid.uuid4())
        job_id = None

        try:
            body = json.loads(record["body"])
            job_id = body.get("job_id")
            user_id = body.get("user_id")
            if not job_id or not user_id:
                logger.error("Invalid task message — missing job_id or user_id: %s", body)
                continue
            logger.info("Executing scheduled task %s for user %s", job_id, user_id)

            # 1. Read job definition
            job = jobs_table.get_item(Key={"user_id": user_id, "job_id": job_id}).get(
                "Item"
            )
            if not job:
                logger.warning("Job %s not found, skipping", job_id)
                continue

            if job.get("status") != "enabled":
                logger.info("Job %s status=%s, skipping", job_id, job.get("status"))
                continue

            # 2. Create execution record (status=running) with 30-day TTL
            executions_table.put_item(
                Item={
                    "job_id": job_id,
                    "execution_id": execution_id,
                    "user_id": user_id,
                    "status": "running",
                    "started_at": _now_iso(),
                    "expires_at": int(time.time()) + 30 * 86400,
                }
            )

            # 3. Fire async invocation — Sparky handles the rest
            _invoke_runtime_async(
                prompt=job.get("prompt", ""),
                session_id=execution_id,
                user_id=user_id,
                job_id=job_id,
                execution_id=execution_id,
            )
            logger.info(
                "Scheduled task %s dispatched (execution %s)", job_id, execution_id
            )

        except Exception as e:
            logger.exception(
                "Failed to dispatch scheduled task %s", job_id or message_id
            )
            if job_id:
                try:
                    executions_table.update_item(
                        Key={"job_id": job_id, "execution_id": execution_id},
                        UpdateExpression="SET #s = :s, finished_at = :f, error_message = :e",
                        ExpressionAttributeNames={"#s": "status"},
                        ExpressionAttributeValues={
                            ":s": "failed",
                            ":f": _now_iso(),
                            ":e": str(e)[:2000],
                        },
                    )
                except Exception:
                    logger.exception("Failed to record task failure")
            failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": failures}
