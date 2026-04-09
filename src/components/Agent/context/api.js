import { getAuthToken } from "./utils";
import { SPARKY_ENDPOINT, CORE_SERVICES_ENDPOINT, CORE_SERVICES_SESSION_ID } from "./constants";
import { createSparkySessionHeader } from "../../../utils/sessionSeed";
import { parseErrorResponse } from "./errorParser";

/**
 * Throw if the parsed JSON body is an Error_Envelope.
 * Falls through silently for non-error payloads.
 */
const throwIfErrorEnvelope = (data) => {
  const parsed = parseErrorResponse(data);
  if (parsed) {
    const err = new Error(parsed.message);
    err.code = parsed.code;
    err.details = parsed.details;
    throw err;
  }
};

/**
 * Fetch chat history for the authenticated user from the server.
 * Returns paginated sessions belonging to the user ordered by most recent first.
 *
 * @param {Object} options - Pagination options
 * @param {number} options.limit - Maximum number of sessions to return (default 20)
 * @param {Object} options.cursor - Pagination cursor from previous request
 * @returns {Promise<{sessions: Array, cursor: Object|null, has_more: boolean}>}
 */
export const fetchChatHistory = async ({ limit = 20, cursor = null } = {}) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "chat_history",
        limit,
        bookmarked: false,
        ...(cursor && { cursor }),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch chat history: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return {
    sessions: data.sessions || [],
    cursor: data.cursor || null,
    has_more: data.has_more || false,
  };
};

/**
 * Toggle the bookmarked state of a chat session.
 * Flips the bookmark on or off and returns the new state.
 *
 * @param {string} sessionId - The session to toggle
 * @returns {Promise<{type: string, session_id: string, bookmarked: boolean}>}
 */
export const toggleBookmarkChat = async (sessionId) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: { type: "toggle_bookmark", session_id: sessionId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to toggle bookmark: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

/**
 * Fetch all bookmarked chat sessions for the authenticated user.
 * Returns the full list (no pagination) since bookmarks are capped at 50.
 *
 * @returns {Promise<{sessions: Array}>}
 */
export const fetchBookmarkedChatHistory = async () => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: { type: "bookmarked_chat_history" },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch bookmarked chats: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return { sessions: data.sessions || [] };
};

/**
 * Generate a description for a chat session using the Sparky agent.
 */
export const generateDescription = async (sessionId, message, projectId = null) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "generate_description",
        session_id: sessionId,
        message: message,
        ...(projectId && { project_id: projectId }),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to generate description: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data.description;
};

/**
 * Rename a chat session by updating its description/title.
 *
 * @param {string} sessionId - The session ID to rename
 * @param {string} description - The new title/description
 * @returns {Promise<{type: string, session_id: string, description: string}>}
 */
export const renameChatSession = async (sessionId, description) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "rename_chat",
        session_id: sessionId,
        description: description,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to rename chat session: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

/**
 * Delete a chat session from the server.
 * Removes both the history record and checkpointer data.
 */
export const deleteChatSession = async (sessionId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: {
        type: "delete_history",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to delete chat session: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

/**
 * Create a new session and get the session_id from the backend.
 * This is separate from prepareSession which handles tool preferences and context.
 *
 * @param {string} sessionHeader - The client-generated session header (UUID)
 * @returns {Promise<{session_id: string}>} The session_id to use for subsequent calls
 */
export const createSession = async (sessionHeader) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionHeader),
    },
    body: JSON.stringify({
      input: {
        type: "create_session",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

/**
 * Branch a session at a specific turn, creating a new session with conversation
 * history up to that point.
 *
 * @param {string} sourceSessionId - The session ID to branch from
 * @param {number} turnIndex - Zero-based index of the turn to branch at
 * @returns {Promise<{type: string, session_id: string}>}
 */
export const branchSession = async (sourceSessionId, turnIndex, checkpointId) => {
  const token = await getAuthToken();

  const input = {
    type: "branch",
    source_session_id: sourceSessionId,
    turn_index: turnIndex,
  };
  if (checkpointId) {
    input.checkpoint_id = checkpointId;
  }

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sourceSessionId),
    },
    body: JSON.stringify({ input }),
  });

  if (!response.ok) {
    throw new Error(`Failed to branch session: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const prepareSession = async (
  sessionId,
  diagramPath = null,
  thinking = 0,
  modelId = null,
  refreshTools = false
) => {
  const token = await getAuthToken();

  const requestBody = {
    input: {
      type: "prepare",
      budget_level: thinking,
    },
  };

  if (diagramPath) {
    requestBody.input.diagram = diagramPath;
  }

  if (modelId) {
    requestBody.input.model_id = modelId;
  }

  // Include refresh flag to trigger preference reconciliation
  if (refreshTools) {
    requestBody.input.refresh = true;
  }

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    throw new Error(`Failed to prepare session: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const clearSessionAPI = async (sessionId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: {
        type: "delete_history",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to clear session: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const fetchSessionHistory = async (sessionId) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "get_session_history",
        session_id: sessionId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch history: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return {
    history: data?.history || [],
    canvases: data?.canvases || {},
    boundProject: data?.project ?? null,
  };
};

/**
 * Send a message to the Sparky agent and receive a streaming response.
 * Supports different agent modes for various use cases.
 *
 * @param {string} sessionId - The session ID for the conversation
 * @param {string} userMessage - The user's message to send
 * @param {boolean} interrupt - Whether this is an interrupt response
 * @param {string|Object} interruptResponse - The interrupt response data
 * @param {Array} attachments - Optional file attachments
 * @param {string} agentMode - Agent mode: "normal", "deep", or "research"
 * @param {Object} config - Optional configuration (model_id, budget_level)
 * @returns {Promise<Response>} The fetch Response for streaming
 */
export const sendMessageAPI = async (
  sessionId,
  userMessage,
  interrupt = false,
  interruptResponse = null,
  attachments = null,
  agentMode = "normal",
  config = null,
  enabledTools = null,
  projectId = null
) => {
  let requestBody;

  if (interrupt && interruptResponse) {
    // interruptResponse can be a string (tool name) or an object with type and args
    const isSimpleResponse = typeof interruptResponse === "string";
    requestBody = {
      input: {
        prompt: isSimpleResponse ? interruptResponse : interruptResponse.type,
        type: "resume_interrupt",
        // Include tool_id if provided (for matching interrupts)
        ...(!isSimpleResponse &&
          interruptResponse.tool_id && { tool_id: interruptResponse.tool_id }),
        // Include args if provided (for error handling)
        ...(!isSimpleResponse && interruptResponse.args && { args: interruptResponse.args }),
        // Include agent_mode for Deep Agent support
        agent_mode: agentMode,
        ...(enabledTools && enabledTools.length > 0 && { enabled_tools: enabledTools }),
        ...(projectId && { project_id: projectId }),
      },
    };
  } else {
    requestBody = {
      input: {
        prompt: userMessage,
        // Include agent_mode for Deep Agent support
        agent_mode: agentMode,
        ...(enabledTools && enabledTools.length > 0 && { enabled_tools: enabledTools }),
        ...(projectId && { project_id: projectId }),
      },
    };

    // Add attachments if provided
    // Each attachment contains: name, type, size, data (base64 encoded)
    if (attachments && attachments.length > 0) {
      requestBody.input.attachments = attachments;
    }

    // Include configuration parameters if provided
    // This ensures last-second config changes are reflected when sending messages
    if (config) {
      if (config.model_id) {
        requestBody.input.model_id = config.model_id;
      }
      if (config.budget_level !== undefined && config.budget_level !== null) {
        requestBody.input.budget_level = config.budget_level;
      }
    }
  }

  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Request failed (${response.status}): ${errorText || "Unknown error"}`);
  }

  return response;
};

export const stopAPI = async (sessionId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: {
        type: "stop",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to stop execution: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

/**
 * Search across indexed chat conversations using hybrid search.
 * Queries the Bedrock Knowledge Base with user-scoped filtering and reranking.
 *
 * @param {string} query - The search query string
 * @returns {Promise<{type: string, results: Array, query: string, total: number}>}
 * @throws {Error} If Sparky is disabled or the search request fails
 */
export const searchChats = async (query) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "search",
        query: query,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Search failed: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

// Track active stream resume connections per session to prevent duplicates
const activeStreamResumeControllers = new Map();

/**
 * Refresh a presigned download URL for a previously generated file.
 * Used when loading old conversations where the original presigned URL has expired.
 *
 * @param {string} s3Key - The S3 object key (e.g. pptx/{session_id}/{filename})
 * @returns {Promise<{url: string}>} Fresh presigned URL
 */
export const refreshDownloadUrl = async (s3Key) => {
  const token = await getAuthToken();

  const response = await fetch(CORE_SERVICES_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id":
        createSparkySessionHeader(CORE_SERVICES_SESSION_ID),
    },
    body: JSON.stringify({
      input: {
        type: "refresh_download_url",
        s3_key: s3Key,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to refresh download URL: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

/**
 * Clean up stream resume controller for a session.
 * Call this when stream processing is complete.
 */
export const cleanupStreamResume = (sessionId) => {
  if (activeStreamResumeControllers.has(sessionId)) {
    activeStreamResumeControllers.delete(sessionId);
  }
};

/**
 * Connect to stream-resume endpoint via invocations.
 * Returns a fetch Response object for streaming consumption (SSE).
 * Automatically aborts any existing stream resume for the same session.
 *
 * @param {string} sessionId - The session ID to resume stream for
 * @returns {Promise<Response|null>} The fetch Response for streaming, or null if disabled/failed
 * @throws {Error} If Sparky is disabled
 */
export const connectStreamResume = async (sessionId) => {
  // Abort any existing stream resume for this session
  if (activeStreamResumeControllers.has(sessionId)) {
    activeStreamResumeControllers.get(sessionId).abort();
    activeStreamResumeControllers.delete(sessionId);
  }

  // Create new AbortController for this connection
  const controller = new AbortController();
  activeStreamResumeControllers.set(sessionId, controller);

  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: {
        type: "stream_resume",
      },
    }),
    signal: controller.signal,
  });

  if (!response.ok) {
    console.warn(`Stream resume connection failed: ${response.status}`);
    activeStreamResumeControllers.delete(sessionId);
    return null;
  }

  return response;
};

export const fetchLiveViewUrl = async (sessionId, browserSessionId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: {
        type: "generate_live_view_url",
        browser_session_id: browserSessionId,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch live view URL: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const takeBrowserControl = async (sessionId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: { type: "take_browser_control", session_id: sessionId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to take browser control: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const releaseBrowserControl = async (sessionId, lockId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: { type: "release_browser_control", session_id: sessionId, lock_id: lockId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to release browser control: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const saveCanvasToProject = async (sessionId, projectId, canvasId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: { type: "save_canvas_to_project", project_id: projectId, canvas_id: canvasId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save canvas to project: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const deleteProjectCanvas = async (sessionId, projectId, canvasId) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: { type: "delete_project_canvas", project_id: projectId, canvas_id: canvasId },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to delete project canvas: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};

export const saveCanvasContent = async (sessionId, canvasId, content, title, type) => {
  const token = await getAuthToken();

  const response = await fetch(SPARKY_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": createSparkySessionHeader(sessionId),
    },
    body: JSON.stringify({
      input: {
        type: "canvas_edit",
        canvas_id: canvasId,
        content,
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to save canvas content: ${response.status}`);
  }

  const data = await response.json();
  throwIfErrorEnvelope(data);
  return data;
};
