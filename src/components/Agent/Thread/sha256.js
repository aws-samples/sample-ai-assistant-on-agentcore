/**
 * Compute SHA-256 hex digest of a string using the browser's Web Crypto API.
 * Must match the backend's `_message_content_hash`: for string content, the
 * server hashes the raw string; for list content it canonicalizes first. For
 * the thread anchor flow the frontend only ever hashes the full string body
 * of an AI message as rendered.
 */
export async function sha256Hex(str) {
  const bytes = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const view = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < view.length; i++) {
    hex += view[i].toString(16).padStart(2, "0");
  }
  return hex;
}
