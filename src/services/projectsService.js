/**
 * Projects Service
 *
 * API calls for managing projects, project files, and session bindings.
 * Uses Core-Services endpoint for all project CRUD operations.
 */

import { getAuthToken } from "../components/Agent/context/utils";
import {
  CORE_SERVICES_ENDPOINT,
  CORE_SERVICES_SESSION_ID,
} from "../components/Agent/context/constants";
import { createSparkySessionHeader } from "../utils/sessionSeed";

const request = async (input) => {
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
    throw new Error(`Request failed: ${response.status}`);
  }

  const data = await response.json();
  if (data.error) {
    const err = new Error(data.message || "Request failed");
    err.code = data.error;
    throw err;
  }
  return data;
};

// ─── Projects CRUD ────────────────────────────────────────────────────────────

export const createProject = (name, description = "") =>
  request({ type: "create_project", name, description });

export const listProjects = (cursor = null) =>
  request({ type: "list_projects", ...(cursor && { cursor }) });

export const getProject = (projectId) => request({ type: "get_project", project_id: projectId });

export const updateProject = (projectId, name, description) =>
  request({ type: "update_project", project_id: projectId, name, description });

export const deleteProject = (projectId) =>
  request({ type: "delete_project", project_id: projectId });

// ─── File Management ──────────────────────────────────────────────────────────

export const getUploadUrl = (projectId, filename, contentType, sizeBytes) =>
  request({
    type: "get_upload_url",
    project_id: projectId,
    filename,
    content_type: contentType,
    size_bytes: sizeBytes,
  });

/**
 * Upload a file directly to S3 using the presigned URL.
 * Must be called after getUploadUrl and before confirmFileUpload.
 */
export const uploadFileToS3 = async (uploadUrl, file) => {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
  });
  if (!response.ok) {
    throw new Error(`S3 upload failed: ${response.status}`);
  }
};

export const confirmFileUpload = (projectId, fileId) =>
  request({ type: "confirm_file_upload", project_id: projectId, file_id: fileId });

export const listProjectFiles = (projectId, cursor = null) =>
  request({ type: "list_project_files", project_id: projectId, ...(cursor && { cursor }) });

export const deleteProjectFile = (projectId, fileId) =>
  request({ type: "delete_project_file", project_id: projectId, file_id: fileId });

export const getFileDownloadUrl = (projectId, fileId) =>
  request({ type: "get_file_download_url", project_id: projectId, file_id: fileId });

// ─── Session Binding ──────────────────────────────────────────────────────────

export const bindProject = (sessionId, projectId) =>
  request({ type: "bind_project", session_id: sessionId, project_id: projectId });

export const unbindProject = (sessionId) =>
  request({ type: "unbind_project", session_id: sessionId });

export const listProjectSessions = (projectId) =>
  request({ type: "list_project_sessions", project_id: projectId });

export const addArtifactToProject = (projectId, s3Key, filename) =>
  request({ type: "add_artifact_to_project", project_id: projectId, s3_key: s3Key, filename });

// ─── Canvas Artifacts ─────────────────────────────────────────────────────────

export const listProjectCanvases = (projectId) =>
  request({ type: "list_project_canvases", project_id: projectId });

export const deleteProjectCanvas = (projectId, canvasId) =>
  request({ type: "delete_project_canvas", project_id: projectId, canvas_id: canvasId });

// ─── Project Memory ────────────────────────────────────────────────────────────

export const listProjectMemories = (projectId) =>
  request({ type: "list_project_memories", project_id: projectId });

export const deleteProjectMemory = (projectId, memoryRecordId) =>
  request({
    type: "delete_project_memory",
    project_id: projectId,
    memory_record_id: memoryRecordId,
  });
