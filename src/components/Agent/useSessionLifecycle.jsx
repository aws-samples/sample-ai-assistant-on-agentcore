import { useState, useEffect, useRef, useContext } from "react";
import { ChatSessionFunctionsContext, ChatSessionDataContext } from "./ChatContext";
import { createSession as createSessionAPI } from "./context/api";
import { getSelectedModelId } from "./ModelSelector";

/**
 * Manages session initialization lifecycle:
 * - URL session → load from backend
 * - No URL session → create new session via API
 * - Handles prepareSession calls on session/model changes
 *
 * @param {string|undefined} urlSessionId - Session ID from URL params
 * @param {boolean} thinkingEnabled - Whether thinking is enabled
 * @param {string} budget - Current thinking budget level
 * @returns {{ sessionId, isLoading, activeSessionId, currentSession, chatTurns, isStreaming, error }}
 */
export function useSessionLifecycle(urlSessionId, thinkingEnabled, budget) {
  const functions = useContext(ChatSessionFunctionsContext);
  const data = useContext(ChatSessionDataContext);

  const [sessionId, setSessionId] = useState(urlSessionId || null);
  const [isPreparingSession, setIsPreparingSession] = useState(!urlSessionId);
  const sessionInitializedRef = useRef(false);
  const lastUrlSessionIdRef = useRef(urlSessionId);
  const preparedSessionIdRef = useRef(null);
  const pendingSessionIdRef = useRef(null);

  if (!urlSessionId && !pendingSessionIdRef.current) {
    pendingSessionIdRef.current = crypto.randomUUID();
  }

  useEffect(() => {
    const urlChanged = urlSessionId !== lastUrlSessionIdRef.current;
    lastUrlSessionIdRef.current = urlSessionId;

    const existingSession = data.sessions.get(urlSessionId);

    // Skip self-navigation (we just created this session)
    if (urlSessionId && urlSessionId === sessionId && existingSession?.chatTurns?.length > 0) {
      sessionInitializedRef.current = true;
      return;
    }

    // Session already loaded in memory — just refresh tools
    if (urlSessionId && existingSession?.chatTurns?.length > 0) {
      setSessionId(urlSessionId);
      sessionInitializedRef.current = true;
      preparedSessionIdRef.current = urlSessionId;
      const currentBudget = thinkingEnabled ? budget : 0;
      functions
        .prepareSession(urlSessionId, null, currentBudget, getSelectedModelId(), true)
        .catch((err) => console.error("Failed to refresh tools:", err));
      return;
    }

    if (sessionInitializedRef.current && !urlChanged) return;

    const initSession = async () => {
      if (urlSessionId) {
        setSessionId(urlSessionId);
        setIsPreparingSession(true);
        await functions.initializeSession(urlSessionId);

        if (preparedSessionIdRef.current !== urlSessionId) {
          preparedSessionIdRef.current = urlSessionId;
          try {
            await functions.prepareSession(
              urlSessionId,
              null,
              thinkingEnabled ? budget : 0,
              getSelectedModelId(),
              true
            );
          } catch (err) {
            console.error("Failed to refresh tools on session change:", err);
          }
        }
        sessionInitializedRef.current = true;
        setIsPreparingSession(false);
        return;
      }

      // New session
      const pendingId = pendingSessionIdRef.current;
      try {
        const response = await createSessionAPI(pendingId);
        const id = response.session_id || pendingId;
        setSessionId(id);
        functions.initializeSession(id, false, true);
        sessionInitializedRef.current = true;
      } catch (error) {
        console.error("[Session] Failed to create session:", error);
        setSessionId(pendingId);
        functions.initializeSession(pendingId, false, true);
        sessionInitializedRef.current = true;
      } finally {
        setIsPreparingSession(false);
      }
    };

    initSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlSessionId, functions, thinkingEnabled, budget]);

  const activeSessionId = urlSessionId || sessionId;
  const currentSession = data.sessions.get(activeSessionId);
  const { chatTurns = [], isStreaming = false, error = null } = currentSession || {};
  const isLoading = (urlSessionId && !currentSession) || (isPreparingSession && !currentSession);

  return { sessionId, isLoading, activeSessionId, currentSession, chatTurns, isStreaming, error };
}
