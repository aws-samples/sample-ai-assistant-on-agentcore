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
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const listScheduledTasks = (limit = 50, cursor = null) =>
  coreRequest({ type: "list_scheduled_tasks", limit, cursor });

export const getScheduledTask = (jobId) =>
  coreRequest({ type: "get_scheduled_task", job_id: jobId });

export const createScheduledTask = ({
  name,
  prompt,
  schedule_expression,
  timezone = "UTC",
  skills,
}) =>
  coreRequest({
    type: "create_scheduled_task",
    name,
    prompt,
    schedule_expression,
    timezone,
    skills,
  });

export const updateScheduledTask = (jobId, updates) =>
  coreRequest({ type: "update_scheduled_task", job_id: jobId, ...updates });

export const deleteScheduledTask = (jobId) =>
  coreRequest({ type: "delete_scheduled_task", job_id: jobId });

export const toggleScheduledTask = (jobId, enabled) =>
  coreRequest({ type: "toggle_scheduled_task", job_id: jobId, enabled });

export const triggerScheduledTask = (jobId) =>
  coreRequest({ type: "trigger_scheduled_task", job_id: jobId });

export const listTaskExecutions = (jobId, limit = 20, cursor = null) =>
  coreRequest({ type: "list_task_executions", job_id: jobId, limit, cursor });

export const getTaskExecution = (jobId, executionId) =>
  coreRequest({ type: "get_task_execution", job_id: jobId, execution_id: executionId });
