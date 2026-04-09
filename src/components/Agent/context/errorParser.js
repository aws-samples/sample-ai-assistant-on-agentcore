/**
 * Parses backend responses to detect error envelopes (new format) and
 * legacy error objects, returning a normalised ParsedError or null.
 *
 * New envelope format: { type: "error", error_code, message, details? }
 * Legacy format:       { error: "some string" }  (no error_code)
 *
 * @param {Object} data - Parsed JSON response body or SSE chunk
 * @returns {{ code: string, message: string, details: Object|null } | null}
 */
export const parseErrorResponse = (data) => {
  if (!data || typeof data !== "object") return null;

  // New Error_Envelope format
  if (data.type === "error" && data.error_code) {
    return {
      code: data.error_code,
      message: data.message,
      details: data.details || null,
    };
  }

  // Legacy format — plain { error: "..." } without error_code
  if (data.error && typeof data.error === "string" && !data.error_code) {
    return {
      code: "unknown",
      message: data.error,
      details: null,
    };
  }

  return null;
};
