/**
 * Scheduled Tasks Service
 *
 * API client for scheduled task management via Core-Services endpoint.
 */

import { getAuthToken } from "../components/Agent/context/utils";
import {
  CORE_SERVICES_ENDPOINT,
  CORE_SERVICES_SESSION_ID,
} from "../components/Agent/context/constants";
import { createSparkySessionHeader } from "../utils/sessionSeed";

async function coreRequest(input) {
  const token = await getAuthToken();
  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({ input }),
  });
  if (!response.ok) {
    const err = await response
      .json()
      .catch(() => ({ error: `Request failed: ${response.status}` }));
    throw new Error(err.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export function listScheduledTasks(limit = 50, cursor = null) {
  return coreRequest({ type: "list_scheduled_tasks", limit, cursor });
}

export function getScheduledTask(jobId) {
  return coreRequest({ type: "get_scheduled_task", job_id: jobId });
}

export function createScheduledTask({
  name,
  prompt,
  schedule_expression,
  timezone = "UTC",
  skills,
}) {
  return coreRequest({
    type: "create_scheduled_task",
    name,
    prompt,
    schedule_expression,
    timezone,
    skills,
  });
}

export function updateScheduledTask(jobId, updates) {
  return coreRequest({ type: "update_scheduled_task", job_id: jobId, ...updates });
}

export function deleteScheduledTask(jobId) {
  return coreRequest({ type: "delete_scheduled_task", job_id: jobId });
}

export function toggleScheduledTask(jobId, enabled) {
  return coreRequest({ type: "toggle_scheduled_task", job_id: jobId, enabled });
}

export function triggerScheduledTask(jobId) {
  return coreRequest({ type: "trigger_scheduled_task", job_id: jobId });
}

export function listTaskExecutions(jobId, limit = 20, cursor = null) {
  return coreRequest({ type: "list_task_executions", job_id: jobId, limit, cursor });
}

export function getTaskExecution(jobId, executionId) {
  return coreRequest({ type: "get_task_execution", job_id: jobId, execution_id: executionId });
}
