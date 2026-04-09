import React, { useCallback, useContext, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, MousePointer2 } from "lucide-react";
import VncViewer from "./VncViewer";
import { toast } from "sonner";
import { fetchLiveViewUrl, takeBrowserControl, releaseBrowserControl } from "./context/api";
import { ChatSessionDataContext } from "./ChatContext";
import "./BrowserSessionIndicator.css";

const MAX_REFRESH_RETRIES = 3;

// Small component rendered inside the sonner toast so loading state triggers re-renders
const ReleaseToastContent = ({ sessionId, lockIdRef, onStartLoading, onError }) => {
  const [loading, setLoading] = useState(false);

  const handleClick = async (e) => {
    e.stopPropagation();
    setLoading(true);
    onStartLoading();
    try {
      await releaseBrowserControl(sessionId, lockIdRef.current);
      // Stay loading until browser_control_resumed stream event
    } catch {
      setLoading(false);
      onError();
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        gap: "8px",
        fontSize: "13px",
      }}
    >
      <span>Release Browser Session</span>
      <button onClick={handleClick} className="browser-toast-release-btn" disabled={loading}>
        {loading ? <span className="browser-control-spinner" /> : "Release"}
      </button>
    </div>
  );
};

const BrowserSessionIndicator = ({
  liveEndpoint,
  browserSessionId,
  urlLifetime,
  viewport,
  status,
  sessionId,
}) => {
  const [disconnected, setDisconnected] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedSize, setExpandedSize] = useState(null);
  const [inputEnabled, setInputEnabled] = useState(false);
  const [lockId, setLockId] = useState(null);
  const lockIdRef = useRef(null);
  const [controlLoading, setControlLoading] = useState(false);
  const [liveUrl, setLiveUrl] = useState(liveEndpoint || null);
  const [urlLoading, setUrlLoading] = useState(false);
  const [urlError, setUrlError] = useState(null);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const streamSizeRef = useRef(null);
  const connRef = useRef(null);
  const refreshTimerRef = useRef(null);
  const retryTimerRef = useRef(null);
  const mountedRef = useRef(true);
  const toastIdRef = useRef(null);

  const isLegacyFlow = Boolean(liveEndpoint);
  const isActive = status === "active" && !disconnected;

  // Read browser control state from session context (set by stream chunk handler)
  const data = useContext(ChatSessionDataContext);
  const currentSession = data?.sessions?.get(sessionId);
  const browserControlStatus = currentSession?.browserControlStatus ?? null;
  const browserControlLockId = currentSession?.browserControlLockId ?? null;

  // Keep lockIdRef in sync so toast onClick always reads the current value
  useEffect(() => {
    lockIdRef.current = lockId;
  }, [lockId]);

  const handleDisconnect = useCallback(() => {
    setDisconnected(true);
    setExpanded(false);
  }, []);

  const [transitioning, setTransitioning] = useState(false);

  const handleExpand = useCallback(() => {
    setTransitioning(true);
    setExpanded(true);
    setTimeout(() => setTransitioning(false), 1800);
  }, []);

  const handleCollapse = useCallback(() => {
    setTransitioning(true);
    setExpanded(false);
    setTimeout(() => setTransitioning(false), 1800);
  }, []);

  const handleStreamSize = useCallback(({ width, height }) => {
    if (width > 0 && height > 0) {
      streamSizeRef.current = { width, height };
      // Snap expanded container to actual server resolution (removes black bars from 8px rounding)
      setExpandedSize((prev) => {
        if (!prev) return prev;
        const barH = 48;
        return { width, height: height + barH };
      });
    }
  }, []);

  const handleConnection = useCallback((conn) => {
    connRef.current = conn;
  }, []);

  const handleTakeControl = useCallback(async () => {
    setControlLoading(true);
    try {
      const data = await takeBrowserControl(sessionId);
      setLockId(data.lock_id);
      // Don't set inputEnabled yet — wait for browser_control_paused stream event
      // to confirm the tool has picked up the lock before switching the UI
    } catch {
      // API failed — clear loading, don't change state
      setControlLoading(false);
    }
  }, [sessionId]);

  const handleReleaseControl = useCallback(async () => {
    setControlLoading(true);
    try {
      await releaseBrowserControl(sessionId, lockIdRef.current);
    } catch (err) {
      console.error("[browser-control] release API failed:", err);
      setControlLoading(false);
    }
  }, [sessionId]);

  // Show the release toast with a solid button and inline loading spinner
  const showReleaseToast = useCallback(() => {
    const id = toastIdRef.current || `browser-control-${Date.now()}`;
    toastIdRef.current = id;
    toast(
      <ReleaseToastContent
        sessionId={sessionId}
        lockIdRef={lockIdRef}
        onStartLoading={() => setControlLoading(true)}
        onError={() => setControlLoading(false)}
      />,
      {
        id,
        duration: Infinity,
        closeButton: false,
        style: { width: "fit-content" },
      }
    );
  }, [sessionId]);

  // Show/dismiss persistent sonner toast based on inputEnabled + expanded
  useEffect(() => {
    if (inputEnabled && !expanded) {
      showReleaseToast();
    } else if (toastIdRef.current && !controlLoading) {
      toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, [inputEnabled, expanded, showReleaseToast, controlLoading]);

  // Restore control UI state on reconnect
  // If browserControlStatus is "paused" with a lock_id, the agent is waiting —
  // restore the UI so the user can release.
  useEffect(() => {
    if (browserControlStatus === "paused" && browserControlLockId && !lockId) {
      setLockId(browserControlLockId);
      setInputEnabled(true);
    }
  }, [browserControlStatus, browserControlLockId, lockId]);

  // Clear take-control loading state once the tool confirms the lock (paused event)
  // Only fires during take-control flow (inputEnabled is still false while waiting)
  useEffect(() => {
    if (browserControlStatus === "paused" && controlLoading && !inputEnabled) {
      setControlLoading(false);
      setInputEnabled(true);
    }
  }, [browserControlStatus, controlLoading, inputEnabled]);

  // When the tool resumes (user released or timeout), reset UI to default state
  useEffect(() => {
    if (browserControlStatus === "resumed") {
      setLockId(null);
      setInputEnabled(false);
      setControlLoading(false);
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    }
  }, [browserControlStatus]);

  // Reset local lock state when a new turn starts (browserControlStatus transitions to null)
  const prevBrowserControlStatusRef = useRef(browserControlStatus);
  useEffect(() => {
    const prev = prevBrowserControlStatusRef.current;
    prevBrowserControlStatusRef.current = browserControlStatus;
    // Only reset when status was previously set and is now cleared (new turn)
    if (browserControlStatus === null && prev !== null && lockId) {
      setLockId(null);
      setInputEnabled(false);
      setControlLoading(false);
      if (toastIdRef.current) {
        toast.dismiss(toastIdRef.current);
        toastIdRef.current = null;
      }
    }
  }, [browserControlStatus, lockId]);

  // Track mounted state for async cleanup
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Schedule a proactive refresh at 80% of URL lifetime
  const scheduleRefresh = useCallback(
    (lifetime) => {
      if (isLegacyFlow || !lifetime || lifetime <= 0) return;
      clearTimeout(refreshTimerRef.current);
      const delay = Math.floor(lifetime * 0.8 * 1000);
      refreshTimerRef.current = setTimeout(async () => {
        if (!mountedRef.current) return;
        let success = false;
        for (let attempt = 0; attempt < MAX_REFRESH_RETRIES; attempt++) {
          try {
            const data = await fetchLiveViewUrl(sessionId, browserSessionId);
            if (!mountedRef.current) return;
            setLiveUrl(data.live_view_url);
            setRefreshWarning(false);
            scheduleRefresh(data.url_lifetime);
            success = true;
            break;
          } catch {
            if (!mountedRef.current) return;
            if (attempt < MAX_REFRESH_RETRIES - 1) {
              const backoff = Math.pow(2, attempt + 1) * 1000;
              await new Promise((resolve) => {
                retryTimerRef.current = setTimeout(resolve, backoff);
              });
              if (!mountedRef.current) return;
            }
          }
        }
        if (!success && mountedRef.current) {
          setRefreshWarning(true);
        }
      }, delay);
    },
    [isLegacyFlow, sessionId, browserSessionId]
  );

  // Initial URL fetch for new flow (no liveEndpoint)
  useEffect(() => {
    if (isLegacyFlow || !browserSessionId) return;

    let cancelled = false;
    setUrlLoading(true);
    setUrlError(null);

    fetchLiveViewUrl(sessionId, browserSessionId)
      .then((data) => {
        if (cancelled || !mountedRef.current) return;
        setLiveUrl(data.live_view_url);
        setUrlLoading(false);
        scheduleRefresh(data.url_lifetime);
      })
      .catch((err) => {
        if (cancelled || !mountedRef.current) return;
        setUrlError(err.message || "Failed to load live view URL");
        setUrlLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isLegacyFlow, browserSessionId, sessionId, scheduleRefresh]);

  // Cleanup timers on unmount or session end
  useEffect(() => {
    return () => {
      clearTimeout(refreshTimerRef.current);
      clearTimeout(retryTimerRef.current);
    };
  }, []);

  // Compute expanded size — arbitrary values, server will match via requestResolution
  useEffect(() => {
    if (!expanded) {
      setExpandedSize(null);
      return;
    }
    const maxW = Math.min(window.innerWidth * 0.85, 1460);
    const maxH = Math.min(window.innerHeight * 0.87, 820);
    const barH = 48;
    // Round down to 8px multiples (DCV requirement) so the server doesn't shrink the container
    const w = Math.floor(maxW / 8) * 8;
    const h = Math.floor(maxH / 8) * 8;
    setExpandedSize({ width: w, height: h + barH });
  }, [expanded]);

  // Close on Escape
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e) => {
      if (e.key === "Escape") handleCollapse();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [expanded, handleCollapse]);

  if (!isActive) {
    return (
      <div className="browser-session-notification">
        <span className="browser-session-notification-dot" />
        <span>Browser session ended</span>
      </div>
    );
  }

  if (urlError) {
    return (
      <div className="browser-session-notification" role="alert">
        <span>{urlError}</span>
      </div>
    );
  }

  return (
    <>
      {/* VncViewer always lives here — never reparented */}
      <div
        className={`browser-live-container${expanded ? " browser-live-container--expanded" : ""}`}
        style={
          expanded && expandedSize
            ? { width: expandedSize.width, height: expandedSize.height }
            : undefined
        }
      >
        <VncViewer
          url={liveUrl}
          onDisconnect={handleDisconnect}
          onStreamSize={handleStreamSize}
          onConnection={handleConnection}
          hidden={transitioning}
          expanded={expanded}
        />

        {/* Block mouse/keyboard input unless explicitly enabled */}
        {!inputEnabled && <div className="browser-input-blocker" />}

        {/* Mask that covers the VNC during expand/collapse transition */}
        {transitioning && (
          <div className="browser-transition-mask">
            <div className="browser-transition-spinner" />
          </div>
        )}

        {/* Agent paused banner */}
        {browserControlStatus === "paused" && (
          <div className="browser-paused-banner" role="status">
            <span className="browser-paused-dot" />
            <span>Agent paused</span>
          </div>
        )}

        {/* Refresh warning */}
        {refreshWarning && (
          <div className="browser-refresh-warning" role="alert">
            Session may disconnect soon
          </div>
        )}

        {/* Inline badge — hidden when expanded */}
        {!expanded && (
          <div className="browser-live-badge">
            <div className="browser-live-timeline">
              <div className="browser-live-timeline-progress" />
            </div>
            <div className="browser-live-info">
              <span className="browser-live-dot" />
              <span>LIVE</span>
              <button
                className="browser-expand-btn"
                onClick={handleExpand}
                aria-label="Expand browser view"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Modal bar — shown when expanded, rendered inside the same container */}
        {expanded && (
          <div className="browser-modal-bar">
            <span className="browser-live-dot" />
            <span>LIVE</span>
            {inputEnabled ? (
              <button
                className="browser-input-btn browser-input-btn--release"
                onClick={handleReleaseControl}
                disabled={controlLoading}
                aria-label="Release browser control"
                title="Input enabled — click to release control"
              >
                {controlLoading ? (
                  <span className="browser-control-spinner" />
                ) : (
                  <MousePointer2 className="h-3.5 w-3.5" />
                )}
                <span>Release control</span>
              </button>
            ) : (
              <button
                className="browser-input-btn"
                onClick={handleTakeControl}
                disabled={controlLoading}
                aria-label="Take browser control"
                title="Click to take browser control"
              >
                {controlLoading ? (
                  <span className="browser-control-spinner" />
                ) : (
                  <MousePointer2 className="h-3.5 w-3.5" />
                )}
                <span>Take control</span>
              </button>
            )}
            <button
              className="browser-expand-btn"
              onClick={handleCollapse}
              aria-label="Collapse browser view"
            >
              <Minimize2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Overlay backdrop only — no children, just catches clicks */}
      {expanded && <div className="browser-modal-overlay" onClick={handleCollapse} />}
    </>
  );
};

export default BrowserSessionIndicator;
