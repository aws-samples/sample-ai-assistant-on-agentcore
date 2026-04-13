"""Scheduled task executor Lambda.

Processes SQS messages from EventBridge Scheduler, invokes the Sparky
AgentCore runtime with the scheduled prompt, and records execution results.
"""

import json
import logging
import os
import time
import urllib.parse
import uuid
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import boto3

logger = logging.getLogger()
logger.setLevel(os.environ.get("LOG_LEVEL", "INFO"))

TASK_JOBS_TABLE = os.environ.get("TASK_JOBS_TABLE")
TASK_EXECUTIONS_TABLE = os.environ.get("TASK_EXECUTIONS_TABLE")
SPARKY_RUNTIME_ARN = os.environ.get("SPARKY_RUNTIME_ARN")
S3_BUCKET = os.environ.get("S3_BUCKET")
REGION = os.environ.get("REGION", os.environ.get("AWS_REGION", "us-east-1"))

COGNITO_TOKEN_URL = os.environ.get("COGNITO_TOKEN_URL")
COGNITO_CLIENT_ID = os.environ.get("COGNITO_CLIENT_ID")
COGNITO_CLIENT_SECRET = os.environ.get("COGNITO_CLIENT_SECRET")
COGNITO_SCOPE = os.environ.get("COGNITO_SCOPE", "sparky-api/invoke")

# Validate required env vars at import time so failures are loud and immediate
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
    raise EnvironmentError(f"Missing required environment variables: {', '.join(_missing)}")

# 400KB limit for DynamoDB item (leaving room for other attributes)
MAX_DYNAMO_OUTPUT_BYTES = 400_000

dynamodb = boto3.resource("dynamodb", region_name=REGION)
s3_client = boto3.client("s3", region_name=REGION)
jobs_table = dynamodb.Table(TASK_JOBS_TABLE)
executions_table = dynamodb.Table(TASK_EXECUTIONS_TABLE)


def _now_iso() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


def _get_job(user_id: str, job_id: str) -> dict | None:
    """Read job definition from DynamoDB."""
    resp = jobs_table.get_item(Key={"user_id": user_id, "job_id": job_id})
    return resp.get("Item")


def _create_execution(job_id: str, user_id: str, execution_id: str) -> None:
    """Create an execution record with status=running."""
    executions_table.put_item(Item={
        "job_id": job_id,
        "execution_id": execution_id,
        "user_id": user_id,
        "status": "running",
        "started_at": _now_iso(),
    })


def _complete_execution(
    job_id: str, execution_id: str, status: str, output: str, error: str | None = None
) -> None:
    """Update execution record with result. Offload to S3 if output is large."""
    output_field = "output"
    output_value = output

    if output and len(output.encode("utf-8")) > MAX_DYNAMO_OUTPUT_BYTES:
        s3_key = f"task-outputs/{job_id}/{execution_id}.txt"
        s3_client.put_object(Bucket=S3_BUCKET, Key=s3_key, Body=output.encode("utf-8"))
        output_field = "output_s3_key"
        output_value = s3_key
        logger.info("Output offloaded to S3: %s", s3_key)

    update_expr = "SET #s = :s, finished_at = :f"
    attr_names = {"#s": "status"}
    attr_values = {":s": status, ":f": _now_iso()}

    if output_value:
        if output_field == "output":
            update_expr += ", #o = :o"
            attr_names["#o"] = "output"
        else:
            update_expr += ", output_s3_key = :o"
        attr_values[":o"] = output_value
    if error:
        update_expr += ", error_message = :e"
        attr_values[":e"] = error[:2000]

    executions_table.update_item(
        Key={"job_id": job_id, "execution_id": execution_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=attr_names,
        ExpressionAttributeValues=attr_values,
    )


_cached_token = {"access_token": None, "expires_at": 0}


def _get_access_token() -> str:
    """Get a JWT access token via Cognito client credentials flow, with caching."""
    if _cached_token["access_token"] and time.time() < _cached_token["expires_at"] - 60:
        return _cached_token["access_token"]

    import base64
    creds = base64.b64encode(f"{COGNITO_CLIENT_ID}:{COGNITO_CLIENT_SECRET}".encode()).decode()
    data = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "scope": COGNITO_SCOPE,
    }).encode()

    req = Request(COGNITO_TOKEN_URL, data=data, method="POST", headers={
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": f"Basic {creds}",
    })
    try:
        with urlopen(req, timeout=10) as resp:
            token_data = json.loads(resp.read())
    except (HTTPError, URLError) as e:
        logger.error("Failed to obtain access token from Cognito")
        raise RuntimeError("Authentication failed") from e

    _cached_token["access_token"] = token_data["access_token"]
    _cached_token["expires_at"] = time.time() + token_data.get("expires_in", 3600)
    return _cached_token["access_token"]


def _invoke_runtime(prompt: str, session_id: str, user_id: str) -> str:
    """Invoke Sparky AgentCore runtime with a JWT bearer token."""
    token = _get_access_token()
    encoded_arn = urllib.parse.quote(SPARKY_RUNTIME_ARN, safe='')
    base_url = f"https://bedrock-agentcore.{REGION}.amazonaws.com/runtimes/{encoded_arn}/invocations?qualifier=DEFAULT"
    headers_base = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
        "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": session_id,
    }

    # 1. Create session so ownership validation passes
    try:
        create_body = json.dumps({"input": {"type": "create_session", "user_id": user_id}}).encode()
        req = Request(base_url, data=create_body, method="POST", headers=headers_base)
        with urlopen(req, timeout=30) as resp:
            resp.read()
    except (HTTPError, URLError) as e:
        raise RuntimeError(f"Failed to create runtime session: {e}") from e

    # 2. Send the actual prompt
    try:
        prompt_body = json.dumps({"input": {"prompt": prompt, "user_id": user_id}}).encode()
        req = Request(base_url, data=prompt_body, method="POST", headers=headers_base)

        text_parts = []
        with urlopen(req, timeout=890) as resp:
            for raw_line in resp:
                line = raw_line.decode("utf-8", errors="replace").strip()
                if not line.startswith("data: "):
                    continue
                try:
                    chunk = json.loads(line[6:])
                except json.JSONDecodeError:
                    continue

                if chunk.get("end"):
                    break
                if chunk.get("type") == "error":
                    raise RuntimeError(chunk.get("content", "Runtime error"))

                content = chunk.get("content")
                if content and isinstance(content, str):
                    text_parts.append(content)

        return "".join(text_parts)
    except (HTTPError, URLError) as e:
        raise RuntimeError(f"Failed to invoke runtime: {e}") from e


def handler(event, context):
    """Process SQS batch of task execution messages."""
    failures = []

    for record in event.get("Records", []):
        message_id = record["messageId"]
        execution_id = str(uuid.uuid4())
        job_id = None

        try:
            body = json.loads(record["body"])
            job_id = body["job_id"]
            user_id = body["user_id"]
            logger.info("Executing scheduled task %s for user %s", job_id, user_id)

            # 1. Read job definition
            job = _get_job(user_id, job_id)
            if not job:
                logger.warning("Job %s not found, skipping", job_id)
                continue

            # 2. Skip if not enabled
            if job.get("status") != "enabled":
                logger.info("Job %s status=%s, skipping", job_id, job.get("status"))
                continue

            # 3. Create execution record
            _create_execution(job_id, user_id, execution_id)

            # 4. Invoke runtime
            prompt = job.get("prompt", "")
            session_id = execution_id
            output = _invoke_runtime(prompt, session_id, user_id)

            # 5. Record success
            _complete_execution(job_id, execution_id, "completed", output)
            logger.info("Scheduled task %s execution %s completed", job_id, execution_id)

        except Exception as e:
            logger.exception("Failed to execute scheduled task %s", job_id or message_id)
            # Record failure if we created an execution record
            if job_id:
                try:
                    _complete_execution(job_id, execution_id, "failed", "", str(e))
                except Exception:
                    logger.exception("Failed to record execution failure")
            failures.append({"itemIdentifier": message_id})

    return {"batchItemFailures": failures}
