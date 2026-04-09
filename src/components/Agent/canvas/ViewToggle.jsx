import React from "react";
import { Code, Eye } from "lucide-react";

/** Preview / Code toggle shared across all visual canvas types. */
const ViewToggle = React.memo(
  ({ viewMode, setViewMode, previewLabel = "Preview", codeLabel = "Code" }) => (
    <div className="canvas-panel-view-toggle">
      <button
        className={`canvas-panel-toggle-btn ${viewMode === "preview" ? "active" : ""}`}
        onClick={() => setViewMode("preview")}
        aria-label={previewLabel}
        title="Preview"
      >
        <Eye size={14} />
      </button>
      <button
        className={`canvas-panel-toggle-btn ${viewMode === "code" ? "active" : ""}`}
        onClick={() => setViewMode("code")}
        aria-label={codeLabel}
        title="Code"
      >
        <Code size={14} />
      </button>
    </div>
  )
);

export default ViewToggle;
