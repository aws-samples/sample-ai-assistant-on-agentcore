"""Scheduled Task Service for Core-Services.

DynamoDB CRUD for scheduled_tasks and scheduled_task_executions tables,
plus EventBridge Scheduler management for schedule lifecycle.
"""

import asyncio
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Dict, List, Optional

import boto3
from botocore.exceptions import ClientError

from config import REGION
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
        if not _missing:
            self._ensure_schedule_group()

    def _ensure_schedule_group(self):
        """Create the schedule group if it doesn't exist."""
        try:
            self.scheduler.get_schedule_group(Name=SCHEDULE_GROUP)
        except self.scheduler.exceptions.ResourceNotFoundException:
            try:
                self.scheduler.create_schedule_group(Name=SCHEDULE_GROUP)
            except Exception:
                logger.warning("Could not create schedule group %s", SCHEDULE_GROUP)
        except Exception:
            logger.warning("Could not verify schedule group %s", SCHEDULE_GROUP)

    def _schedule_name(self, job_id: str) -> str:
        return f"{ENV_PREFIX}-task-{job_id}"

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
            "status": "enabled",
            "created_at": now,
            "updated_at": now,
        }

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: self.jobs_table.put_item(Item=item))

        # Create EventBridge schedule
        await self._create_schedule(job_id, user_id, schedule_expression, timezone_str)

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

        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(None, lambda: self.jobs_table.query(**kwargs))

        items = [_fix_decimals(i) for i in resp.get("Items", [])]
        result = {"jobs": items}
        if "LastEvaluatedKey" in resp:
            result["cursor"] = _fix_decimals(resp["LastEvaluatedKey"])
        return result

    async def get_job(self, user_id: str, job_id: str) -> Optional[Dict[str, Any]]:
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: self.jobs_table.get_item(
                Key={"user_id": user_id, "job_id": job_id}
            ),
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

        updates = []
        attr_names = {}
        attr_values = {":now": _now_iso()}
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

        kwargs = {
            "Key": {"user_id": user_id, "job_id": job_id},
            "UpdateExpression": "SET " + ", ".join(updates),
            "ExpressionAttributeValues": attr_values,
            "ReturnValues": "ALL_NEW",
        }
        if attr_names:
            kwargs["ExpressionAttributeNames"] = attr_names

        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None, lambda: self.jobs_table.update_item(**kwargs)
        )
        updated = _fix_decimals(resp.get("Attributes", {}))

        # Update schedule if expression or timezone changed
        if schedule_expression is not None or timezone_str is not None:
            eff_sched = schedule_expression or job.get("schedule_expression", "")
            eff_tz = timezone_str or job.get("timezone", "UTC")
            if job.get("status") == "enabled":
                await self._update_schedule(
                    job_id, user_id, eff_sched, eff_tz, enabled=True
                )

        return updated

    async def delete_job(self, user_id: str, job_id: str) -> bool:
        job = await self.get_job(user_id, job_id)
        if not job:
            return False

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.jobs_table.update_item(
                Key={"user_id": user_id, "job_id": job_id},
                UpdateExpression="SET #s = :s, updated_at = :now",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":s": "deleted", ":now": _now_iso()},
            ),
        )
        await self._delete_schedule(job_id)
        await self._cleanup_executions(job_id)
        return True

    async def _cleanup_executions(self, job_id: str) -> None:
        """Delete all execution records for a job. Checkpoints auto-expire via TTL."""
        loop = asyncio.get_event_loop()
        try:
            execution_ids = []
            kwargs = {
                "KeyConditionExpression": "job_id = :jid",
                "ExpressionAttributeValues": {":jid": job_id},
                "ProjectionExpression": "execution_id",
            }
            while True:
                resp = await loop.run_in_executor(
                    None, lambda: self.executions_table.query(**kwargs)
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
                await loop.run_in_executor(
                    None,
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
                    ),
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

        new_status = "enabled" if enabled else "disabled"
        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: self.jobs_table.update_item(
                Key={"user_id": user_id, "job_id": job_id},
                UpdateExpression="SET #s = :s, updated_at = :now",
                ExpressionAttributeNames={"#s": "status"},
                ExpressionAttributeValues={":s": new_status, ":now": _now_iso()},
                ReturnValues="ALL_NEW",
            ),
        )

        if enabled:
            await self._update_schedule(
                job_id,
                user_id,
                job["schedule_expression"],
                job.get("timezone", "UTC"),
                enabled=True,
            )
        else:
            await self._disable_schedule(job_id)

        return _fix_decimals(resp.get("Attributes", {}))

    # =========================================================================
    # Executions
    # =========================================================================

    async def trigger_job(self, user_id: str, job_id: str) -> bool:
        """Send an SQS message to trigger immediate execution of a job."""
        import json

        job = await self.get_job(user_id, job_id)
        if not job:
            return False

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: self.sqs.send_message(
                QueueUrl=TASK_QUEUE_URL,
                MessageBody=json.dumps({"job_id": job_id, "user_id": user_id}),
            ),
        )
        return True

    async def list_executions(
        self, job_id: str, user_id: str, limit: int = 20, cursor: Optional[Dict] = None
    ) -> Dict[str, Any]:
        # Verify job ownership
        job = await self.get_job(user_id, job_id)
        if not job:
            return {"executions": []}

        kwargs = {
            "IndexName": "job-started-index",
            "KeyConditionExpression": "job_id = :jid",
            "ExpressionAttributeValues": {":jid": job_id},
            "ScanIndexForward": False,
            "Limit": limit,
        }
        if cursor:
            kwargs["ExclusiveStartKey"] = cursor

        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None, lambda: self.executions_table.query(**kwargs)
        )

        items = [_fix_decimals(i) for i in resp.get("Items", [])]
        result = {"executions": items}
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

        loop = asyncio.get_event_loop()
        resp = await loop.run_in_executor(
            None,
            lambda: self.executions_table.get_item(
                Key={"job_id": job_id, "execution_id": execution_id}
            ),
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
                obj = await loop.run_in_executor(
                    None,
                    lambda: s3.get_object(Bucket=s3_bucket, Key=s3_key),
                )
                item["output"] = obj["Body"].read().decode("utf-8")
                del item["output_s3_key"]
            except Exception:
                logger.warning("Failed to fetch execution output from S3: %s", s3_key)

        return item

    # =========================================================================
    # EventBridge Scheduler
    # =========================================================================

    async def _create_schedule(
        self, job_id: str, user_id: str, expression: str, tz: str
    ):
        import json

        loop = asyncio.get_event_loop()
        try:
            # Get SQS queue ARN from URL
            resp = await loop.run_in_executor(
                None,
                lambda: self.sqs.get_queue_attributes(
                    QueueUrl=TASK_QUEUE_URL, AttributeNames=["QueueArn"]
                ),
            )
            queue_arn = resp["Attributes"]["QueueArn"]

            await loop.run_in_executor(
                None,
                lambda: self.scheduler.create_schedule(
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
                    State="ENABLED",
                ),
            )
        except Exception:
            logger.exception("Failed to create schedule for job %s", job_id)
            raise

    async def _update_schedule(
        self, job_id: str, user_id: str, expression: str, tz: str, enabled: bool = True
    ):
        import json

        loop = asyncio.get_event_loop()
        try:
            resp = await loop.run_in_executor(
                None,
                lambda: self.sqs.get_queue_attributes(
                    QueueUrl=TASK_QUEUE_URL, AttributeNames=["QueueArn"]
                ),
            )
            queue_arn = resp["Attributes"]["QueueArn"]

            await loop.run_in_executor(
                None,
                lambda: self.scheduler.update_schedule(
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
                ),
            )
        except Exception:
            logger.exception("Failed to update schedule for job %s", job_id)

    async def _disable_schedule(self, job_id: str):
        loop = asyncio.get_event_loop()
        try:
            # Get current schedule to preserve its config
            sched = await loop.run_in_executor(
                None,
                lambda: self.scheduler.get_schedule(
                    Name=self._schedule_name(job_id), GroupName=SCHEDULE_GROUP
                ),
            )
            await loop.run_in_executor(
                None,
                lambda: self.scheduler.update_schedule(
                    Name=self._schedule_name(job_id),
                    GroupName=SCHEDULE_GROUP,
                    ScheduleExpression=sched["ScheduleExpression"],
                    ScheduleExpressionTimezone=sched.get(
                        "ScheduleExpressionTimezone", "UTC"
                    ),
                    FlexibleTimeWindow=sched.get("FlexibleTimeWindow", {"Mode": "OFF"}),
                    Target=sched["Target"],
                    State="DISABLED",
                ),
            )
        except self.scheduler.exceptions.ResourceNotFoundException:
            pass
        except Exception:
            logger.exception("Failed to disable schedule for job %s", job_id)

    async def _delete_schedule(self, job_id: str):
        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(
                None,
                lambda: self.scheduler.delete_schedule(
                    Name=self._schedule_name(job_id), GroupName=SCHEDULE_GROUP
                ),
            )
        except self.scheduler.exceptions.ResourceNotFoundException:
            pass
        except Exception:
            logger.exception("Failed to delete schedule for job %s", job_id)


scheduled_task_service = ScheduledTaskService()
