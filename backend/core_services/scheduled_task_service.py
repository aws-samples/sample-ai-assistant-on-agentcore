"""Scheduled Task Service for Core-Services.

DynamoDB CRUD for scheduled_tasks and scheduled_task_executions tables,
plus EventBridge Scheduler management for schedule lifecycle.
Also sends SQS messages for manual task triggers.
"""

import asyncio
import json
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional
from zoneinfo import available_timezones

import boto3
from botocore.exceptions import ClientError

from config import REGION
from task_models import ExecutionStatus, JobStatus
from utils import logger

TASK_JOBS_TABLE = os.environ.get("TASK_JOBS_TABLE")
TASK_EXECUTIONS_TABLE = os.environ.get("TASK_EXECUTIONS_TABLE")
TASK_QUEUE_URL = os.environ.get("TASK_QUEUE_URL")
TASK_SCHEDULER_ROLE_ARN = os.environ.get("TASK_SCHEDULER_ROLE_ARN")
ENV_PREFIX = os.environ.get("ENV_PREFIX", "sparky")

_REQUIRED_ENV = {
    "TASK_JOBS_TABLE": TASK_JOBS_TABLE,
    "TASK_EXECUTIONS_TABLE": TASK_EXECUTIONS_TABLE,
    "TASK_QUEUE_URL": TASK_QUEUE_URL,
    "TASK_SCHEDULER_ROLE_ARN": TASK_SCHEDULER_ROLE_ARN,
}
_missing = [k for k, v in _REQUIRED_ENV.items() if not v]
if _missing:
    logger.error("Missing required environment variables: %s", ", ".join(_missing))

SCHEDULE_GROUP = f"{ENV_PREFIX}-scheduled-tasks"

# --- Validation constants ---
_CRON_RE = re.compile(r"^cron\(.+\)$")
_RATE_RE = re.compile(r"^rate\(\d+\s+(minute|minutes|hour|hours|day|days)\)$")
_VALID_TIMEZONES = available_timezones()
MAX_PROMPT_SIZE = 50_000
MAX_DYNAMO_BYTES = 400_000


def _validate_schedule_expression(expr: str) -> None:
    if not (_CRON_RE.match(expr) or _RATE_RE.match(expr)):
        raise ValueError(f"Invalid schedule expression: {expr}")


def _validate_timezone(tz: str) -> None:
    if tz not in _VALID_TIMEZONES:
        raise ValueError(f"Invalid timezone: {tz}")


def _validate_prompt(prompt: str) -> None:
    if len(prompt) > MAX_PROMPT_SIZE:
        raise ValueError(f"Prompt exceeds maximum size of {MAX_PROMPT_SIZE} characters")


def _fix_decimals(obj: Any) -> Any:
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    if isinstance(obj, dict):
        return {k: _fix_decimals(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_fix_decimals(v) for v in obj]
    return obj


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class ScheduledTaskService:
    def __init__(self):
        self.dynamodb = boto3.resource("dynamodb", region_name=REGION)
        self.jobs_table = (
            self.dynamodb.Table(TASK_JOBS_TABLE) if TASK_JOBS_TABLE else None
        )
        self.executions_table = (
            self.dynamodb.Table(TASK_EXECUTIONS_TABLE)
            if TASK_EXECUTIONS_TABLE
            else None
        )
        self.scheduler = boto3.client("scheduler", region_name=REGION)
        self.sqs = boto3.client("sqs", region_name=REGION)
        self._queue_arn: Optional[str] = None
        if not _missing:
            self._ensure_schedule_group()

    async def _run_sync(self, fn):
        """Run a synchronous function in the default executor."""
        return await asyncio.get_running_loop().run_in_executor(None, fn)

    def _ensure_schedule_group(self):
        """Create the schedule group if it doesn't exist."""
        try:
            self.scheduler.get_schedule_group(Name=SCHEDULE_GROUP)
        except self.scheduler.exceptions.ResourceNotFoundException:
            try:
                self.scheduler.create_schedule_group(Name=SCHEDULE_GROUP)
            except self.scheduler.exceptions.ConflictException:
                pass  # Already exists — race condition with another instance

    def _schedule_name(self, job_id: str) -> str:
        return f"{ENV_PREFIX}-task-{job_id}"

    async def _get_queue_arn(self) -> str:
        """Get the SQS queue ARN, caching after first lookup."""
        if not self._queue_arn:
            resp = await self._run_sync(
                lambda: self.sqs.get_queue_attributes(
                    QueueUrl=TASK_QUEUE_URL, AttributeNames=["QueueArn"]
                )
            )
            self._queue_arn = resp["Attributes"]["QueueArn"]
        return self._queue_arn

    # =========================================================================
    # Jobs CRUD
    # =========================================================================

    async def create_job(
        self,
        user_id: str,
        name: str,
        prompt: str,
        schedule_expression: str,
        timezone_str: str = "UTC",
        skills: Optional[List[str]] = None,
    ) -> Dict[str, Any]:
        _validate_schedule_expression(schedule_expression)
        _validate_timezone(timezone_str)
        _validate_prompt(prompt)

        job_id = str(uuid.uuid4())
        now = _now_iso()
        item = {
            "user_id": user_id,
            "job_id": job_id,
            "name": name.strip()[:200],
            "prompt": prompt,
            "schedule_expression": schedule_expression,
            "timezone": timezone_str,
            "skills": skills or [],
            "status": JobStatus.ENABLED,
            "created_at": now,
            "updated_at": now,
        }

        await self._run_sync(lambda: self.jobs_table.put_item(Item=item))

        try:
            await self._upsert_schedule(
                job_id, user_id, schedule_expression, timezone_str
            )
        except Exception:
            # Compensate: remove orphaned DynamoDB item
            await self._run_sync(
                lambda: self.jobs_table.delete_item(
                    Key={"user_id": user_id, "job_id": job_id}
                )
            )
            raise

        return _fix_decimals(item)

    async def list_jobs(
        self, user_id: str, limit: int = 50, cursor: Optional[Dict] = None
    ) -> Dict[str, Any]:
        kwargs = {
            "KeyConditionExpression": "user_id = :uid",
            "ExpressionAttributeValues": {":uid": user_id},
            "ScanIndexForward": False,
            "Limit": limit,
        }
        if cursor:
            kwargs["ExclusiveStartKey"] = cursor

        resp = await self._run_sync(lambda: self.jobs_table.query(**kwargs))

        items = [_fix_decimals(i) for i in resp.get("Items", [])]
        result: Dict[str, Any] = {"jobs": items}
        if "LastEvaluatedKey" in resp:
            result["cursor"] = _fix_decimals(resp["LastEvaluatedKey"])
        return result

    async def get_job(self, user_id: str, job_id: str) -> Optional[Dict[str, Any]]:
        resp = await self._run_sync(
            lambda: self.jobs_table.get_item(
                Key={"user_id": user_id, "job_id": job_id}
            )
        )
        item = resp.get("Item")
        return _fix_decimals(item) if item else None

    async def update_job(
        self,
        user_id: str,
        job_id: str,
        name: Optional[str] = None,
        prompt: Optional[str] = None,
        schedule_expression: Optional[str] = None,
        timezone_str: Optional[str] = None,
        skills: Optional[List[str]] = None,
    ) -> Optional[Dict[str, Any]]:
        job = await self.get_job(user_id, job_id)
        if not job:
            return None

        if schedule_expression is not None:
            _validate_schedule_expression(schedule_expression)
        if timezone_str is not None:
            _validate_timezone(timezone_str)
        if prompt is not None:
            _validate_prompt(prompt)

        updates = []
        attr_names: Dict[str, str] = {}
        attr_values: Dict[str, Any] = {":now": _now_iso()}
        updates.append("updated_at = :now")

        if name is not None:
            updates.append("#n = :name")
            attr_names["#n"] = "name"
            attr_values[":name"] = name.strip()[:200]
        if prompt is not None:
            updates.append("prompt = :prompt")
            attr_values[":prompt"] = prompt
        if schedule_expression is not None:
            updates.append("schedule_expression = :sched")
            attr_values[":sched"] = schedule_expression
        if timezone_str is not None:
            updates.append("#tz = :tz")
            attr_names["#tz"] = "timezone"
            attr_values[":tz"] = timezone_str
        if skills is not None:
            updates.append("skills = :skills")
            attr_values[":skills"] = skills

        kwargs: Dict[str, Any] = {
            "Key": {"user_id": user_id, "job_id": job_id},
            "UpdateExpression": "SET " + ", ".join(updates),
            "ExpressionAttributeValues": attr_values,
            "ReturnValues": "ALL_NEW",
        }
        if attr_names:
            kwargs["ExpressionAttributeNames"] = attr_names

        resp = await self._run_sync(lambda: self.jobs_table.update_item(**kwargs))
        updated = _fix_decimals(resp.get("Attributes", {}))

        # Update schedule if expression or timezone changed and job is enabled
        if schedule_expression is not None or timezone_str is not None:
            eff_sched = schedule_expression or job.get("schedule_expression", "")
            eff_tz = timezone_str or job.get("timezone", "UTC")
            if job.get("status") == JobStatus.ENABLED:
                await self._upsert_schedule(job_id, user_id, eff_sched, eff_tz)

        return updated

    async def delete_job(self, user_id: str, job_id: str) -> bool:
        job = await self.get_job(user_id, job_id)
        if not job:
            return False

        await self._run_sync(
            lambda: self.jobs_table.update_item(
                Key={"user_id": user_id, "job_id": job_id},
                UpdateExpression="SET #s = :s, updated_at = :now",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={
                    ":s": JobStatus.DELETED,
                    ":now": _now_iso(),
                },
            )
        )
        await self._delete_schedule(job_id)
        await self._cleanup_executions(job_id)
        return True

    async def _cleanup_executions(self, job_id: str) -> None:
        """Delete all execution records for a job. LangGraph thread checkpoints auto-expire via their own TTL."""
        try:
            execution_ids: list[str] = []
            kwargs: Dict[str, Any] = {
                "KeyConditionExpression": "job_id = :jid",
                "ExpressionAttributeValues": {":jid": job_id},
                "ProjectionExpression": "execution_id",
            }
            while True:
                resp = await self._run_sync(
                    lambda: self.executions_table.query(**kwargs)
                )
                for item in resp.get("Items", []):
                    execution_ids.append(item["execution_id"])
                if "LastEvaluatedKey" not in resp:
                    break
                kwargs["ExclusiveStartKey"] = resp["LastEvaluatedKey"]

            if not execution_ids:
                return

            # Batch-delete execution records (25 per batch, DynamoDB limit)
            for i in range(0, len(execution_ids), 25):
                batch = execution_ids[i : i + 25]
                await self._run_sync(
                    lambda batch=batch: self.dynamodb.batch_write_item(
                        RequestItems={
                            self.executions_table.name: [
                                {
                                    "DeleteRequest": {
                                        "Key": {"job_id": job_id, "execution_id": eid}
                                    }
                                }
                                for eid in batch
                            ]
                        }
                    )
                )

            logger.info(
                "Cleaned up %d executions for job %s", len(execution_ids), job_id
            )
        except Exception:
            logger.exception("Failed to cleanup executions for job %s", job_id)

    async def toggle_job(
        self, user_id: str, job_id: str, enabled: bool
    ) -> Optional[Dict]:
        job = await self.get_job(user_id, job_id)
        if not job:
            return None

        if job.get("status") == JobStatus.DELETED:
            raise ValueError("Cannot toggle a deleted job")

        new_status = JobStatus.ENABLED if enabled else JobStatus.DISABLED

        resp = await self._run_sync(
            lambda: self.jobs_table.update_item(
                Key={"user_id": user_id, "job_id": job_id},
                UpdateExpression="SET #s = :s, updated_at = :now",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":s": new_status, ":now": _now_iso()},
                ReturnValues="ALL_NEW",
            )
        )

        if enabled:
            await self._upsert_schedule(
                job_id,
                user_id,
                job["schedule_expression"],
                job.get("timezone", "UTC"),
            )
        else:
            await self._upsert_schedule(
                job_id,
                user_id,
                job["schedule_expression"],
                job.get("timezone", "UTC"),
                enabled=False,
            )

        return _fix_decimals(resp.get("Attributes", {}))

    # =========================================================================
    # Executions
    # =========================================================================

    async def trigger_job(self, user_id: str, job_id: str) -> bool:
        """Send an SQS message to trigger immediate execution of a job."""
        job = await self.get_job(user_id, job_id)
        if not job:
            return False

        await self._run_sync(
            lambda: self.sqs.send_message(
                QueueUrl=TASK_QUEUE_URL,
                MessageBody=json.dumps({"job_id": job_id, "user_id": user_id}),
            )
        )
        return True

    async def list_executions(
        self,
        job_id: str,
        user_id: str,
        limit: int = 20,
        cursor: Optional[Dict] = None,
    ) -> Dict[str, Any]:
        # Verify job ownership
        job = await self.get_job(user_id, job_id)
        if not job:
            return {"executions": []}

        kwargs: Dict[str, Any] = {
            "IndexName": "job-started-index",
            "KeyConditionExpression": "job_id = :jid",
            "ExpressionAttributeValues": {":jid": job_id},
            "ScanIndexForward": False,
            "Limit": limit,
        }
        if cursor:
            kwargs["ExclusiveStartKey"] = cursor

        resp = await self._run_sync(lambda: self.executions_table.query(**kwargs))

        items = [_fix_decimals(i) for i in resp.get("Items", [])]
        result: Dict[str, Any] = {"executions": items}
        if "LastEvaluatedKey" in resp:
            result["cursor"] = _fix_decimals(resp["LastEvaluatedKey"])
        return result

    async def get_execution(
        self, job_id: str, execution_id: str, user_id: str
    ) -> Optional[Dict[str, Any]]:
        # Verify job ownership
        job = await self.get_job(user_id, job_id)
        if not job:
            return None

        resp = await self._run_sync(
            lambda: self.executions_table.get_item(
                Key={"job_id": job_id, "execution_id": execution_id}
            )
        )
        item = resp.get("Item")
        if not item:
            return None

        item = _fix_decimals(item)

        # Fetch output from S3 if offloaded
        s3_key = item.get("output_s3_key")
        if s3_key:
            try:
                s3 = boto3.client("s3", region_name=REGION)
                s3_bucket = os.environ.get("S3_BUCKET")
                obj = await self._run_sync(
                    lambda: s3.get_object(Bucket=s3_bucket, Key=s3_key)
                )
                item["output"] = obj["Body"].read().decode("utf-8")
            except Exception as e:
                logger.error("Failed to fetch output from S3 key %s: %s", s3_key, e)
                item["output"] = (
                    f"[Output stored in S3 but could not be loaded: {s3_key}]"
                )
            del item["output_s3_key"]

        return item

    # =========================================================================
    # EventBridge Scheduler — consolidated
    # =========================================================================

    async def _upsert_schedule(
        self,
        job_id: str,
        user_id: str,
        expression: str,
        tz: str,
        enabled: bool = True,
    ):
        """Create or update an EventBridge schedule. Raises on failure."""
        queue_arn = await self._get_queue_arn()
        common = dict(
            Name=self._schedule_name(job_id),
            GroupName=SCHEDULE_GROUP,
            ScheduleExpression=expression,
            ScheduleExpressionTimezone=tz,
            FlexibleTimeWindow={"Mode": "OFF"},
            Target={
                "Arn": queue_arn,
                "RoleArn": TASK_SCHEDULER_ROLE_ARN,
                "Input": json.dumps({"job_id": job_id, "user_id": user_id}),
            },
            State="ENABLED" if enabled else "DISABLED",
        )
        try:
            await self._run_sync(lambda: self.scheduler.update_schedule(**common))
        except self.scheduler.exceptions.ResourceNotFoundException:
            await self._run_sync(lambda: self.scheduler.create_schedule(**common))

    async def _delete_schedule(self, job_id: str):
        try:
            await self._run_sync(
                lambda: self.scheduler.delete_schedule(
                    Name=self._schedule_name(job_id), GroupName=SCHEDULE_GROUP
                )
            )
        except self.scheduler.exceptions.ResourceNotFoundException:
            pass
        except Exception:
            logger.exception("Failed to delete schedule for job %s", job_id)


scheduled_task_service = ScheduledTaskService()
