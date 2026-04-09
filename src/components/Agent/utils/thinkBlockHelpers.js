/**
 * Derived-view helpers for Think_Block contentSegments.
 *
 * These replace the parallel `attachedTools` and `webSearchTools` arrays
 * that were previously maintained on think block objects.
 */

/**
 * Return all non-text segments (tools, web searches, web extracts, browser sessions).
 * Replaces the parallel `attachedTools` array.
 *
 * @param {Array} contentSegments - The think block's contentSegments array
 * @returns {Array} Non-text segments
 */
export function getAttachedTools(contentSegments) {
  if (!contentSegments || !Array.isArray(contentSegments)) return [];
  return contentSegments.filter((seg) => seg.type !== "text");
}

/**
 * Return only web search and web extract segments.
 * Replaces the parallel `webSearchTools` array.
 *
 * @param {Array} contentSegments - The think block's contentSegments array
 * @returns {Array} Segments with type 'webSearch' or 'webExtract'
 */
export function getWebSearchTools(contentSegments) {
  if (!contentSegments || !Array.isArray(contentSegments)) return [];
  return contentSegments.filter((seg) => seg.type === "webSearch" || seg.type === "webExtract");
}
