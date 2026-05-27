import { useState, useCallback, useRef, useMemo, memo } from "react";
import {
  ClockFading,
  ToolCase,
  Globe,
  FileText,
  ChevronDown,
  ExternalLink,
  CircleCheck,
  Bot,
  PanelRightOpen,
} from "lucide-react";
import TextContent from "./TextContent";
import RetrievedImages from "./RetrievedImages";
import SubAgentDrawer from "./SubAgentDrawer";
import { useTheme } from "../ThemeContext";
import { buildTimelineSteps } from "./utils/timelineParser";
import { getToolCategory, isImageRetrievalTool, isSubAgentTool } from "./toolClassification";
import { parseWebResults } from "./utils/parseWebResults";
import "./UnifiedThinkingBlock.css";

const formatToolName = (toolName) => {
  if (!toolName) return "Tool";
  let name = toolName
    .replace(/^aws___/, "")
    .replace(/^remote_/, "")
    .replace(/^tavily_/, "");
  name = name
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
  return name;
};

const getToolIcon = (toolName) => {
  if (isSubAgentTool(toolName)) {
    return <Bot size={18} className="timeline-icon tool-icon" />;
  }
  const category = getToolCategory(toolName);
  switch (category) {
    case "web_search":
      return <Globe size={18} className="timeline-icon tool-icon" />;
    case "web_extract":
      return <FileText size={18} className="timeline-icon tool-icon" />;
    default:
      return <ToolCase size={18} className="timeline-icon tool-icon" />;
  }
};

/**
 * Coerce tool content (which may be an object, a JSON string, or a list of
 * content blocks) into a plain markdown string suitable for rendering.
 */
const coerceToolText = (content) => {
  if (content == null) return "";
  if (typeof content === "string") {
    // Tool messages from the backend often come as JSON-encoded strings;
    // unwrap a top-level string if that's the case so markdown renders cleanly.
    const trimmed = content.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (typeof parsed === "string") return parsed;
        if (Array.isArray(parsed)) {
          return parsed
            .map((b) => (typeof b === "string" ? b : (b?.text ?? "")))
            .filter(Boolean)
            .join("\n");
        }
        return JSON.stringify(parsed, null, 2);
      } catch {
        return content;
      }
    }
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((b) => (typeof b === "string" ? b : (b?.text ?? "")))
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    return JSON.stringify(content, null, 2);
  }
  return String(content);
};

const getSubAgentRequest = (input) => {
  if (!input) return "";
  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(input);
      return parsed?.request ?? "";
    } catch {
      return input;
    }
  }
  if (typeof input === "object") return input.request ?? "";
  return "";
};

/**
 * Merge consecutive thinking steps into single steps
 */
const mergeThinkingSteps = (steps) => {
  const merged = [];
  let currentThinkingGroup = null;

  steps.forEach((step) => {
    if (step.type === "thinking") {
      if (currentThinkingGroup) {
        // Add to existing thinking group
        currentThinkingGroup.segments.push(step.segment);
      } else {
        // Start new thinking group
        currentThinkingGroup = {
          id: step.id,
          type: "thinking",
          segments: [step.segment],
        };
      }
    } else {
      // Non-thinking step - flush current thinking group first
      if (currentThinkingGroup) {
        merged.push(currentThinkingGroup);
        currentThinkingGroup = null;
      }
      merged.push(step);
    }
  });

  // Flush any remaining thinking group
  if (currentThinkingGroup) {
    merged.push(currentThinkingGroup);
  }

  return merged;
};

const getResultCount = (content) => {
  if (!content) return 0;
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed.results && Array.isArray(parsed.results)) return parsed.results.length;
    return 1;
  } catch {
    return content ? 1 : 0;
  }
};

const formatRawContent = (content) => {
  if (!content) return "No content";
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return String(content);
  }
};

const SourceItem = ({ title, url, favicon, showExternalLink = true }) => (
  <a href={url} target="_blank" rel="noopener noreferrer" className="source-item">
    {favicon ? (
      <img
        src={favicon}
        alt=""
        className="source-favicon"
        onError={(e) => {
          e.target.style.display = "none";
        }}
      />
    ) : (
      <div className="source-favicon-placeholder" />
    )}
    <span className="source-title">{title}</span>
    {showExternalLink && <ExternalLink size={12} className="source-external-icon" />}
  </a>
);

const getToolDisplayText = (toolName, resultCount, isComplete, error) => {
  if (error) return "Failed";

  const category = getToolCategory(toolName);
  const formattedName = formatToolName(toolName);

  if (!isComplete) {
    switch (category) {
      case "web_search":
        return "Searching";
      case "web_extract":
        return "Reading";
      default:
        return `Running ${formattedName}`;
    }
  }

  switch (category) {
    case "web_search":
      return resultCount === 1 ? "1 result returned" : `${resultCount} results returned`;
    case "web_extract":
      return resultCount === 1 ? "Read from 1 source" : `Read from ${resultCount} sources`;
    default:
      return `${formattedName} completed`;
  }
};

const ToolResultIndicator = ({ toolName, content, isComplete, error }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const category = getToolCategory(toolName);
  const isWebSearch = category === "web_search";
  const isWebExtract = category === "web_extract";
  const isGeneric = category === "generic";
  const isImageRetrieval = isImageRetrievalTool(toolName);

  const webResults = useMemo(() => {
    if (isWebSearch || isWebExtract) {
      return parseWebResults(content).map((r, i) => ({
        ...r,
        id: i,
        title: r.title || r.url || `Result ${i + 1}`,
      }));
    }
    return [];
  }, [isWebSearch, isWebExtract, content]);

  const resultCount = useMemo(() => {
    if (isWebSearch || isWebExtract) return webResults.length || getResultCount(content);
    return getResultCount(content);
  }, [isWebSearch, isWebExtract, webResults, content]);

  // For image retrieval: extract image blocks for inline display (private images)
  const imageContent = useMemo(() => {
    if (!isComplete || error) return null;
    // Image retrieval tool (private images)
    if (isImageRetrieval) {
      if (Array.isArray(content) && content.some((b) => b.type === "image" && b.__private__)) {
        return content;
      }
      return null;
    }
    // Browser screenshots or any tool returning base64 image blocks
    if (
      Array.isArray(content) &&
      content.some((b) => b.type === "image" && b.source?.type === "base64")
    ) {
      return content;
    }
    return null;
  }, [isImageRetrieval, isComplete, error, content]);

  const rawContent = useMemo(() => {
    // For image retrieval: only show raw content on errors
    if (isImageRetrieval) {
      if (error && content) return formatRawContent(content);
      return null;
    }
    // Don't show raw content if we're rendering images inline
    if (Array.isArray(content) && content.some((b) => b.type === "image")) {
      return null;
    }
    if (isGeneric && content) return formatRawContent(content);
    return null;
  }, [isGeneric, isImageRetrieval, error, content]);

  const displayText = getToolDisplayText(toolName, resultCount, isComplete, error);

  const hasExpandableContent =
    isComplete &&
    !error &&
    ((isWebSearch && webResults.length > 0) ||
      (isWebExtract && webResults.length > 0) ||
      (isGeneric && !isImageRetrieval && rawContent));

  // For image retrieval errors, allow expanding to see the error detail
  const hasErrorContent = isImageRetrieval && error && rawContent;

  const handleToggle = (e) => {
    e.stopPropagation();
    if (hasExpandableContent || hasErrorContent) {
      setIsExpanded(!isExpanded);
    }
  };

  return (
    <div className="tool-result-content">
      <div
        className={`tool-result-header ${hasExpandableContent || hasErrorContent ? "clickable" : ""} ${!isComplete ? "loading" : ""}`}
        onClick={handleToggle}
      >
        <span className="tool-result-text">{displayText}</span>
        {(hasExpandableContent || hasErrorContent) && (
          <ChevronDown size={14} className={`tool-result-chevron ${isExpanded ? "rotated" : ""}`} />
        )}
      </div>

      {/* Inline private images for retrieve_images */}
      {imageContent && (
        <div className="tool-result-images" style={{ marginTop: "8px" }}>
          <RetrievedImages imageContent={imageContent} />
        </div>
      )}

      {(hasExpandableContent || hasErrorContent) && (
        <div className={`tool-result-expand ${isExpanded ? "expanded" : ""}`}>
          <div>
            {isWebSearch && webResults.length > 0 && (
              <div className="tool-result-sources">
                {webResults.map((item) => (
                  <SourceItem
                    key={item.id}
                    title={item.title}
                    url={item.url}
                    favicon={item.favicon}
                    showExternalLink={true}
                  />
                ))}
              </div>
            )}

            {isWebExtract && webResults.length > 0 && (
              <div className="tool-result-sources">
                {webResults.map((item) => (
                  <SourceItem
                    key={item.id}
                    title={item.title}
                    url={item.url}
                    favicon={item.favicon}
                    showExternalLink={true}
                  />
                ))}
              </div>
            )}

            {isGeneric && rawContent && (
              <div className="tool-result-raw">
                <div className="tool-result-raw-header">Response</div>
                <div className="tool-result-raw-scroll">
                  <pre className="tool-result-raw-content">{rawContent}</pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * ReasoningHeader - Shows current step as plain text with animation
 */
const ReasoningHeader = ({ currentStep, isComplete, isExpanded, onClick, theme }) => {
  const textClassName = !isComplete
    ? theme === "light"
      ? "text-reveal-light"
      : "text-reveal"
    : "";

  return (
    <div className={`unified-block-header ${theme}`} onClick={onClick}>
      <div className="unified-header-content">
        <span className={`unified-header-text ${textClassName}`}>{currentStep}</span>
        <button
          className={`unified-expand-button ${theme}`}
          aria-label={isExpanded ? "Collapse" : "Expand"}
        >
          <ChevronDown size={16} className={`unified-arrow-icon ${isExpanded ? "rotated" : ""}`} />
        </button>
      </div>
    </div>
  );
};

/**
 * CompletionStep - Final check mark step (icon only, no text)
 */
const CompletionStep = () => (
  <div className="timeline-item last completion-step">
    <div className="timeline-marker">
      <CircleCheck size={18} className="timeline-icon thinking-icon" />
    </div>
  </div>
);

/**
 * ThinkingStep - Renders merged thinking content
 */
const ThinkingStep = memo(({ segments, isLast }) => {
  return (
    <div className={`timeline-item ${isLast ? "last" : ""}`}>
      <div className="timeline-marker">
        <ClockFading size={18} className="timeline-icon thinking-icon" />
      </div>
      <div className="timeline-content">
        <div className="timeline-thinking-content">
          {segments.map((segment, index) => (
            <div key={index} className="thinking-segment">
              <TextContent content={segment?.content || ""} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * SubAgentStep - Renders a sub-agent invocation with an "Open" button that
 * pops a side drawer showing the request and the markdown response.
 */
const SubAgentStep = memo(({ step, isLast }) => {
  const [drawerOpen, setDrawerOpen] = useState(false);

  const request = useMemo(() => getSubAgentRequest(step.toolInput), [step.toolInput]);
  const response = useMemo(
    () => (step.isToolComplete && !step.toolError ? coerceToolText(step.toolContent) : ""),
    [step.toolContent, step.isToolComplete, step.toolError]
  );

  const displayText = step.toolError
    ? "Sub-agent failed"
    : !step.isToolComplete
      ? "Sub-agent thinking"
      : "Sub-agent completed";

  const canOpen = step.isToolComplete && !step.toolError && (request || response);

  return (
    <>
      <div className={`timeline-item ${isLast ? "last" : ""}`}>
        <div className="timeline-marker">
          <Bot size={18} className="timeline-icon tool-icon" />
        </div>
        <div className="timeline-content">
          <div className="tool-result-content">
            <div className={`tool-result-header ${!step.isToolComplete ? "loading" : ""}`}>
              <span className="tool-result-text">{displayText}</span>
              {canOpen && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDrawerOpen(true);
                  }}
                  className="sub-agent-open-button"
                  title="Open sub-agent transcript"
                >
                  <PanelRightOpen size={14} />
                  <span>Open</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <SubAgentDrawer
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        request={request}
        response={response}
      />
    </>
  );
});

/**
 * ToolStep - Renders a tool step, or a ReportToolCard for generate_report
 */
const ToolStep = memo(({ step, isLast }) => {
  if (isSubAgentTool(step.toolName)) {
    return <SubAgentStep step={step} isLast={isLast} />;
  }

  if (step.toolName === "generate_download_link" && step.isToolComplete) {
    return (
      <div className={`timeline-item ${isLast ? "last" : ""}`}>
        <div className="timeline-marker">{getToolIcon(step.toolName)}</div>
        <div className="timeline-content">
          <ToolResultIndicator
            toolName={step.toolName}
            content={step.toolContent}
            isComplete={step.isToolComplete}
            error={step.toolError}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`timeline-item ${isLast ? "last" : ""}`}>
      <div className="timeline-marker">{getToolIcon(step.toolName)}</div>
      <div className="timeline-content">
        <ToolResultIndicator
          toolName={step.toolName}
          content={step.toolContent}
          isComplete={step.isToolComplete}
          error={step.toolError}
        />
      </div>
    </div>
  );
});

const BrowserStep = ({ step }) => (
  <div className="timeline-item">
    <div className="timeline-marker">
      <Globe size={18} className="timeline-icon tool-icon" />
    </div>
    <div className="timeline-content">
      <ToolResultIndicator
        toolName="browser"
        content="Browser feed received"
        isComplete={true}
        error={false}
      />
    </div>
  </div>
);

const UnifiedThinkingBlock = ({ contentBlocks = [], isGroupComplete = false }) => {
  const { effectiveTheme } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const wrapperRef = useRef(null);

  // Create a stable key from contentBlocks to detect changes even when array is mutated
  // This ensures re-computation when content changes
  const contentKey = useMemo(() => {
    if (!contentBlocks || contentBlocks.length === 0) return "";
    return contentBlocks
      .map((seg) => `${seg.type}:${seg.content?.length || 0}:${seg.isComplete}`)
      .join("|");
  }, [contentBlocks]);

  // Build and merge timeline steps
  // Using contentKey as dependency to detect mutations
  const mergedSteps = useMemo(() => {
    const steps = buildTimelineSteps(contentBlocks);
    return mergeThinkingSteps(steps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentBlocks, contentKey]);

  // Compute current step text for header
  // Using contentKey as dependency to detect mutations
  const currentStepText = useMemo(() => {
    if (mergedSteps.length === 0) return "Reasoning";

    const lastStep = mergedSteps[mergedSteps.length - 1];

    // If group is complete, show completed state
    if (isGroupComplete) {
      if (lastStep.type === "thinking") {
        return "Reasoning";
      }
      if (isSubAgentTool(lastStep.toolName)) {
        return "Sub-agent completed";
      }
      const category = getToolCategory(lastStep.toolName);
      switch (category) {
        case "web_search":
          return "Search complete";
        case "web_extract":
          return "Read sources";
        default:
          return formatToolName(lastStep.toolName);
      }
    }

    // Not complete - show current activity based on last step
    if (lastStep.type === "thinking") {
      return "Reasoning";
    }

    if (isSubAgentTool(lastStep.toolName)) {
      return lastStep.isToolComplete ? "Sub-agent completed" : "Sub-agent thinking";
    }

    // Last step is a tool - show based on its completion state
    const category = getToolCategory(lastStep.toolName);

    if (!lastStep.isToolComplete) {
      // Tool is still executing
      switch (category) {
        case "web_search":
          return "Searching";
        case "web_extract":
          return "Reading";
        default:
          return `Running ${formatToolName(lastStep.toolName)}`;
      }
    } else {
      // Tool completed, waiting for next step
      switch (category) {
        case "web_search":
          return "Search complete";
        case "web_extract":
          return "Read sources";
        default:
          return `${formatToolName(lastStep.toolName)} complete`;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mergedSteps, isGroupComplete, contentKey]);

  const handleToggle = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  return (
    <div className={`unified-thinking-block ${effectiveTheme}`}>
      <ReasoningHeader
        currentStep={currentStepText}
        isComplete={isGroupComplete}
        isExpanded={isExpanded}
        onClick={handleToggle}
        theme={effectiveTheme}
      />

      <div className={`unified-content-container ${isExpanded ? "expanded" : "collapsed"}`}>
        <div ref={wrapperRef} className="unified-content-wrapper">
          <div className={`timeline ${isGroupComplete ? "timeline-complete" : ""}`}>
            <div className="timeline-line" />
            {mergedSteps.map((step, index) => {
              const isLast = !isGroupComplete && index === mergedSteps.length - 1;

              if (step.type === "thinking") {
                return <ThinkingStep key={step.id} segments={step.segments} isLast={isLast} />;
              }

              if (step.type === "browser_session") {
                return <BrowserStep key={step.id} step={step} />;
              }

              return <ToolStep key={step.id} step={step} isLast={isLast} />;
            })}
            {isGroupComplete && <CompletionStep />}
          </div>
        </div>
      </div>
    </div>
  );
};

export default UnifiedThinkingBlock;
