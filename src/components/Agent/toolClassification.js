/**
 * Single source of truth for tool name classifications.
 * Used by ChatMessage, ContentResolver, and UnifiedThinkingBlock.
 */

// Web search tool names
export const WEB_SEARCH_TOOLS = [
  "tavily_search",
  "web_search",
  "search_web",
  "tavily-search",
  "remote_web_search",
];

// Web extract tool names (reading from sources)
export const WEB_EXTRACT_TOOLS = ["tavily_extract", "tavily-extract", "webFetch"];

// Combined web tools
export const WEB_TOOLS = [...WEB_SEARCH_TOOLS, ...WEB_EXTRACT_TOOLS];

// Check if a tool is a web tool
export const isWebTool = (toolName) => WEB_TOOLS.includes(toolName);

// Get the segment type for any tool
// Returns "webSearch", "webExtract", or "tool" for generic tools
export const getToolSegmentType = (toolName) => {
  if (WEB_SEARCH_TOOLS.includes(toolName)) return "webSearch";
  if (WEB_EXTRACT_TOOLS.includes(toolName)) return "webExtract";
  return "tool";
};

// Download link tool names (PPTX and other file downloads)
export const DOWNLOAD_LINK_TOOLS = ["generate_download_link"];

// Check if a tool is a download link tool
export const isDownloadLinkTool = (toolName) => DOWNLOAD_LINK_TOOLS.includes(toolName);

// Image retrieval tool names
export const IMAGE_RETRIEVAL_TOOLS = ["retrieve_images"];

// Check if a tool is an image retrieval tool
export const isImageRetrievalTool = (toolName) => IMAGE_RETRIEVAL_TOOLS.includes(toolName);

// Canvas tool names
export const CANVAS_CREATE_TOOLS = [
  "create_document",
  "create_html_canvas",
  "create_code_canvas",
  "create_diagram",
  "create_svg",
  "create_mermaid",
];
export const CANVAS_TOOLS = [...CANVAS_CREATE_TOOLS, "update_canvas"];

// Check if a tool is a canvas tool
export const isCanvasTool = (toolName) => CANVAS_TOOLS.includes(toolName);

// Check if a tool is a canvas creation tool
export const isCanvasCreateTool = (toolName) => CANVAS_CREATE_TOOLS.includes(toolName);

// Get the category for timeline/indicator display
// Returns "web_search", "web_extract", or "generic"
export const getToolCategory = (toolName) => {
  if (WEB_SEARCH_TOOLS.includes(toolName)) return "web_search";
  if (WEB_EXTRACT_TOOLS.includes(toolName)) return "web_extract";
  return "generic";
};
