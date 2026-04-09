import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import "./VncViewer.css";

const DCV_SDK_URL = "/dcvjs/dcv.js";
const DCV_BASE_URL = `${window.location.origin}/dcvjs/`;
const DCV_DIV_ID = "dcv-display";

// Keep a single persistent display element. If it gets detached from the DOM
// (e.g. by React StrictMode unmount), we re-append it to body as a fallback
// so DCV's async getElementById always finds it.
let persistentDisplayEl = null;
function ensureDisplayEl() {
  if (!persistentDisplayEl) {
    persistentDisplayEl = document.getElementById(DCV_DIV_ID);
  }
  if (!persistentDisplayEl) {
    persistentDisplayEl = document.createElement("div");
    persistentDisplayEl.id = DCV_DIV_ID;
  }
  // If detached, park it on body so getElementById always works
  if (!persistentDisplayEl.isConnected) {
    document.body.appendChild(persistentDisplayEl);
  }
  return persistentDisplayEl;
}

// Move the display element into a container (from body into the React tree)
function adoptDisplayEl(container) {
  const el = ensureDisplayEl();
  if (el.parentNode !== container) {
    // Reset any body-level positioning styles
    el.style.position = "";
    el.style.left = "";
    el.style.top = "";
    el.style.width = "";
    el.style.height = "";
    el.style.zIndex = "";
    el.style.pointerEvents = "";
    el.style.overflow = "";
    container.appendChild(el);
  }
}

let active = { conn: null, connecting: false, attempt: 0, authedUrl: null };

function disconnectActive(clearAuth) {
  if (active.conn) {
    try {
      active.conn.disconnect();
    } catch {}
  }
  active.conn = null;
  active.connecting = false;
  if (clearAuth) active.authedUrl = null;
}

export default function VncViewer({
  url: presignedUrl,
  onDisconnect,
  onStreamSize,
  onConnection,
  hidden,
  expanded,
}) {
  const [sdkReady, setSdkReady] = useState(!!window.dcv);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [canvasReady, setCanvasReady] = useState(false);

  const outerRef = useRef(null);
  const mountedRef = useRef(true);

  const searchParams = useMemo(() => {
    if (!presignedUrl) return new URLSearchParams();
    try {
      return new URL(presignedUrl).searchParams;
    } catch {
      return new URLSearchParams();
    }
  }, [presignedUrl]);

  const httpExtraSearchParamsCb = useCallback(
    (_method, _url, _body) => searchParams,
    [searchParams]
  );

  // Adopt the display element into our container, and watch for React
  // removing it (StrictMode unmount). If removed, re-park on body.
  useEffect(() => {
    const container = outerRef.current;
    if (!container) return;

    adoptDisplayEl(container);

    // Watch for the display element being removed from our container
    // (happens during React StrictMode unmount/remount cycles).
    // If removed, immediately re-append to body so DCV can still find it.
    const observer = new MutationObserver(() => {
      if (persistentDisplayEl && !persistentDisplayEl.isConnected) {
        document.body.appendChild(persistentDisplayEl);
      }
    });
    observer.observe(container, { childList: true });

    return () => {
      observer.disconnect();
      // Don't remove the display element — let it stay wherever it is
      // so DCV's in-flight messages can still find it
    };
  }, []);

  // Load SDK
  useEffect(() => {
    mountedRef.current = true;
    if (window.dcv) {
      setSdkReady(true);
      return () => {
        mountedRef.current = false;
      };
    }
    const existing = document.querySelector(`script[src="${DCV_SDK_URL}"]`);
    if (existing) {
      existing.addEventListener("load", () => mountedRef.current && setSdkReady(true));
      existing.addEventListener(
        "error",
        () => mountedRef.current && setError("Failed to load DCV SDK")
      );
      return () => {
        mountedRef.current = false;
      };
    }
    const s = document.createElement("script");
    s.src = DCV_SDK_URL;
    s.async = true;
    s.onload = () => mountedRef.current && setSdkReady(true);
    s.onerror = () => mountedRef.current && setError("Failed to load DCV SDK");
    document.head.appendChild(s);
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Connect
  useEffect(() => {
    if (!sdkReady || !presignedUrl) return;
    const dcv = window.dcv;
    if (!dcv) return;

    mountedRef.current = true;
    setError(null);
    setLoading(true);
    setCanvasReady(false);

    if (active.connecting) return;
    // Prevent StrictMode double-fire from re-authenticating with the same
    // presigned URL — the server rejects reused URLs, causing "Auth failed"
    if (active.authedUrl === presignedUrl) return;
    // If URL changed, clear the old auth marker
    if (active.authedUrl && active.authedUrl !== presignedUrl) {
      active.authedUrl = null;
    }
    active.connecting = true;
    active.attempt += 1;
    const myAttempt = active.attempt;
    const isStale = () => myAttempt !== active.attempt;

    disconnectActive(false);
    onConnection?.(null);

    // Ensure display element is in the DOM (either in container or on body)
    const container = outerRef.current;
    if (container) {
      adoptDisplayEl(container);
    } else {
      ensureDisplayEl();
    }

    const parsed = new URL(presignedUrl);
    const serverUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;

    dcv.setLogLevel(dcv.LogLevel.ERROR);

    const timeoutId = setTimeout(() => {
      if (!mountedRef.current || isStale()) return;
      active.connecting = false;
      setError("Timed out while connecting");
      setLoading(false);
    }, 25000);

    dcv.authenticate(presignedUrl, {
      promptCredentials: () => {},
      httpExtraSearchParams: httpExtraSearchParamsCb,
      error: (_a, err) => {
        // DCV's auth WebSocket fires onerror in Chrome even when auth
        // succeeds (the WS close race triggers it). Ignore auth errors
        // and rely on the 25s timeout to catch real failures.
        // The success callback will still fire if auth actually worked.
        console.debug("[VncViewer] auth error (ignored):", err?.message);
      },
      success: (_a, result) => {
        if (!mountedRef.current || isStale()) {
          clearTimeout(timeoutId);
          active.connecting = false;
          return;
        }

        const { sessionId, authToken } = result[0];
        active.authedUrl = presignedUrl;

        // Re-ensure the element is in the DOM right before connect
        // (StrictMode may have unmounted our container between auth and now)
        ensureDisplayEl();

        dcv
          .connect({
            url: serverUrl,
            sessionId,
            authToken,
            divId: DCV_DIV_ID,
            baseUrl: DCV_BASE_URL,
            resourceBaseUrl: DCV_BASE_URL,
            enabledChannels: ["display", "input"],
            observers: {
              httpExtraSearchParams: httpExtraSearchParamsCb,

              displayLayout: (serverWidth, serverHeight, heads) => {
                if (!mountedRef.current || isStale()) return;
                onStreamSize?.({ width: serverWidth, height: serverHeight, heads });
              },

              firstFrame: () => {
                if (!mountedRef.current || isStale()) return;
                clearTimeout(timeoutId);
                active.connecting = false;
                // Re-adopt into container if it exists now
                const c = outerRef.current;
                if (c) adoptDisplayEl(c);
                setTimeout(() => {
                  if (!mountedRef.current || isStale()) return;
                  setLoading(false);
                  setCanvasReady(true);
                }, 1800);
              },

              disconnect: (reason) => {
                clearTimeout(timeoutId);
                if (isStale()) return;
                active.conn = null;
                active.connecting = false;
                onConnection?.(null);
                if (!mountedRef.current) return;
                setError(reason?.message || "Session disconnected");
                onDisconnect?.();
              },
            },
          })
          .then((conn) => {
            if (!mountedRef.current || isStale()) {
              try {
                conn.disconnect();
              } catch {}
              return;
            }
            active.conn = conn;
            active.connecting = false;
            try {
              conn.enableHighPixelDensity(false);
            } catch {}

            requestAnimationFrame(() =>
              setTimeout(() => {
                const c = outerRef.current;
                if (c && conn.requestResolution) {
                  const w = expanded ? Math.round(c.offsetWidth) : 800;
                  const h = expanded ? Math.round(c.offsetHeight) : 600;
                  try {
                    conn.requestResolution(w, h);
                  } catch {}
                }
              }, 200)
            );

            onConnection?.(conn);
          })
          .catch((err) => {
            clearTimeout(timeoutId);
            if (!mountedRef.current || isStale()) return;
            active.connecting = false;
            setError(`Connect failed: ${err?.message || err}`);
            setLoading(false);
          });
      },
    });

    return () => {
      clearTimeout(timeoutId);
      mountedRef.current = false;
      // Don't clear authedUrl here — StrictMode will re-run the effect
      // with the same URL and we need to skip re-auth
      disconnectActive(false);
      onConnection?.(null);
    };
  }, [sdkReady, presignedUrl, httpExtraSearchParamsCb, onDisconnect, onStreamSize, onConnection]);

  // Resize DCV display to match container
  useEffect(() => {
    const container = outerRef.current;
    if (!container) return;

    let debounceTimer = null;
    let lastW = 0;
    let lastH = 0;
    let cooldownUntil = 0;

    function requestResize() {
      const conn = active.conn;
      if (!conn?.requestResolution) return;
      if (Date.now() < cooldownUntil) return;
      const w = expanded ? Math.round(container.offsetWidth) : 800;
      const h = expanded ? Math.round(container.offsetHeight) : 600;
      if (w < 100 || h < 100) return;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      try {
        conn.requestResolution(w, h);
        cooldownUntil = Date.now() + 1000;
      } catch {}
    }

    const ro = new ResizeObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(requestResize, 500);
    });
    ro.observe(container);
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(requestResize, 500);

    return () => {
      ro.disconnect();
      clearTimeout(debounceTimer);
    };
  }, [expanded]);

  return (
    <div
      className={`vnc-viewer-outer${canvasReady && !hidden ? " vnc-viewer-outer--ready" : ""}`}
      ref={outerRef}
    >
      {error ? (
        <div className="vnc-viewer-error" role="alert">
          {error}
        </div>
      ) : (
        <div className={`vnc-viewer-loading${loading ? "" : " vnc-viewer-loading--hidden"}`}>
          <div className="vnc-viewer-spinner" />
          <span>Connecting to live session…</span>
        </div>
      )}
    </div>
  );
}
