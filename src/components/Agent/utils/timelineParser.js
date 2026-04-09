/**
 * Timeline Parser Module
 *
 * Parses content segments into timeline steps for the UnifiedThinkingBlock component.
 *
 * @module timelineParser
 */

/**
 * @typedef {Object} ThinkingSegment
 * @property {string} id - Unique identifier for the segment
 * @property {string} content - The text content of the segment
 * @property {'paragraph' | 'header' | 'list'} type - The type of segment
 */

/**
 * @typedef {Object} TimelineStep
 * @property {string} id - Unique identifier for the step
 * @property {'thinking' | 'tool'} type - The type of step
 * @property {ThinkingSegment} [segment] - For thinking steps, the segment data
 * @property {string} [toolName] - For tool steps, the tool name
 * @property {string} [toolContent] - For tool steps, the tool content/result
 * @property {boolean} [isToolComplete] - For tool steps, whether the tool has completed
 * @property {string} [toolError] - For tool steps, any error message
 */

/**
 * Build timeline steps from content segments.
 *
 * Accepts contentSegments array as input (from ChatMessage's think block),
 * creates TimelineStep objects for each segment and tool, and preserves
 * chronological order.
 *
 * Content segments have types: "text", "tool", "webSearch", "webExtract"
 *
 * @param {Array<{type: string, content: string, toolName?: string, isComplete?: boolean, error?: string}>} contentSegments - Array of content segments from props
 * @returns {TimelineStep[]} Array of TimelineStep objects in chronological order
 */
export function buildTimelineSteps(contentSegments) {
  // Handle null, undefined, or non-array inputs
  if (!Array.isArray(contentSegments)) {
    return [];
  }

  const steps = [];

  for (const segment of contentSegments) {
    // Handle text segments (thinking content)
    if (segment.type === "text" && segment.content) {
      // For text segments, we create a thinking step with the segment data
      steps.push({
        id: `think-${steps.length}`,
        type: "thinking",
        segment: {
          id: `segment-${steps.length}`,
          content: segment.content,
          type: "paragraph",
        },
      });
    }
    // Handle tool segments (generic tools, webSearch, webExtract)
    else if (
      segment.type === "tool" ||
      segment.type === "webSearch" ||
      segment.type === "webExtract"
    ) {
      steps.push({
        id: `tool-${steps.length}`,
        type: "tool",
        toolName: segment.toolName,
        toolContent: segment.content,
        toolInput: segment.input,
        isToolComplete: segment.isComplete,
        toolError: segment.error,
      });
    }
    // Handle browser session segments (live viewer)
    else if (segment.type === "browser_session") {
      steps.push({
        id: `browser-${steps.length}`,
        type: "browser_session",
        toolName: "browser",
        liveEndpoint: segment.liveEndpoint,
        browserSessionId: segment.browserSessionId,
        status: segment.status,
        isToolComplete: true,
      });
    }
  }

  return steps;
}

export default {
  buildTimelineSteps,
};
