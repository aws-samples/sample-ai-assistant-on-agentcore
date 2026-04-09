/**
 * Centralized SSE stream chunk handler.
 * Eliminates the duplicated chunk-processing logic that was repeated
 * 4 times across interrupt/regular/tool-update/remaining-buffer paths.
 *
 * Returns an action string so the caller knows what to do next:
 *   "continue"  – chunk was processed, keep reading
 *   "stop"      – stream should end (end marker, interrupt, or fatal error)
 *   "tool_mode" – caller should switch to tool-update buffering mode
 */

import {
  updateSession,
  addAiMessage,
  cleanupSSE,
  flushBuffer,
  getSessionRefs,
} from "./sessionHelpers";
import { parseErrorResponse } from "./errorParser";
import { isCanvasTool } from "../toolClassification";

/**
 * Ref-based holder for canvas callbacks.
 * The ref object is stable — only its `.current` property is mutated.
 * This avoids the stale-closure risk of a plain module-level `let` while
 * keeping the stream handler decoupled from the React tree.
 */
export const canvasCallbacksRef = { current: null };

/**
 * Process a single parsed SSE data object.
 *
 * @param {Object} data - The parsed JSON from the SSE line
 * @param {string} sessionId
 * @param {Object} deps - Shared dependencies { setSessions, sessionRefs }
 * @returns {"continue"|"stop"|"tool_mode"}
 */
export const processStreamChunk = (data, sessionId, deps) => {
  const { setSessions, sessionRefs } = deps;

  // --- New Error_Envelope format (structured error chunks) ---
  if (data.type === "error" && data.error_code) {
    const parsed = parseErrorResponse(data);

    if (parsed.code === "attachment_error") {
      updateSession(sessionId, setSessions, {
        error: parsed.message,
        isStreaming: false,
        attachmentError: {
          error: parsed.message,
          details: parsed.details,
        },
      });
      cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
      return "stop";
    }

    if (parsed.code === "research_agent_error") {
      updateSession(sessionId, setSessions, {
        error: parsed.message,
        isStreaming: false,
        deepAgentError: {
          error: parsed.message,
          recoverable: parsed.details?.recoverable !== false,
        },
      });
      cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
      return "stop";
    }

    if (parsed.code === "rate_limit") {
      updateSession(sessionId, setSessions, {
        error: parsed.message,
        isStreaming: false,
        sessionError: parsed.message,
      });
      cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
      return "stop";
    }

    // All other error codes — generic error display
    updateSession(sessionId, setSessions, {
      error: parsed.message,
      isStreaming: false,
    });
    cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
    return "stop";
  }

  // --- Legacy: Handle attachment errors (fallback for non-migrated backends) ---
  if (data.type === "attachment_error") {
    const errorMessage = data.error || "Attachment processing failed";
    updateSession(sessionId, setSessions, {
      error: errorMessage,
      isStreaming: false,
      attachmentError: {
        error: errorMessage,
        details: data.details || null,
      },
    });
    cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
    return "stop";
  }

  // --- Legacy: Handle Deep Agent errors (fallback for non-migrated backends) ---
  if (data.type === "deep_agent_error") {
    const errorMessage = data.content || data.error || "Deep Agent encountered an error";
    updateSession(sessionId, setSessions, {
      error: errorMessage,
      isStreaming: false,
      deepAgentError: {
        error: errorMessage,
        recoverable: data.recoverable !== false,
      },
    });
    cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
    return "stop";
  }

  // Handle interrupts — write to session state directly
  if (data.type === "interrupt") {
    addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
    updateSession(sessionId, setSessions, {
      pendingInterrupt: {
        interruptMessage: data,
        source: "sse",
        timestamp: Date.now(),
      },
    });
    return "stop";
  }

  // Handle end of stream
  if (data.end) {
    // Clear all in-flight canvas tools on stream end
    if (canvasCallbacksRef.current) {
      const refs = getSessionRefs(sessionId, sessionRefs);
      if (!refs._activeCanvasTools) refs._activeCanvasTools = new Map();
      if (refs._activeCanvasTools.size > 0) {
        refs._activeCanvasTools.clear();
        canvasCallbacksRef.current.setStreaming(false, null);
      }
    }
    addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
    cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
    return "stop";
  }

  // Handle tool start — signal caller to switch to tool-update mode
  if (data.type === "tool" && data.tool_start) {
    // For canvas tool start, track in the in-flight map and set streaming state.
    if (isCanvasTool(data.tool_name) && canvasCallbacksRef.current) {
      const refs = getSessionRefs(sessionId, sessionRefs);
      if (!refs._activeCanvasTools) refs._activeCanvasTools = new Map();
      refs._activeCanvasTools.set(data.id, { toolName: data.tool_name, canvasId: null });
      const title = data.content?.title || "";
      canvasCallbacksRef.current.setStreaming(true, null, title);
      canvasCallbacksRef.current.openPanel();
    }
    addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
    return "tool_mode";
  }

  // Handle canvas tool_update — granular streaming events (meta, chunk, update_start)
  if (
    data.type === "tool" &&
    data.tool_update &&
    isCanvasTool(data.tool_name) &&
    canvasCallbacksRef.current
  ) {
    const refs = getSessionRefs(sessionId, sessionRefs);
    if (!refs._activeCanvasTools) refs._activeCanvasTools = new Map();
    const canvasEvent = data.content?.canvas_event;

    if (canvasEvent === "meta") {
      // Create the canvas immediately so chunks can stream in
      const canvasId = data.content.canvas_id || data.id;
      const entry = refs._activeCanvasTools.get(data.id);
      if (entry) entry.canvasId = canvasId;
      refs._streamCanvasId = canvasId;

      // Flush any content chunks that arrived before this meta event
      const buffered = entry?.bufferedChunks || [];
      const initialContent = buffered.join("");

      canvasCallbacksRef.current.createCanvas(
        canvasId,
        data.content.title || "",
        data.content.canvas_type || "document",
        initialContent,
        data.id,
        data.content.language || ""
      );
      canvasCallbacksRef.current.setStreaming(true, canvasId, data.content.title);

      // Clear the buffer
      if (entry) delete entry.bufferedChunks;
      return "continue";
    }

    if (canvasEvent === "update_start") {
      const canvasId = data.content.canvas_id;
      const entry = refs._activeCanvasTools.get(data.id);
      if (entry) {
        entry.canvasId = canvasId;
        entry.isUpdateStream = true;
      }
      canvasCallbacksRef.current.startUpdateStream(canvasId, data.content.pattern);
      return "continue";
    }

    if (canvasEvent === "chunk") {
      if (refs._activeCanvasTools.size > 0) {
        const entry = refs._activeCanvasTools.get(data.id);
        if (entry?.isUpdateStream) {
          canvasCallbacksRef.current.appendUpdateChunk(data.content.text);
        } else {
          // If meta hasn't arrived yet (no canvasId), buffer the chunk
          if (entry && !entry.canvasId) {
            if (!entry.bufferedChunks) entry.bufferedChunks = [];
            entry.bufferedChunks.push(data.content.text);
          } else {
            const targetId = (entry && entry.canvasId) || refs._streamCanvasId || data.id;
            canvasCallbacksRef.current.appendStreamChunk(targetId, data.content.text);
          }
        }
      }
      return "continue";
    }

    // Fallback: non-canvas_event tool_update (e.g. legacy batch update with title)
    if (refs._activeCanvasTools.has(data.id) && data.content?.title) {
      canvasCallbacksRef.current.setStreaming(true, null, data.content.title);
    }
    addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
    return "continue";
  }

  // Handle canvas state events pushed from the backend via the updates stream mode.
  // These carry the full canvas content keyed by canvas_id so the frontend can
  // maintain a local store without querying the backend on tool-call click.
  if (data.type === "canvas_state" && data.canvases && canvasCallbacksRef.current) {
    for (const [canvasId, canvas] of Object.entries(data.canvases)) {
      const latestVersion = canvas.versions?.[canvas.latest_version_id];
      if (!latestVersion) continue;

      const existing = canvasCallbacksRef.current.getCanvas?.(canvasId);
      if (existing) {
        canvasCallbacksRef.current.updateCanvas(
          canvasId,
          latestVersion.content,
          latestVersion.tool_call_id,
          canvas.name,
          existing.type,
          existing.language || ""
        );
      } else {
        // Check if the canvas was created during streaming under the tool_call_id
        // as a placeholder key — if so, migrate it to the real canvas_id.
        const streamPlaceholder = canvasCallbacksRef.current.getCanvas?.(
          latestVersion.tool_call_id
        );
        if (streamPlaceholder) {
          canvasCallbacksRef.current.migrateCanvas?.(
            latestVersion.tool_call_id,
            canvasId,
            latestVersion.content,
            latestVersion.tool_call_id,
            canvas.name,
            streamPlaceholder.type,
            streamPlaceholder.language || ""
          );
        } else {
          canvasCallbacksRef.current.createCanvas(
            canvasId,
            canvas.name,
            canvas.type || "document",
            latestVersion.content,
            latestVersion.tool_call_id,
            ""
          );
        }
      }
    }
    return "continue";
  }

  // Handle canvas tool results — clean up streaming state and forward the pointer message
  if (
    data.type === "tool" &&
    !data.tool_start &&
    isCanvasTool(data.tool_name) &&
    canvasCallbacksRef.current
  ) {
    const refs = getSessionRefs(sessionId, sessionRefs);
    if (!refs._activeCanvasTools) refs._activeCanvasTools = new Map();

    // Remove only the completed tool from the in-flight map
    refs._activeCanvasTools.delete(data.id);
    refs._streamCanvasId = null;

    // Only clear streaming state when no other canvas tools remain in-flight
    if (refs._activeCanvasTools.size === 0) {
      canvasCallbacksRef.current.setStreaming(false, null);
    } else {
      // Update streaming to reflect the next active canvas operation
      const [, nextTool] = [...refs._activeCanvasTools.entries()][0];
      if (nextTool.canvasId) {
        canvasCallbacksRef.current.setStreaming(true, nextTool.canvasId);
      }
    }

    addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
    return "continue";
  }

  // Route canvas_meta events — legacy fallback (new backend sends these as tool_updates)
  // Kept for backward compatibility with older backends
  if (data.type === "canvas_meta" && canvasCallbacksRef.current) {
    const refs = getSessionRefs(sessionId, sessionRefs);
    if (!refs._activeCanvasTools) refs._activeCanvasTools = new Map();
    const currentToolId = [...refs._activeCanvasTools.entries()]
      .reverse()
      .find(([, v]) => !v.canvasId)?.[0];
    if (currentToolId) {
      const canvasId = data.canvas_id || currentToolId;
      refs._streamCanvasId = canvasId;
      const entry = refs._activeCanvasTools.get(currentToolId);
      if (entry) entry.canvasId = canvasId;
      canvasCallbacksRef.current.createCanvas(
        canvasId,
        data.title,
        data.canvas_type || "document",
        "",
        currentToolId,
        data.language || ""
      );
      canvasCallbacksRef.current.setStreaming(true, canvasId, data.title);
    }
    return "continue";
  }

  // Route canvas_update_start events — legacy fallback
  if (data.type === "canvas_update_start" && canvasCallbacksRef.current) {
    const refs = getSessionRefs(sessionId, sessionRefs);
    if (!refs._activeCanvasTools) refs._activeCanvasTools = new Map();
    refs._isUpdateStream = true;
    canvasCallbacksRef.current.startUpdateStream(data.canvas_id, data.pattern);
    return "continue";
  }

  // Route canvas_chunk events — legacy fallback
  if (data.type === "canvas_chunk" && canvasCallbacksRef.current) {
    const refs = getSessionRefs(sessionId, sessionRefs);
    if (!refs._activeCanvasTools) refs._activeCanvasTools = new Map();
    if (refs._activeCanvasTools.size > 0) {
      if (refs._isUpdateStream) {
        canvasCallbacksRef.current.appendUpdateChunk(data.content);
      } else {
        const lastToolId = [...refs._activeCanvasTools.keys()].pop();
        const entry = refs._activeCanvasTools.get(lastToolId);
        const targetId = (entry && entry.canvasId) || refs._streamCanvasId || lastToolId;
        canvasCallbacksRef.current.appendStreamChunk(targetId, data.content);
      }
    }
    return "continue";
  }

  // Handle browser control events (separate channel — not added to message list)
  if (data.type === "browser_control") {
    updateSession(sessionId, setSessions, {
      browserControlStatus: data.status,
      browserControlLockId: data.lock_id || null,
    });
    return "continue";
  }

  // Handle browser session events (live VNC endpoint streaming)
  if (data.type === "browser_session") {
    addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
    return "continue";
  }

  // Regular chunk
  addAiMessage(sessionId, data, sessionRefs, setSessions, flushBuffer);
  return "continue";
};

/**
 * Parse a single SSE line and return the JSON data, or null if not parseable.
 */
export const parseSSELine = (line) => {
  if (!line.startsWith("data: ")) return null;
  const jsonStr = line.slice(6).trim();
  if (!jsonStr) return null;
  return JSON.parse(jsonStr);
};
