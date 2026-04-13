/**
 * Cron Jobs Service
 *
 * API client for cron job management via Core-Services endpoint.
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
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(
        CORE_SERVICES_SESSION_ID
      ),
    },
    body: JSON.stringify({ input }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Request failed: ${response.status}`);
  }
  return response.json();
}

export const listCronJobs = (limit = 50, cursor = null) =>
  coreRequest({ type: "list_cron_jobs", limit, cursor });

export const getCronJob = (jobId) => coreRequest({ type: "get_cron_job", job_id: jobId });

export const createCronJob = ({ name, prompt, schedule_expression, timezone = "UTC", skills }) =>
  coreRequest({ type: "create_cron_job", name, prompt, schedule_expression, timezone, skills });

export const updateCronJob = (jobId, updates) =>
  coreRequest({ type: "update_cron_job", job_id: jobId, ...updates });

export const deleteCronJob = (jobId) => coreRequest({ type: "delete_cron_job", job_id: jobId });

export const toggleCronJob = (jobId, enabled) =>
  coreRequest({ type: "toggle_cron_job", job_id: jobId, enabled });

export const triggerCronJob = (jobId) =>
  coreRequest({ type: "trigger_cron_job", job_id: jobId });

export const listCronExecutions = (jobId, limit = 20, cursor = null) =>
  coreRequest({ type: "list_cron_executions", job_id: jobId, limit, cursor });

export const getCronExecution = (jobId, executionId) =>
  coreRequest({ type: "get_cron_execution", job_id: jobId, execution_id: executionId });
