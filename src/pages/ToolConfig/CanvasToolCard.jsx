/**
 * CanvasToolCard Component
 *
 * Displays all canvas creation tools as a single card with an expandable
 * dropdown for toggling individual canvas types, similar to MCPServerCard.
 * Enforces that at least one canvas tool remains enabled at all times.
 */

import React, { useState, useCallback } from "react";
import {
  Paintbrush,
  ChevronDown,
  ChevronUp,
  FileText,
  Webhook,
  Code,
  Network,
  PaintBucket,
  Route,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

/**
 * IDs of canvas creation tools (mirrors backend CANVAS_CREATION_TOOL_IDS).
 */
const CANVAS_CREATION_TOOL_IDS = [
  "create_document",
  "create_html_canvas",
  "create_code_canvas",
  "create_diagram",
  "create_svg",
  "create_mermaid",
];

/** Per-tool icons for the dropdown list. */
const CANVAS_TOOL_ICONS = {
  create_document: FileText,
  create_html_canvas: Webhook,
  create_code_canvas: Code,
  create_diagram: Network,
  create_svg: PaintBucket,
  create_mermaid: Route,
};

/**
 * @param {Object} props
 * @param {Object} props.registry - Full tool registry (to get names/descriptions)
 * @param {Object} props.localTools - The user's local_tools config object
 * @param {Function} props.onToggleTool - Callback(toolId, enabled) when a tool is toggled
 * @param {boolean} props.disabled - Whether interactions are disabled
 */
function CanvasToolCard({ registry, localTools, onToggleTool, disabled = false }) {
  const [expanded, setExpanded] = useState(false);

  // Build list of canvas tools that exist in the registry
  const canvasTools = CANVAS_CREATION_TOOL_IDS.filter((id) => registry?.[id]);

  const isToolEnabled = (toolId) => {
    const entry = localTools?.[toolId];
    if (!entry) return registry?.[toolId]?.enabled_by_default ?? true;
    return entry.enabled !== false;
  };

  const enabledCount = canvasTools.filter(isToolEnabled).length;
  const totalCount = canvasTools.length;

  /**
   * Handle individual tool toggle.
   * Prevents disabling the last enabled canvas tool.
   */
  const handleToggle = useCallback(
    (toolId, checked) => {
      if (!checked && enabledCount <= 1) {
        // Can't disable the last one
        return;
      }
      onToggleTool(toolId, checked);
    },
    [onToggleTool, enabledCount]
  );

  if (canvasTools.length === 0) return null;

  return (
    <Card className="canvas-tool-card">
      <CardHeader className="pb-3 !block">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className="canvas-icon">
              <Paintbrush className="h-5 w-5" />
            </div>
            <div className="flex-1 min-w-0">
              <CardTitle className="text-base">Canvas Tools</CardTitle>
              <CardDescription className="mt-1">
                Create rich canvases for documents, code, diagrams, and interactive content.
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        {/* Expandable tools header */}
        <button className="canvas-tools-header" onClick={() => setExpanded(!expanded)}>
          <span className="canvas-tools-count">
            {enabledCount}/{totalCount} tools enabled
          </span>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>

        {/* Individual tool toggles */}
        {expanded && (
          <div className="canvas-tools-list">
            {canvasTools.map((toolId) => {
              const def = registry[toolId];
              const enabled = isToolEnabled(toolId);
              const isLastEnabled = enabled && enabledCount <= 1;
              const Icon = CANVAS_TOOL_ICONS[toolId];
              return (
                <div key={toolId} className="canvas-tool-item">
                  <div className="canvas-tool-info">
                    {Icon && <Icon className="h-4 w-4 canvas-tool-icon" />}
                    <span className="canvas-tool-name">{def.name}</span>
                  </div>
                  <Switch
                    checked={enabled}
                    onCheckedChange={(checked) => handleToggle(toolId, checked)}
                    disabled={disabled || isLastEnabled}
                    size="sm"
                    title={isLastEnabled ? "At least one canvas tool must be enabled" : undefined}
                  />
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      <style jsx>{`
        .canvas-tool-card {
          transition: box-shadow 0.2s ease;
        }
        .canvas-tool-card:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }
        .canvas-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 36px;
          height: 36px;
          border-radius: 8px;
          background-color: var(--color-primary);
          color: var(--color-primary-foreground);
          flex-shrink: 0;
        }
        .canvas-tools-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 0.5rem 0;
          border: none;
          background: none;
          cursor: pointer;
          color: var(--color-muted-foreground);
          font-size: 0.75rem;
          border-top: 1px solid var(--color-border);
        }
        .canvas-tools-count {
          font-weight: 500;
        }
        .canvas-tools-list {
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          padding-top: 0.5rem;
        }
        .canvas-tool-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem;
          border-radius: 6px;
          background-color: var(--color-muted);
        }
        .canvas-tool-info {
          flex: 1;
          min-width: 0;
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }
        .canvas-tool-icon {
          flex-shrink: 0;
          color: var(--color-muted-foreground);
        }
        .canvas-tool-name {
          font-size: 0.875rem;
          font-weight: 500;
          color: var(--color-foreground);
        }
      `}</style>
    </Card>
  );
}

export default CanvasToolCard;
