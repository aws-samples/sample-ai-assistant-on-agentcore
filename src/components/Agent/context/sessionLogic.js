/**
 * Pure function extracted from useChatSessionFunctions.
 * Handles SSE consumption without React hook dependencies.
 */

import { addAiMessage, flushBuffer } from "./sessionHelpers";
import { processStreamChunk, parseSSELine } from "./streamChunkHandler";

/**
 * Read an SSE stream from a fetch Response, processing each chunk
 * through the centralized processStreamChunk handler.
 */
export async function consumeSSEStream(response, sessionId, isInterrupt, deps) {
  const { setSessions, sessionRefs, signal } = deps;
  const streamDeps = { setSessions, sessionRefs };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let processingToolUpdate = false;

  // Allow external abort (e.g. stop button) to cancel the read loop
  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        reader.cancel().catch(() => {});
      },
      { once: true }
    );
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value);

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (!line.startsWith("data: ")) continue;

      try {
        const data = parseSSELine(line);
        if (!data) continue;

        if (processingToolUpdate && data.type === "tool" && data.tool_update) {
          // Canvas tool_updates carry canvas_event and need full processing
          if (!data.content?.canvas_event) {
            addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
            continue;
          }
          // Canvas tool_update: fall through to processStreamChunk, but keep flag
          // so subsequent non-canvas tool_updates still use the fast path
        } else {
          processingToolUpdate = false;
        }

        const action = processStreamChunk(data, sessionId, streamDeps);
        if (action === "stop") return;
        if (action === "tool_mode" && !isInterrupt) {
          processingToolUpdate = true;
        }
      } catch (err) {
        if (err.message?.includes("unterminated") || err.message?.includes("Unexpected end")) {
          buffer = line + "\n" + buffer;
          break;
        }
        console.error("Error parsing streaming response:", err);
      }
    }
  }

  // Handle remaining buffer
  if (buffer.trim() && buffer.startsWith("data: ")) {
    try {
      const data = parseSSELine(buffer);
      if (data) processStreamChunk(data, sessionId, streamDeps);
    } catch (err) {
      console.error("Error parsing remaining buffer:", err);
    }
  }
}

/**
 * Consume a stream-resume SSE response.
 * Handles the initial user_message sentinel, then routes all remaining chunks
 * through processStreamChunk — giving canvas, error-envelope, and interrupt
 * events the same treatment as a regular stream.
 *
 * @param {Response} response
 * @param {string} sessionId
 * @param {Object} deps - { setSessions, sessionRefs }
 * @param {Function} onSetup - Called once with the resume user_message when an active stream is found
 * @returns {Promise<boolean>} true if an active stream was found, false otherwise
 */
export async function consumeStreamResumeSSE(response, sessionId, deps, onSetup) {
  const { setSessions, sessionRefs, signal } = deps;
  const streamDeps = { setSessions, sessionRefs };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let setupDone = false;

  if (signal) {
    signal.addEventListener(
      "abort",
      () => {
        reader.cancel().catch(() => {});
      },
      { once: true }
    );
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);

      if (!line.startsWith("data: ")) continue;

      let data;
      try {
        data = parseSSELine(line);
        if (!data) continue;
      } catch (err) {
        if (err.message?.includes("unterminated") || err.message?.includes("Unexpected end")) {
          buffer = line + "\n" + buffer;
          break;
        }
        console.error("Stream resume parse error:", err);
        continue;
      }

      if (data.active === false) return false;

      // First meaningful chunk carries user_message to identify the resumed turn
      if (!setupDone) {
        setupDone = true;
        onSetup(data.user_message || "");
        // This chunk is only a sentinel; actual content chunks follow
        if (data.user_message !== undefined) continue;
      }

      const action = processStreamChunk(data, sessionId, streamDeps);
      if (action === "stop") return true;
    }
  }

  // Handle remaining buffer
  if (buffer.trim().startsWith("data: ")) {
    try {
      const data = parseSSELine(buffer.trim());
      if (data) {
        if (data.active === false) return setupDone;
        processStreamChunk(data, sessionId, streamDeps);
      }
    } catch (err) {
      console.error("Error parsing remaining resume buffer:", err);
    }
  }

  return setupDone;
}
