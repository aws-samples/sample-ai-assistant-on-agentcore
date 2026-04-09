/**
 * Create a Sparky session header value
 * Now returns just the session ID without the seed suffix
 * (seed suffix is no longer needed for chat history feature)
 *
 * @param {string} sessionId - The session ID
 * @returns {string} Session header value (just the session ID)
 */
export function createSparkySessionHeader(sessionId) {
  return sessionId;
}
