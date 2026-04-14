"""Shared type definitions for the scheduled tasks feature."""

from typing import Literal, Optional, TypedDict


class JobStatus:
    ENABLED = "enabled"
    DISABLED = "disabled"
    DELETED = "deleted"


class ExecutionStatus:
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class ScheduledJob(TypedDict):
    user_id: str
    job_id: str
    name: str
    prompt: str
    schedule_expression: str
    timezone: str
    status: Literal["enabled", "disabled", "deleted"]
    skills: list[str]
    created_at: str
    updated_at: str


class TaskExecution(TypedDict, total=False):
    job_id: str
    execution_id: str
    user_id: str
    job_name: str
    status: Literal["running", "completed", "failed"]
    started_at: str
    finished_at: str
    output: str
    output_s3_key: str
    error_message: str
    expires_at: int


class TaskMessage(TypedDict):
    job_id: str
    user_id: str


class ScheduledTaskRequest(TypedDict):
    type: Literal["run_scheduled_task"]
    prompt: str
    user_id: str
    job_id: str
    execution_id: str
