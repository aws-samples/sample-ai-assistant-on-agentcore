/**
 * Tool Configuration Service
 *
 * Provides API functions for managing tool configurations.
 * Uses the Core-Services endpoint for synchronous API operations.
 *
 */

import { getAuthToken } from "../components/Agent/context/utils";
import {
  CORE_SERVICES_ENDPOINT,
  CORE_SERVICES_SESSION_ID,
} from "../components/Agent/context/constants";
import { createSparkySessionHeader } from "../utils/sessionSeed";
import { parseErrorResponse } from "../components/Agent/context/errorParser";

// In-flight request cache for deduplication
let toolConfigPromise = null;

/**
 * Fetch the user's tool configuration from the backend.
 * Deduplicates concurrent requests - multiple callers share the same promise.
 *
 * @param {string} persona - The persona identifier (default: "generic")
 * @returns {Promise<Object>} The tool configuration
 */
export const getToolConfig = async (persona = "generic") => {
  // Return existing in-flight request if one exists
  if (toolConfigPromise) {
    return toolConfigPromise;
  }

  // Create new request and cache the promise
  toolConfigPromise = (async () => {
    try {
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
            type: "get_tool_config",
            persona,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch tool config: ${response.status}`);
      }

      const data = await response.json();
      return data.config;
    } finally {
      // Clear the cache after request completes (success or failure)
      toolConfigPromise = null;
    }
  })();

  return toolConfigPromise;
};

/**
 * Save the user's tool configuration to the backend.
 *
 * @param {Object} config - The tool configuration to save
 * @param {string} persona - The persona identifier (default: "generic")
 * @returns {Promise<Object>} The save result
 */
export const saveToolConfig = async (config, persona = "generic") => {
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
        type: "save_tool_config",
        config,
        persona,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to save tool config: ${response.status}`);
  }

  return await response.json();
};

/**
 * Fetch the tool registry from the backend.
 *
 * @returns {Promise<Object>} The tool registry
 */
export const getToolRegistry = async () => {
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
        type: "get_tool_registry",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch tool registry: ${response.status}`);
  }

  const data = await response.json();
  return data.registry;
};

/**
 * Add an MCP server to the user's configuration.
 *
 * @param {Object} server - The MCP server configuration
 * @param {string} persona - The persona identifier (default: "generic")
 * @returns {Promise<Object>} The add result
 */
export const addMCPServer = async (server, persona = "generic") => {
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
        type: "add_mcp_server",
        server,
        persona,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to add MCP server: ${response.status}`);
  }

  const data = await response.json();
  const parsed = parseErrorResponse(data);
  if (parsed) {
    throw new Error(parsed.message);
  }
  return data;
};

/**
 * Delete an MCP server from the user's configuration.
 *
 * @param {string} serverName - The name of the MCP server to delete
 * @param {string} persona - The persona identifier (default: "generic")
 * @returns {Promise<Object>} The delete result
 */
export const deleteMCPServer = async (serverName, persona = "generic") => {
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
        type: "delete_mcp_server",
        server_name: serverName,
        persona,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to delete MCP server: ${response.status}`);
  }

  return await response.json();
};

/**
 * Refresh tools from an MCP server.
 * Connects to the MCP server via core-services, re-discovers its current tools,
 * and syncs the preference in DynamoDB (new tools added as enabled, removed tools
 * cleaned up, existing tool states preserved).
 *
 * @param {string} serverName - The name of the MCP server to refresh
 * @param {string} persona - The persona identifier (default: "generic")
 * @returns {Promise<Object>} The refresh result with updated server config
 */
export const refreshMcpTools = async (serverName, persona = "generic") => {
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
        type: "refresh_mcp_tools",
        server_name: serverName,
        persona,
      },
    }),
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || `Failed to refresh MCP tools: ${response.status}`);
  }

  const data = await response.json();
  const parsed = parseErrorResponse(data);
  if (parsed) {
    throw new Error(parsed.message);
  }
  return data;
};

/**
 * Canvas creation tool IDs (mirrors backend CANVAS_TOOL_IDS).
 */
export const CANVAS_TOOL_IDS = [
  "create_document",
  "create_html_canvas",
  "create_code_canvas",
  "create_diagram",
  "create_svg",
  "create_mermaid",
];

/**
 * Derive the list of enabled canvas tools from a user's tool config.
 *
 * Filters `local_tools` for enabled canvas creation tools and appends
 * `update_canvas` if at least one creation tool is enabled.
 *
 * @param {Object|null} config - The tool configuration object (from getToolConfig)
 * @returns {string[]} Enabled canvas tool names, including `update_canvas` when applicable
 */
export const getEnabledCanvasTools = (config) => {
  const localTools = config?.local_tools;
  if (!localTools) {
    // No config yet — treat all canvas tools as enabled (backward compat)
    return [...CANVAS_TOOL_IDS, "update_canvas"];
  }

  const enabled = CANVAS_TOOL_IDS.filter((id) => {
    const entry = localTools[id];
    // If the tool has no entry yet, treat as enabled (default)
    return entry === undefined || entry.enabled !== false;
  });

  if (enabled.length > 0) {
    return [...enabled, "update_canvas"];
  }
  return [];
};
