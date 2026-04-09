import { useRef, useContext, useCallback, useEffect } from "react";
import { ChatSessionFunctionsContext } from "./ChatContext";

const MAX_CONCURRENT = 3;

/**
 * Returns a ref-callback getter that lazy-loads session data when a chat item
 * scrolls into view. Uses IntersectionObserver with a concurrency cap of 3.
 *
 * Usage:
 *   const getLazyRef = usePrefetchSessions();
 *   <div ref={getLazyRef(sessionId)} />
 */
export function usePrefetchSessions() {
  const functions = useContext(ChatSessionFunctionsContext);
  const functionsRef = useRef(functions);
  functionsRef.current = functions;

  const observerRef = useRef(null);
  const elementMapRef = useRef(new Map()); // DOM element → sessionId
  const fetchedRef = useRef(new Set());
  const activeRef = useRef(0);
  const queueRef = useRef([]);
  const callbacksRef = useRef(new Map()); // sessionId → stable callback ref

  const processQueue = useCallback(() => {
    while (queueRef.current.length > 0 && activeRef.current < MAX_CONCURRENT) {
      const sessionId = queueRef.current.shift();
      if (fetchedRef.current.has(sessionId)) continue;

      fetchedRef.current.add(sessionId);
      activeRef.current++;

      functionsRef.current
        .initializeSession(sessionId)
        .catch(() => {
          // Allow retry on failure
          fetchedRef.current.delete(sessionId);
        })
        .finally(() => {
          activeRef.current--;
          processQueue();
        });
    }
  }, []);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        let added = false;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const sessionId = elementMapRef.current.get(entry.target);
          if (!sessionId || fetchedRef.current.has(sessionId)) continue;
          if (!queueRef.current.includes(sessionId)) {
            queueRef.current.push(sessionId);
            added = true;
          }
          observer.unobserve(entry.target);
        }
        if (added) processQueue();
      },
      { rootMargin: "200px" }
    );
    observerRef.current = observer;
    return () => observer.disconnect();
  }, [processQueue]);

  const getRef = useCallback((sessionId) => {
    if (!callbacksRef.current.has(sessionId)) {
      callbacksRef.current.set(sessionId, (el) => {
        const observer = observerRef.current;
        if (!observer) return;

        // Cleanup previous element for this sessionId
        for (const [prevEl, id] of elementMapRef.current) {
          if (id === sessionId) {
            observer.unobserve(prevEl);
            elementMapRef.current.delete(prevEl);
            break;
          }
        }

        if (el) {
          if (fetchedRef.current.has(sessionId)) return;
          elementMapRef.current.set(el, sessionId);
          observer.observe(el);
        }
      });
    }
    return callbacksRef.current.get(sessionId);
  }, []);

  return getRef;
}
