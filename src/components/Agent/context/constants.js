export const MAX_SESSIONS = 50;

/**
 * Generate a unique session ID for Core-Services calls.
 * This ID is generated once when the app loads and reused for all Core-Services API calls.
 * Sparky calls continue to use their own session IDs based on the chat session.
 */
export const CORE_SERVICES_SESSION_ID = `core-${
  typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
}`;

/**
 * Build the Sparky (streaming) endpoint URL.
 * Used for streaming chat interactions and agent operations.
 */
const buildEndpoint = (path) => {
  if (!import.meta.env.VITE_APP_SPARKY) {
    return null;
  }
  return `https://bedrock-agentcore.${import.meta.env.VITE_COGNITO_REGION}.amazonaws.com/runtimes/${import.meta.env.VITE_APP_SPARKY}/${path}?qualifier=DEFAULT`;
};

/**
 * Build the Core-Services endpoint URL.
 * Used for synchronous API operations (chat history, tool config, search).
 */
const buildCoreServicesEndpoint = () => {
  if (!import.meta.env.VITE_CORE_SERVICES_ENDPOINT) {
    return null;
  }
  return `https://bedrock-agentcore.${import.meta.env.VITE_COGNITO_REGION}.amazonaws.com/runtimes/${import.meta.env.VITE_CORE_SERVICES_ENDPOINT}/invocations?qualifier=DEFAULT`;
};

// Sparky endpoint for streaming operations (chat, prepare, stop, history)
export const SPARKY_ENDPOINT = buildEndpoint("invocations");

// Core-Services endpoint for synchronous operations (chat_history, tool_config, search)
export const CORE_SERVICES_ENDPOINT = buildCoreServicesEndpoint();
