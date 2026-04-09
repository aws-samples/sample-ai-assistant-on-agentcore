import React from "react";
import { Loader2 } from "lucide-react";

/** Centered spinner + label shown while a canvas type is being generated. */
const StreamingPlaceholder = React.memo(({ label, style }) => (
  <div className="canvas-panel-streaming-placeholder" style={style}>
    <Loader2 size={24} className="canvas-panel-spinner" />
    <span>{label}</span>
  </div>
));

export default StreamingPlaceholder;
