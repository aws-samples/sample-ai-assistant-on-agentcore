import { useMemo } from "react";
import {
  prepareSession as prepareSessionAPI,
  clearSessionAPI,
  fetchSessionHistory,
  sendMessageAPI,
  stopAPI,
  connectStreamResume,
  cleanupStreamResume,
  sendThreadCreateAPI,
  sendThreadMessageAPI,
  fetchThreadAPI,
  deleteThreadAPI,
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

/**
 * Threads live as first-class entries in the top-level `sessions` Map, keyed
 * by a composite id containing this marker so they can't collide with real
 * session UUIDs and are easy to detect.
 */
const THREAD_SESSION_MARKER = "#thread:";

// Sentinel activeThreadId values that aren't real thread_ids.
// - DRAFT:   user started a thread (clicked "Ask Sparky") but hasn't sent yet
// - PENDING: thread_create API is in-flight, drawer shows streaming state
export const THREAD_DRAFT_ID = "__draft__";
export const THREAD_PENDING_ID = "__pending__";

export const threadSessionId = (parentSessionId, threadId) =>
  `${parentSessionId}${THREAD_SESSION_MARKER}${threadId}`;

export const parseThreadSessionId = (sessionId) => {
  const idx = sessionId?.indexOf?.(THREAD_SESSION_MARKER);
  if (typeof idx !== "number" || idx < 0) return null;
  return {
    parent: sessionId.slice(0, idx),
    thread: sessionId.slice(idx + THREAD_SESSION_MARKER.length),
  };
};

/** Flatten a possibly-structured content value into plain text. */
const extractText = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (typeof b === "string" ? b : b?.text || b?.content || "")).join("");
  }
  if (content && typeof content === "object") {
    return content.text || content.content || "";
  }
  return "";
};

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
      // Threads — side-conversations anchored to AI message spans. Each thread
      // is rendered via a synthetic session entry in the top-level sessions
      // Map (keyed by threadSessionId(parent, thread)), so it reuses the main
      // ChatContent/streaming pipeline wholesale. The parent session only
      // tracks anchors + which thread is currently open in the drawer.
      threadAnchors: new Map(), // Map<threadId, Anchor>
      activeThreadId: null,
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
          let backendThreadAnchors = [];
          let boundProject = null;
          let isActiveStream = false;

          // Step 1: Fetch history
          if (!skipHistoryFetch) {
            try {
              const result = await fetchSessionHistory(sessionId);
              chatTurns = result.history;
              backendCanvases = result.canvases || {};
              backendThreadAnchors = result.threadAnchors || [];
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
            // Build the threadAnchors Map from the array returned by the backend.
            const anchorMap = new Map();
            for (const a of backendThreadAnchors) {
              if (a?.thread_id) anchorMap.set(a.thread_id, a);
            }

            const restoredSession = createDefaultSession(sessionId, {
              chatTurns,
              backendCanvases,
              boundProject,
              threadAnchors: anchorMap,
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

    // ─── Threads (side-conversations) ──────────────────────────────
    //
    // A Thread lives as a SYNTHETIC session in the top-level sessions Map,
    // keyed by threadSessionId(parent, thread). That gives us the entire
    // main-chat rendering + streaming pipeline for free — ChatContent, the
    // SSE consumer, chatTurns buffering, stop/retry, etc.
    //
    // Anchors and activeThreadId still live on the PARENT session so the
    // "open this thread" dropdown and selection menu can find them.

    /** Ensure a synthetic session exists for the given thread and return its id. */
    const ensureThreadSession = (parentSessionId, threadId) => {
      const tsid = threadSessionId(parentSessionId, threadId);
      setSessions((prev) => {
        if (prev.has(tsid)) return prev;
        const next = new Map(prev);
        next.set(
          tsid,
          createDefaultSession(tsid, {
            parentSessionId,
            threadId,
          })
        );
        return next;
      });
      ensureSessionRefs(tsid);
      return tsid;
    };

    /**
     * Create a new thread anchored to a span of an AI message. Registers the
     * anchor + a synthetic session, then immediately streams the opening
     * turn. The caller typically also calls setActiveThread to open the
     * drawer on top of the new thread.
     */
    const createThread = async ({
      sessionId,
      turnIndex,
      aiMessageIndex = 0,
      contentSha256,
      quotedText,
      startOffset,
      endOffset,
      prompt,
      title = null,
      messageId = null,
      config = null,
    }) => {
      let createResp;
      try {
        createResp = await sendThreadCreateAPI({
          sessionId,
          turnIndex,
          aiMessageIndex,
          contentSha256,
          quotedText,
          startOffset,
          endOffset,
          prompt,
          title,
          messageId,
        });
      } catch (err) {
        console.error("Failed to create thread:", err);
        throw err;
      }

      const { thread_id: threadId, anchor } = createResp;
      const tsid = threadSessionId(sessionId, threadId);

      // Register the anchor on the parent, spawn the synthetic session, and
      // open the drawer on top of it — all in a single state update.
      setSessions((prev) => {
        const parent = prev.get(sessionId);
        if (!parent) return prev;
        const anchors = parent.threadAnchors ? new Map(parent.threadAnchors) : new Map();
        anchors.set(threadId, anchor);

        const next = new Map(prev);
        next.set(sessionId, {
          ...parent,
          threadAnchors: anchors,
          activeThreadId: threadId,
        });
        if (!next.has(tsid)) {
          next.set(
            tsid,
            createDefaultSession(tsid, {
              parentSessionId: sessionId,
              threadId,
            })
          );
        }
        return next;
      });
      ensureSessionRefs(tsid);
      initializedSessions.current.add(tsid);

      try {
        await sendThreadMessage({
          sessionId,
          threadId,
          prompt,
          config,
        });
      } catch (err) {
        updateSession(tsid, setSessions, {
          error: err.message || "Failed to send thread message",
          isStreaming: false,
        });
        throw err;
      }

      return { threadId, anchor, threadSessionId: tsid };
    };

    /**
     * Send a follow-up message in a thread. Writes into the synthetic
     * session's chatTurns exactly like the main sendMessage flow, then runs
     * the stream through the shared consumeSSEStream helper so we pick up
     * tool / reasoning / canvas chunks for free.
     */
    const sendThreadMessage = async ({ sessionId, threadId, prompt, config = null }) => {
      if (!prompt || !prompt.trim()) return;
      const tsid = ensureThreadSession(sessionId, threadId);

      // Append a fresh turn and mark the synthetic session streaming.
      cleanupSSE(tsid, sessionRefs, setSessions, flushBuffer);
      const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
      setSessions((prev) => {
        const session = prev.get(tsid);
        if (!session) return prev;
        const next = new Map(prev);
        next.set(tsid, {
          ...session,
          chatTurns: [
            ...session.chatTurns,
            { id: turnId, userMessage: prompt, aiMessage: [], attachments: [] },
          ],
          isStreaming: true,
          error: null,
        });
        return next;
      });

      let response;
      try {
        response = await sendThreadMessageAPI({ sessionId, threadId, prompt, config });
      } catch (err) {
        updateSession(tsid, setSessions, {
          isStreaming: false,
          error: err.message || "Failed to send thread message",
        });
        throw err;
      }

      const abortController = new AbortController();
      const refs = getSessionRefs(tsid, sessionRefs);
      refs._streamAbortController = abortController;

      try {
        await consumeSSEStream(response, tsid, false, {
          setSessions,
          sessionRefs,
          signal: abortController.signal,
        });
      } catch (err) {
        console.error("Thread stream error:", err);
        updateSession(tsid, setSessions, {
          isStreaming: false,
          error: err.message || "Thread stream failed",
        });
        throw err;
      } finally {
        updateSession(tsid, setSessions, { isStreaming: false });
      }
    };

    /**
     * Lazy-load a thread's message history into its synthetic session as
     * simple text chatTurns. Used when a user reopens a thread after page
     * reload.
     *
     * We deliberately render restored threads as simple `{type:"text"}` blocks
     * — the backend returns `[{role, content}]` which doesn't carry tool /
     * reasoning metadata. New turns streamed into the same session do pick
     * up the full chunk envelope via consumeSSEStream.
     */
    const fetchThread = async (sessionId, threadId) => {
      const tsid = ensureThreadSession(sessionId, threadId);
      try {
        const data = await fetchThreadAPI({ sessionId, threadId });
        const serverMessages = data.messages || [];
        const chatTurns = [];
        let current = null;
        for (const m of serverMessages) {
          if (m.role === "user") {
            if (current) {
              current.aiMessage.push({ end: true });
              chatTurns.push(current);
            }
            current = {
              id: `turn_${chatTurns.length}_${Date.now()}_restored`,
              userMessage: typeof m.content === "string" ? m.content : extractText(m.content),
              aiMessage: [],
              attachments: [],
            };
          } else if (m.role === "assistant" && current) {
            const text = typeof m.content === "string" ? m.content : extractText(m.content);
            if (text) current.aiMessage.push({ type: "text", content: text });
          }
        }
        if (current) {
          current.aiMessage.push({ end: true });
          chatTurns.push(current);
        }
        updateSession(tsid, setSessions, {
          chatTurns,
          isStreaming: false,
          error: null,
          restoredFromBackend: true,
        });
        initializedSessions.current.add(tsid);
        return data;
      } catch (err) {
        console.error(`Failed to fetch thread ${threadId}:`, err);
        updateSession(tsid, setSessions, {
          error: err.message || "Failed to load thread",
        });
        throw err;
      }
    };

    /**
     * Delete a thread. Cancels any in-flight stream, drops the synthetic
     * session + the anchor on the parent, and tells the backend to remove
     * the checkpoints.
     */
    const deleteThread = async (sessionId, threadId) => {
      const tsid = threadSessionId(sessionId, threadId);
      try {
        await deleteThreadAPI({ sessionId, threadId });
      } catch (err) {
        console.error(`Failed to delete thread ${threadId}:`, err);
        // Still drop local state — best-effort parity with server.
      }

      // Tear down the synthetic session's refs + subscription.
      const refs = sessionRefs.current.get(tsid);
      if (refs?._streamAbortController) refs._streamAbortController.abort();
      removeSession(tsid);

      setSessions((prev) => {
        const parent = prev.get(sessionId);
        if (!parent) return prev;
        const anchors = parent.threadAnchors ? new Map(parent.threadAnchors) : new Map();
        anchors.delete(threadId);
        const activeThreadId = parent.activeThreadId === threadId ? null : parent.activeThreadId;
        const next = new Map(prev);
        next.set(sessionId, { ...parent, threadAnchors: anchors, activeThreadId });
        return next;
      });
    };

    const setDraftThread = (sessionId, draft) => {
      setSessions((prev) => {
        const parent = prev.get(sessionId);
        if (!parent) return prev;
        const next = new Map(prev);
        next.set(sessionId, { ...parent, draftThread: draft });
        return next;
      });
    };

    const setActiveThread = (sessionId, threadId) => {
      if (threadId && threadId !== THREAD_DRAFT_ID && threadId !== THREAD_PENDING_ID) {
        ensureThreadSession(sessionId, threadId);
      }
      setSessions((prev) => {
        const parent = prev.get(sessionId);
        if (!parent) return prev;
        const next = new Map(prev);
        next.set(sessionId, { ...parent, activeThreadId: threadId });
        return next;
      });
    };

    const stopThreadStream = async (sessionId, threadId) => {
      try {
        await stopAPI(sessionId, threadId);
      } catch (err) {
        console.error("Failed to stop thread stream:", err);
      }
      const tsid = threadSessionId(sessionId, threadId);
      const refs = sessionRefs.current.get(tsid);
      refs?._streamAbortController?.abort();
      updateSession(tsid, setSessions, { isStreaming: false });
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

      // Threads
      createThread,
      sendThreadMessage,
      fetchThread,
      deleteThread,
      setDraftThread,
      setActiveThread,
      stopThreadStream,
    };
  }, []);
};
