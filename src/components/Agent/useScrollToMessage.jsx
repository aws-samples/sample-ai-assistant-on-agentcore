import { useState, useEffect, useRef, useCallback } from "react";

/**
 * useScrollToMessage Hook
 *
 * Encapsulates all hash-based scroll-to-message logic that was previously
 * spread across 4 separate useEffects in AgentInterface.
 *
 * Handles:
 * - Reading #msg-N from URL hash
 * - Scrolling to the target message element
 * - Highlighting the message temporarily
 * - Clearing the hash after scroll
 * - Clearing hash on manual user scroll
 *
 * @param {Object} containerRef - Ref to the scrollable chat container
 * @param {Array} chatTurns - Current chat turns
 * @param {string} sessionId - Current session ID
 * @param {boolean} isLoading - Whether session is still loading
 * @returns {{ highlightedMessageIndex: number|null, hasMessageHash: () => boolean }}
 */
export function useScrollToMessage(containerRef, chatTurns, sessionId, isLoading) {
  const [highlightedMessageIndex, setHighlightedMessageIndex] = useState(null);
  const [hashChangeCounter, setHashChangeCounter] = useState(0);
  const processedHashRef = useRef(null);

  const getMessageIndexFromHash = useCallback(() => {
    const hash = window.location.hash;
    if (hash && hash.startsWith("#msg-")) {
      const index = parseInt(hash.substring(5), 10);
      return isNaN(index) ? null : index;
    }
    return null;
  }, []);

  const hasMessageHash = useCallback(() => window.location.hash.startsWith("#msg-"), []);

  const clearMessageHash = useCallback(() => {
    if (window.location.hash.startsWith("#msg-")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, []);

  // Listen for hash changes and custom scrollToMessage events
  useEffect(() => {
    const handleHashChange = () => {
      if (window.location.hash.startsWith("#msg-")) setHashChangeCounter((c) => c + 1);
    };
    const handleScrollToMessage = (event) => {
      if (event.detail?.messageIndex != null) setHashChangeCounter((c) => c + 1);
    };
    window.addEventListener("hashchange", handleHashChange);
    window.addEventListener("scrollToMessage", handleScrollToMessage);
    return () => {
      window.removeEventListener("hashchange", handleHashChange);
      window.removeEventListener("scrollToMessage", handleScrollToMessage);
    };
  }, []);

  // Scroll to the target message when hash is present and data is ready
  useEffect(() => {
    const messageIndex = getMessageIndexFromHash();
    if (messageIndex === null) return;

    const hashKey = `${sessionId}-${messageIndex}-${window.location.hash}-${hashChangeCounter}`;
    if (processedHashRef.current === hashKey) return;
    if (chatTurns.length === 0 || isLoading) return;

    processedHashRef.current = hashKey;
    setHighlightedMessageIndex(messageIndex);

    const scrollTimer = setTimeout(() => {
      const el = document.querySelector(`[data-message-index="${messageIndex}"]`);
      const container = containerRef.current;
      if (el && container) {
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const top =
          container.scrollTop + (eRect.top - cRect.top) - cRect.height / 2 + eRect.height / 2;
        container.scrollTo({ top: Math.max(0, top), behavior: "smooth" });
      }
      clearMessageHash();
    }, 100);

    const highlightTimer = setTimeout(() => setHighlightedMessageIndex(null), 1500);
    return () => {
      clearTimeout(scrollTimer);
      clearTimeout(highlightTimer);
    };
  }, [
    chatTurns.length,
    isLoading,
    sessionId,
    getMessageIndexFromHash,
    clearMessageHash,
    hashChangeCounter,
    containerRef,
  ]);

  // Clear hash on manual scroll (when not actively highlighting)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timeout;
    const handleScroll = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        if (hasMessageHash() && !highlightedMessageIndex) clearMessageHash();
      }, 500);
    };
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      clearTimeout(timeout);
    };
  }, [hasMessageHash, clearMessageHash, highlightedMessageIndex, containerRef]);

  return { highlightedMessageIndex, hasMessageHash, clearMessageHash };
}
