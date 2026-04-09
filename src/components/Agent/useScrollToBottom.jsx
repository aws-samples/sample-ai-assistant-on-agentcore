import { useEffect, useState, useRef, useCallback } from "react";

/**
 * Configuration constants for scroll behavior
 */
const SCROLL_CONFIG = {
  SMOOTH_DURATION: 400, // Animation duration in ms
  MIN_DISTANCE_FOR_SMOOTH: 10, // Minimum pixels to trigger smooth scroll
  NEAR_BOTTOM_THRESHOLD: 5, // Pixels from bottom to consider "at bottom"
  BUTTON_SHOW_THRESHOLD: 20, // Distance from bottom to show button
};

/**
 * useScrollToBottom Hook
 *
 * Central hook that manages all scroll-related state and behavior for the chat interface.
 * Features:
 * - Auto-scroll to bottom on new messages
 * - Scroll-to-bottom button visibility management
 * - ResizeObserver for content size changes
 * - MutationObserver for DOM changes
 * - User scroll interruption detection
 *
 * @param {Object} options - Configuration options
 * @param {boolean} options.scrollOnMount - Whether to scroll to bottom on mount
 * @param {string} options.sessionId - Current session ID for state reset on session change
 */
export function useScrollToBottom(options = {}) {
  const { scrollOnMount = false, sessionId = null } = options;

  // State
  const [showButton, setShowButton] = useState(false);
  const [container, setContainer] = useState(null);
  const [isReady, setIsReady] = useState(!scrollOnMount);

  // Refs
  const resizeObserverRef = useRef(null);
  const mutationObserverRef = useRef(null);
  const lastScrollHeightRef = useRef(0);
  const isSmoothScrollingRef = useRef(false);
  const hasScrolledOnMountRef = useRef(false);
  const lastSessionIdRef = useRef(sessionId);

  // Callback ref - React calls this when the element mounts/unmounts
  const containerRef = useCallback(
    (node) => {
      setContainer(node);
      if (node !== null) {
        hasScrolledOnMountRef.current = false;
        if (scrollOnMount) {
          setIsReady(false);
        }
      }
    },
    [scrollOnMount]
  );

  /**
   * Check current scroll position and update button visibility
   */
  const checkScrollPosition = useCallback(() => {
    if (!container) return;

    const hasScroll = container.scrollHeight > container.clientHeight;
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    const shouldShow = hasScroll && distanceFromBottom > SCROLL_CONFIG.BUTTON_SHOW_THRESHOLD;

    setShowButton(shouldShow);
  }, [container]);

  /**
   * Main scroll function - scrolls container to bottom
   *
   * @param {boolean} smooth - Whether to use smooth scrolling animation
   */
  const scrollToBottom = useCallback(
    (smooth = false) => {
      if (!container) return;

      const targetPosition = container.scrollHeight - container.clientHeight;
      const distance = Math.abs(container.scrollTop - targetPosition);

      // Skip if already at bottom
      if (distance <= SCROLL_CONFIG.NEAR_BOTTOM_THRESHOLD) {
        return;
      }

      // Determine if we should use smooth scroll
      const shouldUseSmooth = smooth && distance >= SCROLL_CONFIG.MIN_DISTANCE_FOR_SMOOTH;

      if (shouldUseSmooth) {
        isSmoothScrollingRef.current = true;

        container.scrollTo({
          top: targetPosition,
          behavior: "smooth",
        });

        // Clear smooth scrolling flag after animation duration
        setTimeout(() => {
          isSmoothScrollingRef.current = false;
          checkScrollPosition();
        }, SCROLL_CONFIG.SMOOTH_DURATION);
      } else {
        container.scrollTop = targetPosition;
        checkScrollPosition();
      }
    },
    [container, checkScrollPosition]
  );

  /**
   * Immediate scroll to bottom (no animation)
   */
  const scrollToBottomImmediate = useCallback(() => {
    if (container) {
      container.scrollTop = container.scrollHeight;
      checkScrollPosition();
    }
  }, [container, checkScrollPosition]);

  /**
   * Perform initial scroll on mount and mark ready
   */
  const performInitialScroll = useCallback(() => {
    if (!container || hasScrolledOnMountRef.current) return;

    const hasScrollableContent = container.scrollHeight > container.clientHeight;

    if (hasScrollableContent) {
      hasScrolledOnMountRef.current = true;
      container.scrollTop = container.scrollHeight;
      setIsReady(true);
    }
  }, [container]);

  // Reset state when session changes and scroll to bottom
  useEffect(() => {
    if (sessionId !== lastSessionIdRef.current) {
      lastSessionIdRef.current = sessionId;
      hasScrolledOnMountRef.current = false;
      if (scrollOnMount) {
        setIsReady(false);
      }

      // Reset scroll position immediately to avoid showing old content scrolling
      // This prevents the artifact where old chat scrolls to bottom before new chat appears
      if (container) {
        container.scrollTop = 0;
      }
    }
  }, [sessionId, scrollOnMount, container]);

  // Main effect: scroll listener + MutationObserver + ResizeObserver
  useEffect(() => {
    if (!container) return;

    /**
     * Handle scroll events - detect user interruption during smooth scroll
     */
    const handleScroll = () => {
      if (isSmoothScrollingRef.current) {
        const targetPosition = container.scrollHeight - container.clientHeight;
        const distanceFromTarget = Math.abs(container.scrollTop - targetPosition);

        // User interrupted smooth scroll - cancel tracking
        if (distanceFromTarget > SCROLL_CONFIG.NEAR_BOTTOM_THRESHOLD) {
          isSmoothScrollingRef.current = false;
        }
      }
      checkScrollPosition();
    };

    container.addEventListener("scroll", handleScroll, { passive: true });

    // MutationObserver for DOM changes (new elements, text changes)
    mutationObserverRef.current = new MutationObserver(() => {
      requestAnimationFrame(() => {
        checkScrollPosition();
        if (scrollOnMount && !hasScrolledOnMountRef.current) {
          performInitialScroll();
        }
      });
    });

    mutationObserverRef.current.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    // ResizeObserver for content size changes
    resizeObserverRef.current = new ResizeObserver(() => {
      // Only trigger if scrollHeight actually changed
      if (container.scrollHeight !== lastScrollHeightRef.current) {
        lastScrollHeightRef.current = container.scrollHeight;
        requestAnimationFrame(checkScrollPosition);
      }
    });

    // Observe container for size changes
    resizeObserverRef.current.observe(container);

    // Also observe direct children for more granular size change detection
    Array.from(container.children).forEach((child) => {
      resizeObserverRef.current.observe(child);
    });

    // Initial setup using double RAF for layout stability
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        lastScrollHeightRef.current = container.scrollHeight;
        checkScrollPosition();
        if (scrollOnMount && !hasScrolledOnMountRef.current) {
          performInitialScroll();
        }
        // Mark ready even if no scrollable content (short chats)
        if (scrollOnMount && !hasScrolledOnMountRef.current) {
          hasScrolledOnMountRef.current = true;
          setIsReady(true);
        }
      });
    });

    return () => {
      container.removeEventListener("scroll", handleScroll);
      resizeObserverRef.current?.disconnect();
      mutationObserverRef.current?.disconnect();
    };
  }, [container, checkScrollPosition, scrollOnMount, performInitialScroll]);

  // Manual reset function (for edge cases)
  const resetForNewContent = useCallback(() => {
    hasScrolledOnMountRef.current = false;
    if (scrollOnMount) {
      setIsReady(false);
    }
  }, [scrollOnMount]);

  return {
    containerRef,
    showButton,
    scrollToBottom,
    scrollToBottomImmediate,
    setShowButton,
    checkScrollPosition,
    isReady,
    resetForNewContent,
  };
}
