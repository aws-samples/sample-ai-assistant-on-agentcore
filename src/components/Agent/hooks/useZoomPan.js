import { useState, useRef, useCallback, useEffect } from "react";

/**
 * Reusable zoom & pan behavior for SVG/Mermaid canvas previews.
 * Supports ctrl/cmd + scroll to zoom and click-drag to pan.
 */
export default function useZoomPan(resetDeps = []) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const wheelCleanupRef = useRef(null);

  // Reset zoom/pan when content or canvas changes
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetDeps);

  // Ref callback to attach a non-passive wheel listener for zoom
  const containerRef = useCallback((el) => {
    if (wheelCleanupRef.current) {
      wheelCleanupRef.current();
      wheelCleanupRef.current = null;
    }
    if (!el) return;
    const handler = (e) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        setZoom((z) => Math.min(5, Math.max(0.1, z - e.deltaY * 0.01)));
      }
    };
    el.addEventListener("wheel", handler, { passive: false });
    wheelCleanupRef.current = () => el.removeEventListener("wheel", handler);
  }, []);

  const handleMouseDown = useCallback(
    (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startPanX: pan.x,
        startPanY: pan.y,
      };
      const handleMove = (me) => {
        if (!dragRef.current) return;
        setPan({
          x: dragRef.current.startPanX + (me.clientX - dragRef.current.startX),
          y: dragRef.current.startPanY + (me.clientY - dragRef.current.startY),
        });
      };
      const handleUp = () => {
        dragRef.current = null;
        window.removeEventListener("mousemove", handleMove);
        window.removeEventListener("mouseup", handleUp);
      };
      window.addEventListener("mousemove", handleMove);
      window.addEventListener("mouseup", handleUp);
    },
    [pan]
  );

  const transformStyle = {
    transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
    transformOrigin: "center top",
    transition: dragRef.current ? "none" : "transform 0.1s ease",
    pointerEvents: "none",
  };

  return {
    zoom,
    pan,
    dragRef,
    containerRef,
    handleMouseDown,
    transformStyle,
    cursor: dragRef.current ? "grabbing" : "grab",
  };
}
