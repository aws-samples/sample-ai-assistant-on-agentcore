import React, { createContext, useState, useRef, useEffect, useMemo, useCallback } from "react";
import { checkForInterruptInChatTurns } from "./context/utils";
import { useChatSessionFunctions } from "./useChatSessionFunctions";

// Split contexts
export const ChatSessionFunctionsContext = createContext(null);
export const ChatSessionDataContext = createContext(null);

export const ChatSessionProvider = ({ children }) => {
  const [sessions, setSessions] = useState(new Map());
  const [loadingStates, setLoadingStates] = useState(new Map());

  // Refs for stable data
  const sessionsRef = useRef(new Map());
  const sessionRefs = useRef(new Map());
  const initializedSessions = useRef(new Set());
  const initializingPromises = useRef(new Map());

  // Wrap setSessions to keep sessionsRef always in sync.
  // This eliminates the race condition where sessionsRef lagged behind
  // state due to the previous useEffect-based sync.
  const setSessionsWithRef = useCallback((updater) => {
    setSessions((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      sessionsRef.current = next;
      return next;
    });
  }, []);

  // Create stable functions that don't depend on state directly
  const stableFunctions = useChatSessionFunctions({
    setSessions: setSessionsWithRef,
    setLoadingStates,
    sessionsRef,
    sessionRefs,
    initializedSessions,
    initializingPromises,
    checkForInterruptInChatTurns,
  });

  // Auto-flush on page unload/refresh
  useEffect(() => {
    const handleBeforeUnload = () => {
      stableFunctions.flushAllSessions();
    };

    const handleUnload = () => {
      stableFunctions.flushAllSessions();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("unload", handleUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("unload", handleUnload);
    };
  }, [stableFunctions]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      sessionRefs.current.forEach((refs) => {
        if (refs.eventSource) {
          refs.eventSource.close();
        }
        // Cancel any pending rAF callbacks
        if (refs.rafId !== null) {
          const cancelCallback =
            typeof cancelAnimationFrame !== "undefined" ? cancelAnimationFrame : clearTimeout;
          cancelCallback(refs.rafId);
        }
      });

      sessionRefs.current.clear();
      initializedSessions.current.clear();
      initializingPromises.current.clear();
    };
  }, []);

  // Combine functions with tools data
  const functionsValue = useMemo(
    () => ({
      ...stableFunctions,
      setSessions: setSessionsWithRef,
    }),
    [stableFunctions, setSessionsWithRef]
  );

  // Data value includes sessions and loading states
  const dataValue = useMemo(
    () => ({
      sessions,
      loadingStates,
    }),
    [sessions, loadingStates]
  );

  return (
    <ChatSessionFunctionsContext.Provider value={functionsValue}>
      <ChatSessionDataContext.Provider value={dataValue}>
        {children}
      </ChatSessionDataContext.Provider>
    </ChatSessionFunctionsContext.Provider>
  );
};
