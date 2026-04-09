import React, { useMemo, useCallback } from "react";
import { FileText, Pencil, Webhook, Code, Network, PaintBucket, Route } from "lucide-react";
import { useCanvas } from "./context/CanvasContext";
import { useTheme } from "../ThemeContext";
import "./CanvasToolIndicator.css";

/**
 * Compact clickable indicator rendered in the chat message flow for canvas tool calls.
 * Shows "Creating canvas: {title}" for create_canvas and "Working on canvas: {title}" for update_canvas.
 * Clicking opens the canvas panel at the associated snapshot.
 */
const CanvasToolIndicator = React.memo(({ toolName, input, toolCallId, isComplete, isError }) => {
  const { effectiveTheme } = useTheme();
  const { selectSnapshot, activeCanvasId, selectedSnapshotIndex, canvases } = useCanvas();

  const isCreate = toolName !== "update_canvas";
  const canvasId = input?.canvas_id;

  // Fix #6: Single pass over canvases to derive title, isActive, and the target canvas/snapshot.
  const { title, isActive, targetCanvasId, targetSnapIdx } = useMemo(() => {
    let foundTitle = "";
    let foundActive = false;
    let foundCid = null;
    let foundIdx = -1;

    for (const [cid, canvas] of canvases) {
      const snapIdx = canvas.snapshots.findIndex((s) => s.toolCallId === toolCallId);
      if (snapIdx !== -1) {
        foundTitle = canvas.title;
        foundCid = cid;
        foundIdx = snapIdx;
        // Determine active state
        if (cid === activeCanvasId) {
          if (selectedSnapshotIndex === snapIdx) foundActive = true;
          else if (selectedSnapshotIndex === null && snapIdx === canvas.snapshots.length - 1)
            foundActive = true;
        }
        break;
      }
    }

    // Fallback: check placeholder by toolCallId
    if (!foundTitle && toolCallId) {
      const placeholder = canvases.get(toolCallId);
      if (placeholder?.title) foundTitle = placeholder.title;
    }

    // Fallback: look up by canvas_id from tool input (for update_canvas).
    // The canvas may be stored under a streaming placeholder key, so also
    // search by the canvas's id property.
    if (!foundTitle && canvasId) {
      const byCanvasId = canvases.get(canvasId);
      if (byCanvasId?.title) {
        foundTitle = byCanvasId.title;
      } else {
        for (const [, canvas] of canvases) {
          if (canvas.id === canvasId && canvas.title) {
            foundTitle = canvas.title;
            break;
          }
        }
      }
    }

    return {
      title: foundTitle || input?.title || "",
      isActive: foundActive,
      targetCanvasId: foundCid,
      targetSnapIdx: foundIdx,
    };
  }, [canvases, toolCallId, canvasId, input?.title, activeCanvasId, selectedSnapshotIndex]);

  const label = useMemo(() => {
    if (isError) {
      if (isCreate) return title ? `Failed to create ${title}` : "Failed to create canvas";
      return title ? `Failed to update ${title}` : "Failed to update canvas";
    }
    if (isCreate) return title || "Creating canvas";
    return title ? `Worked on ${title}` : "Working on canvas";
  }, [isCreate, title, isError]);

  const CANVAS_CREATE_ICONS = {
    create_document: FileText,
    create_html_canvas: Webhook,
    create_code_canvas: Code,
    create_diagram: Network,
    create_svg: PaintBucket,
    create_mermaid: Route,
  };

  const Icon = isCreate ? CANVAS_CREATE_ICONS[toolName] || FileText : Pencil;

  const handleClick = useCallback(() => {
    if (targetCanvasId !== null && targetSnapIdx !== -1) {
      const canvas = canvases.get(targetCanvasId);
      const isLatest = canvas && targetSnapIdx === canvas.snapshots.length - 1;
      selectSnapshot(targetCanvasId, isLatest ? null : targetSnapIdx);
      return;
    }
    if (canvasId) {
      selectSnapshot(canvasId, null);
    }
  }, [targetCanvasId, targetSnapIdx, canvases, canvasId, selectSnapshot]);

  const shimmerClass =
    !isComplete && !isError ? (effectiveTheme === "light" ? "shimmer-light" : "shimmer-dark") : "";

  return (
    <div
      className={`canvas-tool-indicator ${effectiveTheme} ${isActive ? "active" : ""} ${isError ? "error" : ""}`}
      onClick={isError ? undefined : handleClick}
      role={isError ? undefined : "button"}
      tabIndex={isError ? -1 : 0}
      onKeyDown={
        isError
          ? undefined
          : (e) => {
              if (e.key === "Enter" || e.key === " ") handleClick();
            }
      }
      aria-label={label}
      style={isError ? { cursor: "default" } : undefined}
    >
      <Icon size={16} className="canvas-tool-indicator-icon" />
      <span className={`canvas-tool-indicator-text ${shimmerClass}`}>{label}</span>
    </div>
  );
});

export default CanvasToolIndicator;
