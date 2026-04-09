export const getSessionRefs = (sessionId, sessionRefs) => {
  if (!sessionRefs.current.has(sessionId)) {
    sessionRefs.current.set(sessionId, {
      eventSource: null,
      buffer: [],
      rafId: null,
      isBuffering: false,
    });
  }
  return sessionRefs.current.get(sessionId);
};

export const updateSession = (sessionId, setSessions, updates) => {
  setSessions((prev) => {
    const newSessions = new Map(prev);
    const currentSession = newSessions.get(sessionId);
    if (currentSession) {
      newSessions.set(sessionId, { ...currentSession, ...updates });
    }
    return newSessions;
  });
};

export const setSessionLoading = (sessionId, setLoadingStates, isLoading) => {
  setLoadingStates((prev) => {
    const newStates = new Map(prev);
    if (isLoading) {
      newStates.set(sessionId, true);
    } else {
      newStates.delete(sessionId);
    }
    return newStates;
  });
};

/**
 * Flush all buffered tokens to React state in a single batch update.
 * Token order is preserved: spread operator maintains FIFO order from buffer.
 */
export const flushBuffer = (sessionId, sessionRefs, setSessions) => {
  const refs = getSessionRefs(sessionId, sessionRefs);

  // Clear rafId since we're flushing now
  refs.rafId = null;

  if (!refs.buffer || refs.buffer.length === 0) return;

  // Spread operator preserves insertion order (FIFO)
  const bufferedMessages = [...refs.buffer];
  refs.buffer = [];

  setSessions((prev) => {
    const newSessions = new Map(prev);
    const session = newSessions.get(sessionId);
    if (session && session.chatTurns.length > 0) {
      const updatedTurns = [...session.chatTurns];
      const lastTurnIndex = updatedTurns.length - 1;
      updatedTurns[lastTurnIndex] = {
        ...updatedTurns[lastTurnIndex],
        aiMessage: [...updatedTurns[lastTurnIndex].aiMessage, ...bufferedMessages],
      };
      newSessions.set(sessionId, { ...session, chatTurns: updatedTurns });
    }
    return newSessions;
  });
};

/**
 * Schedule a buffer flush using requestAnimationFrame.
 * Only schedules if not already scheduled and buffer is not empty.
 */
export const scheduleFlush = (sessionId, sessionRefs, setSessions, isStreamingActive = true) => {
  const refs = getSessionRefs(sessionId, sessionRefs);

  // Only schedule if not already scheduled
  if (refs.rafId !== null) {
    return;
  }

  // Only schedule if buffer has content
  if (refs.buffer.length === 0) {
    return;
  }

  refs.isBuffering = true;

  // Use requestAnimationFrame for browser environments, fallback to setTimeout for SSR
  const scheduleCallback =
    typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame
      : (cb) => setTimeout(cb, 16); // ~60Hz fallback

  refs.rafId = scheduleCallback(() => {
    // Clear rafId before any operations
    refs.rafId = null;

    // Skip flush if buffer is empty to avoid unnecessary re-renders
    if (refs.buffer && refs.buffer.length > 0) {
      // Flush the buffer
      flushBuffer(sessionId, sessionRefs, setSessions);
    }

    // Re-schedule if streaming is still active
    // The caller should check isStreaming state and call scheduleFlush again if needed
    refs.isBuffering = false;
  });
};

export const addAiMessage = (sessionId, message, sessionRefs, setSessions, flushBufferFn) => {
  // Filter out empty objects
  if (message && typeof message === "object" && Object.keys(message).length === 0) {
    return;
  }

  const refs = getSessionRefs(sessionId, sessionRefs);
  refs.buffer = refs.buffer || [];

  // Array.push() adds to end, maintaining FIFO order
  refs.buffer.push(message);

  const messageType = message.type || "text";

  // Immediate flush for special message types (tool, interrupt, end marker)
  if (messageType === "tool" || messageType === "interrupt" || message.end) {
    flushBufferFn(sessionId, sessionRefs, setSessions);
    return;
  }

  // Schedule rAF flush for text/think messages
  scheduleFlush(sessionId, sessionRefs, setSessions, true);
};

export const cleanupSSE = (sessionId, sessionRefs, setSessions, flushBufferFn) => {
  const refs = getSessionRefs(sessionId, sessionRefs);

  if (refs.eventSource) {
    refs.eventSource.close();
    refs.eventSource = null;
  }

  // Cancel any pending rAF callback
  if (refs.rafId !== null) {
    const cancelCallback =
      typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout;
    cancelCallback(refs.rafId);
    refs.rafId = null;
  }

  refs.isBuffering = false;

  // Flush any remaining buffered tokens
  flushBufferFn(sessionId, sessionRefs, setSessions);

  updateSession(sessionId, setSessions, { isStreaming: false });
};
