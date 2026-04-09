import { useRef, useCallback, useEffect } from "react";
import { saveCanvasContent } from "../context/api";

/**
 * Manages debounced auto-saving of canvas edits.
 * Returns a handleContentChange callback that debounces saves by 1 second,
 * and flushes any pending save on unmount.
 */
export default function useCanvasAutoSave({
  sessionId,
  canvasId,
  canvasTitle,
  canvasType,
  userEditCanvas,
  isEditable,
  canvasIsStreaming,
  selectedSnapshotIndex,
  latestContent,
}) {
  const saveTimerRef = useRef(null);
  const userEditingRef = useRef(false);
  const programmaticUpdateRef = useRef(false);
  const pendingSaveRef = useRef(null);

  const handleContentChange = useCallback(
    (newContent) => {
      // Only persist actual user edits, not streaming or programmatic updates
      if (canvasIsStreaming) return;
      if (programmaticUpdateRef.current) return;
      if (selectedSnapshotIndex !== null) return;
      userEditingRef.current = true;

      userEditCanvas(canvasId, newContent);
      pendingSaveRef.current = {
        sessionId,
        canvasId,
        content: newContent,
        title: canvasTitle,
        type: canvasType,
      };
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        userEditingRef.current = false;
        pendingSaveRef.current = null;
        try {
          await saveCanvasContent(sessionId, canvasId, newContent, canvasTitle, canvasType);
        } catch (err) {
          console.error("Failed to save canvas content:", err);
        }
      }, 1000);
    },
    [
      canvasId,
      canvasTitle,
      canvasType,
      sessionId,
      userEditCanvas,
      selectedSnapshotIndex,
      latestContent,
      canvasIsStreaming,
    ]
  );

  // Flush pending save on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (pendingSaveRef.current) {
        const { sessionId: sid, canvasId: cid, content, title, type } = pendingSaveRef.current;
        pendingSaveRef.current = null;
        saveCanvasContent(sid, cid, content, title, type).catch((err) =>
          console.error("Failed to flush canvas save on unmount:", err)
        );
      }
    };
  }, []);

  return { handleContentChange, userEditingRef, programmaticUpdateRef };
}
