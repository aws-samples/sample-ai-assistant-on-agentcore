import { useMemo } from "react";
import {
  prepareSession as prepareSessionAPI,
  clearSessionAPI,
  fetchSessionHistory,
  sendMessageAPI,
  stopAPI,
  connectStreamResume,
  cleanupStreamResume,
} from "./context/api";
import {
  getSessionRefs,
  updateSession,
  setSessionLoading,
  flushBuffer,
  cleanupSSE,
} from "./context/sessionHelpers";
import { MAX_SESSIONS } from "./context/constants";
import { consumeSSEStream, consumeStreamResumeSSE } from "./context/sessionLogic";
import { DEFAULT_CANVAS_STATE } from "./context/CanvasContext";

export const useChatSessionFunctions = (props) => {
  const {
    setSessions,
    setLoadingStates,
    sessionsRef,
    sessionRefs,
    initializedSessions,
    initializingPromises,
    checkForInterruptInChatTurns,
  } = props;

  return useMemo(() => {
    // ─── Session CRUD ──────────────────────────────────────────────

    const clearSession = async (sessionId) => {
      setSessionLoading(sessionId, setLoadingStates, true);
      try {
        const data = await clearSessionAPI(sessionId);
        updateSession(sessionId, setSessions, { chatTurns: [], error: null, isStreaming: false });
        return data;
      } catch (error) {
        console.error(`Failed to clear session ${sessionId}:`, error);
        throw error;
      } finally {
        setSessionLoading(sessionId, setLoadingStates, false);
      }
    };

    const removeSession = (sessionId) => {
      setSessions((prev) => {
        const newSessions = new Map(prev);
        newSessions.delete(sessionId);
        return newSessions;
      });

      setLoadingStates((prev) => {
        const newStates = new Map(prev);
        newStates.delete(sessionId);
        return newStates;
      });

      const refs = sessionRefs.current.get(sessionId);
      if (refs) {
        if (refs.eventSource) refs.eventSource.close();
        if (refs.rafId !== null) {
          const cancel =
            typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout;
          cancel(refs.rafId);
          refs.rafId = null;
        }
        refs.isBuffering = false;
        sessionRefs.current.delete(sessionId);
      }

      initializedSessions.current.delete(sessionId);
      initializingPromises.current.delete(sessionId);
    };

    const dismissError = (sessionId) => {
      updateSession(sessionId, setSessions, { error: null });
    };

    const dismissAttachmentError = (sessionId) => {
      updateSession(sessionId, setSessions, { attachmentError: null });
    };

    const dismissDeepAgentError = (sessionId) => {
      updateSession(sessionId, setSessions, { deepAgentError: null });
    };

    const dismissInterrupt = (sessionId) => {
      updateSession(sessionId, setSessions, { pendingInterrupt: null });
    };

    // ─── Session Eviction ──────────────────────────────────────────

    /**
     * Evict stale sessions when the Map exceeds MAX_SESSIONS.
     * Keeps the active session and any streaming sessions.
     * Evicts oldest non-streaming sessions first.
     */
    const evictStaleSessions = (activeSessionId) => {
      const currentSessions = sessionsRef.current;
      if (currentSessions.size <= MAX_SESSIONS) return;

      // Derive the session the user is currently viewing from the URL
      // so prefetch-triggered evictions never remove it
      const viewedSessionId = window.location.pathname.startsWith("/chat/")
        ? window.location.pathname.slice("/chat/".length)
        : null;

      const evictable = [];
      for (const [id, session] of currentSessions) {
        // Never evict the active session, the viewed session, or sessions that are streaming
        if (id === activeSessionId || id === viewedSessionId || session.isStreaming) continue;
        evictable.push(id);
      }

      // Evict oldest first (Map iteration order = insertion order)
      const toEvict = evictable.slice(0, currentSessions.size - MAX_SESSIONS);
      for (const id of toEvict) {
        removeSession(id);
      }
    };

    // ─── Session Initialization ────────────────────────────────────

    const ensureSessionRefs = (sessionId) => {
      if (!sessionRefs.current.has(sessionId)) {
        sessionRefs.current.set(sessionId, {
          eventSource: null,
          buffer: [],
          rafId: null,
          isBuffering: false,
        });
      }
    };

    const createDefaultSession = (sessionId, overrides = {}) => ({
      id: sessionId,
      chatTurns: [],
      isStreaming: false,
      error: null,
      restoredFromBackend: false,
      canvasState: DEFAULT_CANVAS_STATE,
      ...overrides,
    });

    const initializeSession = async (sessionId, forceCheck = false, skipHistoryFetch = false) => {
      if (!forceCheck && initializingPromises.current.has(sessionId)) {
        return initializingPromises.current.get(sessionId);
      }
      if (!forceCheck && initializedSessions.current.has(sessionId)) {
        return;
      }

      let resolveInit;
      const initPromise = new Promise((resolve) => {
        resolveInit = resolve;
      });
      initializingPromises.current.set(sessionId, initPromise);

      const existingSession = sessionsRef.current.get(sessionId);
      if (!forceCheck && existingSession && existingSession.chatTurns.length > 0) {
        initializedSessions.current.add(sessionId);
        initializingPromises.current.delete(sessionId);
        resolveInit();
        return initPromise;
      }

      (async () => {
        try {
          setSessionLoading(sessionId, setLoadingStates, true);

          let chatTurns = null;
          let backendCanvases = {};
          let boundProject = null;
          let isActiveStream = false;

          // Step 1: Fetch history
          if (!skipHistoryFetch) {
            try {
              const result = await fetchSessionHistory(sessionId);
              chatTurns = result.history;
              backendCanvases = result.canvases || {};
              boundProject = result.boundProject ?? null;
            } catch (error) {
              console.warn(`Failed to fetch session ${sessionId} history:`, error);
              chatTurns = null;
            }
          }

          // Step 2: Stream resume
          if (!skipHistoryFetch) {
            try {
              const resumeResponse = await connectStreamResume(sessionId);
              if (resumeResponse) {
                await consumeStreamResumeSSE(
                  resumeResponse,
                  sessionId,
                  { setSessions, sessionRefs },
                  (userMessage) => {
                    // When resuming an active stream, the last turn from history
                    // is the same turn being streamed. Always replace it to avoid
                    // duplicates — the stream resume replays all chunks from the start.
                    isActiveStream = true;
                    const existingTurns = chatTurns || [];
                    const lastTurn =
                      existingTurns.length > 0 ? existingTurns[existingTurns.length - 1] : null;
                    const lastTurnMatchesResume = lastTurn && lastTurn.userMessage === userMessage;
                    let resumedTurn;
                    if (lastTurnMatchesResume) {
                      chatTurns = existingTurns.slice(0, -1);
                      resumedTurn = { ...lastTurn, aiMessage: [] };
                    } else if (
                      lastTurn &&
                      (!lastTurn.aiMessage || lastTurn.aiMessage.length === 0)
                    ) {
                      // Last turn has no AI response at all — likely the same turn
                      chatTurns = existingTurns.slice(0, -1);
                      resumedTurn = { ...lastTurn, aiMessage: [] };
                    } else {
                      resumedTurn = {
                        id: `turn_resumed_${Date.now()}`,
                        userMessage,
                        aiMessage: [],
                        attachments: [],
                      };
                    }
                    setSessions((prev) => {
                      const newSessions = new Map(prev);
                      newSessions.set(
                        sessionId,
                        createDefaultSession(sessionId, {
                          chatTurns: [...chatTurns, resumedTurn],
                          isStreaming: true,
                        })
                      );
                      return newSessions;
                    });
                    setSessionLoading(sessionId, setLoadingStates, false);
                  }
                );
                cleanupStreamResume(sessionId);
                if (isActiveStream) {
                  setSessions((prev) => {
                    const newSessions = new Map(prev);
                    const session = newSessions.get(sessionId);
                    if (session) {
                      newSessions.set(sessionId, {
                        ...session,
                        isStreaming: false,
                        restoredFromBackend: true,
                      });
                    }
                    return newSessions;
                  });
                }
              }
            } catch (error) {
              cleanupStreamResume(sessionId);
              if (error.name === "AbortError") return;
              console.warn(`Failed to connect to stream resume for session ${sessionId}:`, error);
            }
          }

          // Set session from history if no active stream
          if (chatTurns !== null && !isActiveStream) {
            const restoredSession = createDefaultSession(sessionId, {
              chatTurns,
              backendCanvases,
              boundProject,
              restoredFromBackend: true,
            });

            setSessions((prev) => {
              const newSessions = new Map(prev);
              newSessions.set(sessionId, restoredSession);
              return newSessions;
            });

            if (!isActiveStream) {
              const interruptMessage = checkForInterruptInChatTurns(chatTurns);
              if (interruptMessage) {
                updateSession(sessionId, setSessions, {
                  pendingInterrupt: {
                    interruptMessage,
                    source: "memory",
                    timestamp: Date.now(),
                  },
                });
              }
            }

            ensureSessionRefs(sessionId);
            initializedSessions.current.add(sessionId);
            setSessionLoading(sessionId, setLoadingStates, false);
            return;
          }

          // Fallback: empty session
          const newSession = createDefaultSession(sessionId);
          setSessions((prev) => {
            const existingSession = prev.get(sessionId);
            if (existingSession && existingSession.chatTurns.length > 0) return prev;
            const newSessions = new Map(prev);
            newSessions.set(sessionId, newSession);
            return newSessions;
          });

          ensureSessionRefs(sessionId);
          initializedSessions.current.add(sessionId);
          setSessionLoading(sessionId, setLoadingStates, false);
        } catch (error) {
          console.error(`Error initializing session ${sessionId}:`, error);
          setSessionLoading(sessionId, setLoadingStates, false);

          setSessions((prev) => {
            if (prev.has(sessionId)) return prev;
            const newSessions = new Map(prev);
            newSessions.set(sessionId, createDefaultSession(sessionId));
            return newSessions;
          });

          initializedSessions.current.add(sessionId);
        } finally {
          initializingPromises.current.delete(sessionId);
          evictStaleSessions(sessionId);
          resolveInit();
        }
      })();

      return initPromise;
    };

    // ─── Message Sending ───────────────────────────────────────────

    const MAX_RETRIES = 3;
    const RETRY_DELAYS = [500, 1000, 2000];

    const isRetryableError = (error) => {
      const retryableMessages = ["network", "timeout", "fetch", "connection"];
      const errorMessage = error.message?.toLowerCase() || "";
      const isNetworkError = retryableMessages.some((msg) => errorMessage.includes(msg));
      const retryableStatusCodes = [408, 429, 502, 503, 504];
      const hasRetryableStatus = error.status && retryableStatusCodes.includes(error.status);
      return isNetworkError || hasRetryableStatus;
    };

    const sendMessage = async (
      sessionId,
      userMessage,
      interrupt = false,
      interruptResponse = null,
      attachments = null,
      agentMode = "normal",
      config = null,
      retryAttempt = 0,
      enabledTools = null,
      projectId = null
    ) => {
      if (!userMessage.trim()) return;

      const currentSession = sessionsRef.current.get(sessionId);

      // Retry logic for session not ready
      if (!currentSession) {
        if (retryAttempt < MAX_RETRIES) {
          console.warn(`Session ${sessionId} not ready. Retry ${retryAttempt + 1}/${MAX_RETRIES}`);
          if (!initializedSessions.current.has(sessionId)) {
            await initializeSession(sessionId);
          }
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[retryAttempt]));
          return sendMessage(
            sessionId,
            userMessage,
            interrupt,
            interruptResponse,
            attachments,
            agentMode,
            config,
            retryAttempt + 1,
            enabledTools,
            projectId
          );
        }
        updateSession(sessionId, setSessions, {
          error: "Session not ready. Please try again later.",
          isStreaming: false,
        });
        throw new Error(`Session ${sessionId} initialization timeout`);
      }

      if (!interrupt && currentSession.isStreaming) return;

      // For regular messages, set up the new turn
      if (!interrupt) {
        cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
        const turnId = `turn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const newTurn = {
          id: turnId,
          userMessage,
          aiMessage: [],
          attachments: attachments || [],
        };

        setSessions((prev) => {
          const newSessions = new Map(prev);
          const session = newSessions.get(sessionId);
          if (!session) return prev;
          newSessions.set(sessionId, {
            ...session,
            chatTurns: [...session.chatTurns, newTurn],
            isStreaming: true,
            error: null,
            browserControlStatus: null,
            browserControlLockId: null,
          });
          return newSessions;
        });
      }

      try {
        const response = await sendMessageAPI(
          sessionId,
          userMessage,
          interrupt,
          interruptResponse,
          attachments,
          agentMode,
          config,
          enabledTools,
          projectId
        );
        // Create an AbortController so stopStreaming can cancel the read loop
        const abortController = new AbortController();
        const refs = getSessionRefs(sessionId, sessionRefs);
        refs._streamAbortController = abortController;
        await consumeSSEStream(response, sessionId, interrupt, {
          setSessions,
          sessionRefs,
          signal: abortController.signal,
        });
      } catch (err) {
        console.error("Error sending message:", err);

        if (!interrupt && retryAttempt < MAX_RETRIES && isRetryableError(err)) {
          await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS[retryAttempt]));
          return sendMessage(
            sessionId,
            userMessage,
            interrupt,
            interruptResponse,
            attachments,
            agentMode,
            config,
            retryAttempt + 1,
            enabledTools,
            projectId
          );
        }

        if (!interrupt) {
          updateSession(sessionId, setSessions, {
            error: err.message || "Failed to send message. Please try again.",
          });
          cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
        }
        throw err;
      }
    };

    // ─── Other Actions ─────────────────────────────────────────────

    const prepareSession = async (sessionId, ...args) => {
      try {
        const data = await prepareSessionAPI(sessionId, ...args);
        const updates = {};
        // Store canvases from the prepare response on the session so the
        // canvas context can hydrate from the authoritative checkpointer state.
        if (data?.canvases && Object.keys(data.canvases).length > 0) {
          updates.backendCanvases = data.canvases;
        }
        // Store bound project (with saved_canvases) from prepare response
        if (data?.project) {
          updates.boundProject = data.project;
        }
        // Store enabled optional tools so the chat can build per-request
        // enabled_tools without a separate get_tool_config call.
        if (data?.enabled_optional_tools) {
          updates.enabledOptionalTools = data.enabled_optional_tools;
        }
        if (Object.keys(updates).length > 0) {
          updateSession(sessionId, setSessions, updates);
        }
        return data;
      } catch (error) {
        console.error(`Failed to prepare session ${sessionId}:`, error);
        updateSession(sessionId, setSessions, {
          error: error.message || "Failed to prepare session",
        });
        throw error;
      }
    };

    const clearChat = (sessionId) => {
      cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
      updateSession(sessionId, setSessions, { chatTurns: [], error: null });
      const refs = getSessionRefs(sessionId, sessionRefs);
      refs.buffer = [];
    };

    const stopStreaming = async (sessionId) => {
      try {
        // Tell the backend to stop first, then cancel the local read loop
        const data = await stopAPI(sessionId);
        const refs = getSessionRefs(sessionId, sessionRefs);
        refs._streamAbortController?.abort();
        refs._streamAbortController = null;

        updateSession(sessionId, setSessions, {
          error: null,
          isStreaming: false,
          browserControlStatus: null,
          browserControlLockId: null,
        });
        cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
        return data;
      } catch (error) {
        console.error(`Failed to stop ${sessionId}:`, error);
        // Even if the stop API fails, abort the local reader
        const refs = getSessionRefs(sessionId, sessionRefs);
        refs._streamAbortController?.abort();
        refs._streamAbortController = null;

        updateSession(sessionId, setSessions, {
          error: error.message || "Failed to stop generation",
          isStreaming: false,
        });
        cleanupSSE(sessionId, sessionRefs, setSessions, flushBuffer);
      }
    };

    const refreshSession = async (sessionId) => {
      initializedSessions.current.delete(sessionId);
      await initializeSession(sessionId, true);
    };

    const flushAllSessions = () => {
      Array.from(sessionsRef.current.keys()).forEach(removeSession);
    };

    const handleAuthChange = (newUser = null, oldUser = null) => {
      if (!newUser || (oldUser && newUser?.id !== oldUser?.id)) {
        flushAllSessions();
      }
    };

    return {
      initializeSession,
      prepareSession,
      clearSession,

      sendMessage,
      clearChat,
      stopStreaming,
      dismissError,
      dismissAttachmentError,
      dismissDeepAgentError,
      dismissInterrupt,
      refreshSession,
      removeSession,
      flushAllSessions,
      handleAuthChange,
    };
  }, []);
};
