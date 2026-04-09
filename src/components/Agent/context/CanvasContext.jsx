import React, { createContext, useContext, useCallback, useMemo, useEffect, useRef } from "react";
import { ChatSessionDataContext, ChatSessionFunctionsContext } from "../ChatContext";

const CanvasContext = createContext(null);

export const DEFAULT_CANVAS_STATE = {
  canvases: new Map(),
  activeCanvasId: null,
  selectedSnapshotIndex: null,
  isPanelOpen: false,
  isStreaming: false,
  streamingCanvasId: null,
  streamingCanvasTitle: null,
  updateStreamPattern: null,
  updateStreamReplacement: null,
};

export function canvasReducer(state, action) {
  switch (action.type) {
    case "CREATE_CANVAS": {
      const { id, title, type, content, language } = action.payload;
      const next = new Map(state.canvases);
      next.set(id, {
        id,
        title,
        type,
        language: language || "",
        latestContent: content,
        snapshots: [{ content, toolCallId: action.payload.toolCallId, action: "created" }],
      });
      // Keep the current active canvas if one is already open
      const keepActive = state.activeCanvasId && state.canvases.has(state.activeCanvasId);
      return {
        ...state,
        canvases: next,
        activeCanvasId: keepActive ? state.activeCanvasId : id,
        selectedSnapshotIndex: keepActive ? state.selectedSnapshotIndex : null,
        isPanelOpen: true,
      };
    }

    case "UPDATE_CANVAS": {
      const { id, content, toolCallId, title, type, language } = action.payload;
      const existing = state.canvases.get(id);
      if (!existing) return state;
      const next = new Map(state.canvases);
      const snapshots = [...existing.snapshots];
      const lastSnap = snapshots[snapshots.length - 1];
      if (lastSnap && lastSnap.toolCallId === toolCallId) {
        snapshots[snapshots.length - 1] = { content, toolCallId, action: "updated" };
      } else {
        snapshots.push({ content, toolCallId, action: "updated" });
      }
      // Apply authoritative metadata from the tool result snapshot.
      // During streaming, type/title may have been set from partial data;
      // the tool_result snapshot is the source of truth.
      const updated = {
        ...existing,
        latestContent: content,
        snapshots,
      };
      if (title) updated.title = title;
      if (type) updated.type = type;
      if (language !== undefined && language !== "") updated.language = language;
      next.set(id, updated);
      return {
        ...state,
        canvases: next,
        activeCanvasId: id,
        selectedSnapshotIndex: null,
        updateStreamPattern: null,
        updateStreamReplacement: null,
      };
    }

    case "APPEND_STREAM_CHUNK": {
      const { id, chunk } = action.payload;
      const existing = state.canvases.get(id);
      if (!existing) {
        return state;
      }
      const next = new Map(state.canvases);
      const updatedContent = existing.latestContent + chunk;
      const snapshots = [...existing.snapshots];
      if (snapshots.length > 0) {
        snapshots[snapshots.length - 1] = {
          ...snapshots[snapshots.length - 1],
          content: updatedContent,
        };
      }
      next.set(id, { ...existing, latestContent: updatedContent, snapshots });
      return { ...state, canvases: next };
    }

    case "SELECT_CANVAS": {
      return {
        ...state,
        activeCanvasId: action.payload,
        selectedSnapshotIndex: null,
        isPanelOpen: true,
      };
    }

    case "SELECT_SNAPSHOT": {
      const { canvasId, index } = action.payload;
      return {
        ...state,
        activeCanvasId: canvasId,
        selectedSnapshotIndex: index,
        isPanelOpen: true,
      };
    }

    case "OPEN_PANEL": {
      return { ...state, isPanelOpen: true };
    }

    case "SET_CANVAS_TITLE": {
      const { id, title } = action.payload;
      const existing = state.canvases.get(id);
      if (!existing) return state;
      const next = new Map(state.canvases);
      next.set(id, { ...existing, title });
      return { ...state, canvases: next };
    }

    case "CLOSE_PANEL": {
      return { ...state, isPanelOpen: false };
    }

    case "SET_STREAMING": {
      const isNewCanvas =
        action.payload.isStreaming &&
        action.payload.canvasId &&
        !state.canvases.has(action.payload.canvasId);
      return {
        ...state,
        isStreaming: action.payload.isStreaming,
        streamingCanvasId: action.payload.canvasId ?? null,
        streamingCanvasTitle: action.payload.title ?? state.streamingCanvasTitle,
        // When streaming a new canvas, clear active so panel shows loading placeholder
        ...(isNewCanvas && { activeCanvasId: null, isPanelOpen: true }),
        // Clear title when streaming ends
        ...(!action.payload.isStreaming && { streamingCanvasTitle: null }),
      };
    }

    case "START_UPDATE_STREAM": {
      const { canvasId, pattern } = action.payload;
      return {
        ...state,
        activeCanvasId: canvasId,
        isPanelOpen: true,
        isStreaming: true,
        streamingCanvasId: canvasId,
        streamingCanvasTitle: null,
        updateStreamPattern: pattern,
        updateStreamReplacement: "",
      };
    }

    case "APPEND_UPDATE_CHUNK": {
      // Append to the streaming replacement text for an in-progress update
      return {
        ...state,
        updateStreamReplacement: (state.updateStreamReplacement || "") + action.payload.chunk,
      };
    }

    case "USER_EDIT_CANVAS": {
      const { id, content } = action.payload;
      const existing = state.canvases.get(id);
      if (!existing) return state;
      const next = new Map(state.canvases);
      next.set(id, { ...existing, latestContent: content });
      return { ...state, canvases: next };
    }

    case "HYDRATE_CANVASES": {
      // Populate canvas state from backend canvases dict (from handle_prepare response).
      // Each backend canvas has { id, name, latest_version_id, versions: { vid: CanvasVersion } }.
      const backendCanvases = action.payload;
      const next = new Map(state.canvases);
      for (const [canvasId, canvas] of Object.entries(backendCanvases)) {
        const sortedVersions = Object.values(canvas.versions).sort((a, b) =>
          a.timestamp.localeCompare(b.timestamp)
        );
        const snapshots = sortedVersions.map((v) => ({
          content: v.content,
          toolCallId: v.tool_call_id,
          action: v.edited_by === "agent" ? "created" : "updated",
        }));
        const latest = canvas.versions[canvas.latest_version_id];
        next.set(canvasId, {
          id: canvasId,
          title: canvas.name,
          type: canvas.type || "document",
          language: "",
          latestContent: latest.content,
          snapshots,
        });
      }
      return { ...state, canvases: next };
    }

    case "MIGRATE_CANVAS": {
      // Re-key a canvas from a streaming placeholder ID to the real canvas_id,
      // updating its content and metadata from the authoritative state event.
      const { oldId, newId, content, toolCallId, title, type, language } = action.payload;
      const existing = state.canvases.get(oldId);
      if (!existing) return state;
      const next = new Map(state.canvases);
      next.delete(oldId);
      const snapshots = [...existing.snapshots];
      const lastSnap = snapshots[snapshots.length - 1];
      if (lastSnap && lastSnap.toolCallId === toolCallId) {
        snapshots[snapshots.length - 1] = { content, toolCallId, action: lastSnap.action };
      } else {
        snapshots.push({ content, toolCallId, action: "updated" });
      }
      next.set(newId, {
        ...existing,
        id: newId,
        title: title || existing.title,
        type: type || existing.type,
        language: language || existing.language,
        latestContent: content,
        snapshots,
      });
      return {
        ...state,
        canvases: next,
        activeCanvasId: state.activeCanvasId === oldId ? newId : state.activeCanvasId,
      };
    }

    case "RESTORE_STATE": {
      return {
        ...state,
        canvases: action.payload,
        activeCanvasId: null,
        isPanelOpen: false,
        selectedSnapshotIndex: null,
      };
    }

    case "RESET": {
      return DEFAULT_CANVAS_STATE;
    }

    default:
      return state;
  }
}

/**
 * Reconstruct canvas state from loaded conversation history messages.
 * Scans tool messages for canvas_snapshot metadata and rebuilds the canvases map.
 */
export function reconstructCanvasState(messages) {
  const canvases = new Map();

  for (const msg of messages) {
    const snapshot =
      msg?.metadata?.canvas_snapshot ?? msg?.additional_kwargs?.metadata?.canvas_snapshot;
    if (!snapshot) continue;

    const { canvas_id, title, type, content, language } = snapshot;
    const toolCallId = msg.tool_call_id ?? msg.id ?? null;
    const existing = canvases.get(canvas_id);

    if (!existing) {
      canvases.set(canvas_id, {
        id: canvas_id,
        title,
        type,
        language: language || "",
        latestContent: content,
        snapshots: [{ content, toolCallId, action: "created" }],
      });
    } else {
      canvases.set(canvas_id, {
        ...existing,
        latestContent: content,
        snapshots: [...existing.snapshots, { content, toolCallId, action: "updated" }],
      });
    }
  }

  return canvases;
}

export function CanvasProvider({ activeSessionId, children }) {
  const { sessions } = useContext(ChatSessionDataContext);
  const { setSessions } = useContext(ChatSessionFunctionsContext);

  // Derive canvas state from the active session's entry in the session map.
  // Falls back to default when no session is active or session not found.
  const state = sessions.get(activeSessionId)?.canvasState ?? DEFAULT_CANVAS_STATE;

  // Dispatch a canvas reducer action by computing the next state and writing
  // it back to the session map. No-op when there is no active session.
  const dispatchCanvas = useCallback(
    (action) => {
      if (!activeSessionId) return;
      setSessions((prev) => {
        const session = prev.get(activeSessionId);
        if (!session) return prev;
        const nextCanvasState = canvasReducer(session.canvasState, action);
        if (nextCanvasState === session.canvasState) return prev;
        const next = new Map(prev);
        next.set(activeSessionId, { ...session, canvasState: nextCanvasState });
        return next;
      });
    },
    [activeSessionId, setSessions]
  );

  const createCanvas = useCallback(
    (id, title, type, content, toolCallId, language) =>
      dispatchCanvas({
        type: "CREATE_CANVAS",
        payload: { id, title, type, content, toolCallId, language },
      }),
    [dispatchCanvas]
  );

  const updateCanvas = useCallback(
    (id, content, toolCallId, title, type, language) =>
      dispatchCanvas({
        type: "UPDATE_CANVAS",
        payload: { id, content, toolCallId, title, type, language },
      }),
    [dispatchCanvas]
  );

  const migrateCanvas = useCallback(
    (oldId, newId, content, toolCallId, title, type, language) =>
      dispatchCanvas({
        type: "MIGRATE_CANVAS",
        payload: { oldId, newId, content, toolCallId, title, type, language },
      }),
    [dispatchCanvas]
  );

  const appendStreamChunk = useCallback(
    (id, chunk) => dispatchCanvas({ type: "APPEND_STREAM_CHUNK", payload: { id, chunk } }),
    [dispatchCanvas]
  );

  const selectCanvas = useCallback(
    (id) => dispatchCanvas({ type: "SELECT_CANVAS", payload: id }),
    [dispatchCanvas]
  );

  const selectSnapshot = useCallback(
    (canvasId, index) => dispatchCanvas({ type: "SELECT_SNAPSHOT", payload: { canvasId, index } }),
    [dispatchCanvas]
  );

  const openPanel = useCallback(() => dispatchCanvas({ type: "OPEN_PANEL" }), [dispatchCanvas]);

  const closePanel = useCallback(() => dispatchCanvas({ type: "CLOSE_PANEL" }), [dispatchCanvas]);

  const updateCanvasTitle = useCallback(
    (id, title) => dispatchCanvas({ type: "SET_CANVAS_TITLE", payload: { id, title } }),
    [dispatchCanvas]
  );

  const setStreaming = useCallback(
    (isStreaming, canvasId, title) =>
      dispatchCanvas({ type: "SET_STREAMING", payload: { isStreaming, canvasId, title } }),
    [dispatchCanvas]
  );

  const startUpdateStream = useCallback(
    (canvasId, pattern) =>
      dispatchCanvas({ type: "START_UPDATE_STREAM", payload: { canvasId, pattern } }),
    [dispatchCanvas]
  );

  const appendUpdateChunk = useCallback(
    (chunk) => dispatchCanvas({ type: "APPEND_UPDATE_CHUNK", payload: { chunk } }),
    [dispatchCanvas]
  );

  const userEditCanvas = useCallback(
    (id, content) => dispatchCanvas({ type: "USER_EDIT_CANVAS", payload: { id, content } }),
    [dispatchCanvas]
  );

  const restoreFromHistory = useCallback(
    (messages) =>
      dispatchCanvas({ type: "RESTORE_STATE", payload: reconstructCanvasState(messages) }),
    [dispatchCanvas]
  );

  const hydrateCanvases = useCallback(
    (backendCanvases) => dispatchCanvas({ type: "HYDRATE_CANVASES", payload: backendCanvases }),
    [dispatchCanvas]
  );

  // Reset only the active session's canvas state to default, leaving other sessions intact.
  const reset = useCallback(() => {
    if (!activeSessionId) return;
    setSessions((prev) => {
      const session = prev.get(activeSessionId);
      if (!session) return prev;
      const next = new Map(prev);
      next.set(activeSessionId, { ...session, canvasState: DEFAULT_CANVAS_STATE });
      return next;
    });
  }, [activeSessionId, setSessions]);

  // ── Hydration effects (moved from AgentInterface) ──

  // Hydrate canvas state from backend canvases when they become available.
  // backendCanvases is set by fetchSessionHistory / prepareSession.
  const lastHydratedRef = useRef(null);
  const activeSession = sessions.get(activeSessionId);
  const backendCanvases = activeSession?.backendCanvases;

  useEffect(() => {
    if (!activeSessionId || !backendCanvases || Object.keys(backendCanvases).length === 0) return;
    // Skip if we already hydrated this exact object reference
    if (lastHydratedRef.current === backendCanvases) return;
    // Skip hydration if the session already has canvases from live streaming —
    // the in-memory state is more current than what the backend returns.
    if (state.canvases.size > 0) {
      lastHydratedRef.current = backendCanvases;
      return;
    }
    lastHydratedRef.current = backendCanvases;
    hydrateCanvases(backendCanvases);
  }, [activeSessionId, backendCanvases, hydrateCanvases, state.canvases]);

  // Fallback: rebuild canvas state from message metadata for pre-migration sessions
  const canvasRestoredRef = useRef(null);
  const chatTurns = activeSession?.chatTurns;

  useEffect(() => {
    if (
      activeSessionId &&
      canvasRestoredRef.current !== activeSessionId &&
      chatTurns &&
      chatTurns.length > 0
    ) {
      if (backendCanvases && Object.keys(backendCanvases).length > 0) return;
      // Skip legacy restore if canvases are already present in memory (e.g. from
      // live streaming). Navigating away and back remounts CanvasProvider with a
      // fresh canvasRestoredRef, and SSE messages lack canvas_snapshot metadata,
      // so restoreFromHistory would wipe the in-memory canvas state.
      if (state.canvases.size > 0) {
        canvasRestoredRef.current = activeSessionId;
        return;
      }
      canvasRestoredRef.current = activeSessionId;
      const allChunks = chatTurns.flatMap((turn) => turn.aiMessage || []);
      if (allChunks.length === 0) return;
      restoreFromHistory(allChunks);
    }
  }, [activeSessionId, chatTurns, backendCanvases, restoreFromHistory, state.canvases]);

  /**
   * Compute display content for a given canvas, applying streaming regex
   * replacement when active, or returning snapshot content when selected.
   */
  const getDisplayContent = useCallback(
    (canvasId) => {
      const canvas = state.canvases.get(canvasId);
      if (!canvas) return "";

      const latestContent = canvas.latestContent ?? "";

      // Apply streaming regex replacement only to the canvas being updated
      if (state.updateStreamPattern && canvasId === state.streamingCanvasId) {
        try {
          const regex = new RegExp(state.updateStreamPattern, "s");
          return latestContent.replace(regex, state.updateStreamReplacement || "");
        } catch {
          // Invalid regex — fall through
        }
      }

      // Return snapshot content when a historical snapshot is selected
      if (state.selectedSnapshotIndex !== null) {
        return canvas.snapshots?.[state.selectedSnapshotIndex]?.content ?? "";
      }

      return latestContent;
    },
    [
      state.canvases,
      state.updateStreamPattern,
      state.updateStreamReplacement,
      state.selectedSnapshotIndex,
    ]
  );

  const value = useMemo(
    () => ({
      ...state,
      createCanvas,
      updateCanvas,
      migrateCanvas,
      appendStreamChunk,
      selectCanvas,
      selectSnapshot,
      openPanel,
      closePanel,
      updateCanvasTitle,
      setStreaming,
      startUpdateStream,
      appendUpdateChunk,
      userEditCanvas,
      restoreFromHistory,
      hydrateCanvases,
      reset,
      getDisplayContent,
    }),
    [
      state,
      createCanvas,
      updateCanvas,
      migrateCanvas,
      appendStreamChunk,
      selectCanvas,
      selectSnapshot,
      openPanel,
      closePanel,
      updateCanvasTitle,
      setStreaming,
      startUpdateStream,
      appendUpdateChunk,
      userEditCanvas,
      restoreFromHistory,
      hydrateCanvases,
      reset,
      getDisplayContent,
    ]
  );

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

export function useCanvas() {
  const context = useContext(CanvasContext);
  if (!context) {
    throw new Error("useCanvas must be used within a CanvasProvider");
  }
  return context;
}

export default CanvasContext;
