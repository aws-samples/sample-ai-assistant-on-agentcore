/**
 * Builds renderable message blocks from raw AI message events.
 *
 * Three-pass approach:
 * Pass 1 (collectTools): Build toolsById map from ALL tool events (handles out-of-order)
 * Pass 2 (assembleBlocks): Build blocks array, using toolsById as source of truth
 * Pass 3 (extractMediaBlocks): Extract download/image/dataframe blocks from completed tools
 *
 * @param {Array} message - Raw message events from the AI
 * @param {boolean} isEnd - Whether the stream has ended
 * @returns {Array} Array of renderable block objects
 */
import {
  getToolSegmentType,
  isDownloadLinkTool,
  isImageRetrievalTool,
  isCanvasTool,
} from "../toolClassification";

import { getAttachedTools } from "./thinkBlockHelpers";

/**
 * Pass 1: Scan all events and build a toolsById Map.
 * Handles out-of-order tool_start, tool_update, and completion events.
 * Also attaches interrupt data to the corresponding tool entry.
 *
 * @param {Array} message - Raw SSE event array
 * @returns {Map<string, ToolData>} toolsById map
 */
export function collectTools(message) {
  const toolsById = new Map();

  for (const item of message) {
    if (item.type === "tool" && item.id) {
      if (!toolsById.has(item.id)) {
        toolsById.set(item.id, {
          id: item.id,
          toolName: item.tool_name,
          content: null,
          input: null,
          isComplete: false,
          error: false,
          isInterrupt: false,
          interruptContent: null,
          result: null,
          hasStart: false,
          hasCompletion: false,
        });
      }

      const toolData = toolsById.get(item.id);

      if (item.tool_start === true) {
        toolData.hasStart = true;
        toolData.toolName = item.tool_name;
        toolData.input = item.content;
      } else if (item.tool_update) {
        toolData.input = item.content;
        // Canvas tool_update carries partial streaming text — don't overwrite content with it.
        // Canvas content is managed via canvas_state events and the tool completion.
        if (!isCanvasTool(toolData.toolName)) {
          toolData.content = item.content;
        }
      } else {
        toolData.hasCompletion = true;
        toolData.toolName = item.tool_name || toolData.toolName;
        if (toolData.toolName === "generate_chart") {
          toolData.result = item.content;
        } else {
          toolData.content = item.content;
        }
        toolData.isComplete = true;
        toolData.error = item.error || false;
      }
    }

    if (item.type === "interrupt") {
      const requestId = item.content?.request_id;
      const toolName = item.content?.tool_name;

      if (toolName === "generate_chart") continue;

      let targetToolId = null;
      if (requestId && toolsById.has(requestId)) {
        targetToolId = requestId;
      } else if (toolName) {
        for (const [id, tool] of toolsById) {
          if (tool.toolName === toolName && !tool.isInterrupt) {
            targetToolId = id;
            break;
          }
        }
      }

      if (targetToolId) {
        const toolData = toolsById.get(targetToolId);
        toolData.interruptContent = item.content;
        toolData.isInterrupt = true;
      }
    }
  }

  return toolsById;
}

/**
 * Pass 2 + 3: Build ordered block array from events using the toolsById map.
 * Handles think block grouping, canvas tool blocks, browser sessions,
 * text blocks, and orphan tool recovery at stream end.
 *
 * Think blocks are normalized: only `contentSegments` is maintained as the
 * source of truth. No parallel `attachedTools`, `webSearchTools`, `toolIds`,
 * `hasAttachedTools`, or `hasWebSearch` arrays.
 *
 * @param {Array} message - Raw SSE event array
 * @param {Map<string, ToolData>} toolsById - From collectTools
 * @param {boolean} isEnd - Whether the stream has ended
 * @returns {Array<Block>} Ordered block array
 */
export function assembleBlocks(message, toolsById, isEnd) {
  const blocks = [];
  const toolIndexMap = new Map();
  let currentThinkBlock = null;
  let currentTextBlock = null;

  const getOrCreateThinkBlock = () => {
    if (currentThinkBlock) return currentThinkBlock;
    if (currentTextBlock) {
      currentTextBlock.isComplete = true;
      currentTextBlock = null;
    }
    currentThinkBlock = {
      type: "think",
      content: "",
      isComplete: false,
      items: [],
      citations: [],
      contentSegments: [],
    };
    blocks.push(currentThinkBlock);
    return currentThinkBlock;
  };

  const addToolToThinkBlock = (thinkBlock, toolData, toolId) => {
    // Check if this tool is already in contentSegments
    if (thinkBlock.contentSegments.some((s) => s.type !== "text" && s.toolId === toolId)) return;

    const segmentType = getToolSegmentType(toolData.toolName);
    const segmentIndex = thinkBlock.contentSegments.length;

    const toolEntry = {
      toolId: toolId,
      id: toolId,
      toolName: toolData.toolName,
      input: toolData.input,
      content: toolData.content,
      isComplete: toolData.isComplete,
      error: toolData.error,
    };

    thinkBlock.contentSegments.push({ type: segmentType, ...toolEntry });
    thinkBlock.isComplete = false;
    toolIndexMap.set(toolId, {
      blockIndex: blocks.indexOf(thinkBlock),
      segmentIndex,
    });
  };

  const syncToolToBlock = (toolId) => {
    const location = toolIndexMap.get(toolId);
    const toolData = toolsById.get(toolId);
    if (!location || !toolData) return;

    const block = blocks[location.blockIndex];
    if (!block) return;

    // Canvas tool blocks are flat — update directly
    if (location.isCanvasTool) {
      block.content = toolData.content;
      block.input = toolData.input;
      block.isComplete = toolData.isComplete;
      block.error = toolData.error;
      return;
    }

    const updates = {
      id: toolData.id,
      toolName: toolData.toolName,
      content: toolData.content,
      input: toolData.input,
      isComplete: toolData.isComplete,
      error: toolData.error,
    };

    if (location.segmentIndex !== undefined) {
      const segment = block.contentSegments?.[location.segmentIndex];
      if (segment) Object.assign(segment, updates);
    }
  };

  for (const item of message) {
    if (item.type === "text" && item.content === "[empty]") continue;

    if (item.type === "tool" && item.id && item.tool_start === true) {
      if (toolIndexMap.has(item.id)) continue;
      const toolData = toolsById.get(item.id);
      if (!toolData) continue;

      // Canvas tools get their own block type instead of grouping into think blocks
      if (isCanvasTool(toolData.toolName)) {
        if (currentThinkBlock) {
          currentThinkBlock.isComplete = true;
          currentThinkBlock = null;
        }
        if (currentTextBlock) {
          currentTextBlock.isComplete = true;
          currentTextBlock = null;
        }
        const canvasBlock = {
          type: "canvas_tool",
          toolId: item.id,
          toolName: toolData.toolName,
          input: toolData.input,
          content: toolData.content,
          isComplete: toolData.isComplete,
          error: toolData.error,
        };
        blocks.push(canvasBlock);
        toolIndexMap.set(item.id, { blockIndex: blocks.length - 1, isCanvasTool: true });
        continue;
      }

      const thinkBlock = getOrCreateThinkBlock();
      addToolToThinkBlock(thinkBlock, toolData, item.id);
      continue;
    }

    if (item.type === "tool" && item.tool_update && item.id && toolIndexMap.has(item.id)) {
      // For canvas tool_updates, only sync on meta events (which carry the title)
      // Skip chunk events to avoid overwriting input with partial content
      if (isCanvasTool(item.tool_name)) {
        if (item.content?.canvas_event === "meta") {
          const toolData = toolsById.get(item.id);
          if (toolData)
            toolData.input = { title: item.content.title, type: item.content.canvas_type };
          syncToolToBlock(item.id);
        }
        continue;
      }
      // Sync canvas tool blocks immediately on tool_update so title appears during streaming
      syncToolToBlock(item.id);
      continue;
    }

    if (item.type === "tool") continue;
    if (item.type === "interrupt") continue;

    // Browser session events attach to the current think block like a tool
    if (item.type === "browser_session") {
      const thinkBlock = getOrCreateThinkBlock();
      thinkBlock.contentSegments.push({
        type: "browser_session",
        liveEndpoint: item.live_endpoint,
        browserSessionId: item.browser_session_id,
        urlLifetime: item.url_lifetime,
        viewport: item.viewport,
        status: item.status,
        toolName: "browser",
        isComplete: true,
      });
      continue;
    }

    if (item.type === "think" && item.content != null) {
      const thinkBlock = getOrCreateThinkBlock();
      thinkBlock.content += item.content;
      thinkBlock.items.push(item);
      if (item.citations?.length > 0) {
        thinkBlock.citations = [...thinkBlock.citations, ...item.citations];
      }
      const lastSegment = thinkBlock.contentSegments[thinkBlock.contentSegments.length - 1];
      if (lastSegment?.type === "text") {
        lastSegment.content += item.content;
      } else {
        thinkBlock.contentSegments.push({ type: "text", content: item.content });
      }
      continue;
    }

    if (item.type === "text" && item.content != null) {
      if (currentThinkBlock) {
        currentThinkBlock.isComplete = true;
        currentThinkBlock = null;
      }
      if (currentTextBlock && currentTextBlock.type === "text") {
        currentTextBlock.content += item.content;
        currentTextBlock.items.push(item);
        if (item.citations?.length > 0) {
          currentTextBlock.citations = [...(currentTextBlock.citations || []), ...item.citations];
        }
      } else {
        if (currentTextBlock) currentTextBlock.isComplete = true;
        currentTextBlock = {
          type: "text",
          content: item.content,
          isComplete: false,
          items: [item],
          citations: item.citations || [],
        };
        blocks.push(currentTextBlock);
      }
    }
  }

  // ── Pass 3: Handle orphan tools at stream end ──
  if (isEnd) {
    for (const [toolId, toolData] of toolsById) {
      if (!toolIndexMap.has(toolId) && toolData.hasCompletion) {
        if (isCanvasTool(toolData.toolName)) {
          const canvasBlock = {
            type: "canvas_tool",
            toolId,
            toolName: toolData.toolName,
            input: toolData.input,
            content: toolData.content,
            isComplete: toolData.isComplete,
            error: toolData.error,
          };
          blocks.push(canvasBlock);
          toolIndexMap.set(toolId, { blockIndex: blocks.length - 1, isCanvasTool: true });
        } else {
          const thinkBlock = getOrCreateThinkBlock();
          addToolToThinkBlock(thinkBlock, toolData, toolId);
        }
      }
    }
  }

  // ── Final: Mark everything complete at stream end ──
  if (isEnd) {
    for (const toolData of toolsById.values()) {
      toolData.isComplete = true;
    }
    for (const toolId of toolIndexMap.keys()) {
      syncToolToBlock(toolId);
    }
    for (const block of blocks) {
      block.isComplete = true;
      if (block.type === "think") {
        block.contentSegments?.forEach((s) => {
          if (s.type !== "text") s.isComplete = true;
        });
      }
    }
  }

  return blocks;
}

/**
 * Post-pass: Extract download, image, and dataframe blocks from
 * completed tool results and insert them after their parent think block.
 *
 * Uses `getAttachedTools` helper to iterate non-text segments from
 * contentSegments, since think blocks no longer have a parallel
 * `attachedTools` array.
 *
 * @param {Array<Block>} blocks - From assembleBlocks
 * @returns {Array<Block>} Final block array with media blocks inserted
 */
export function extractMediaBlocks(blocks) {
  const finalBlocks = [];
  for (const block of blocks) {
    finalBlocks.push(block);
    if (block.type === "think") {
      const tools = getAttachedTools(block.contentSegments);
      for (const tool of tools) {
        if (isDownloadLinkTool(tool.toolName) && tool.isComplete) {
          finalBlocks.push({
            type: "download",
            toolContent: tool.content,
            isComplete: tool.isComplete,
          });
        }
        if (
          (isImageRetrievalTool(tool.toolName) || tool.toolName === "execute_code") &&
          tool.isComplete &&
          Array.isArray(tool.content)
        ) {
          const imageBlocks = [];
          const dfBlocks = [];
          for (const b of tool.content) {
            if (b.type === "text" && b.__dataframe__) {
              dfBlocks.push(b.__dataframe__);
            } else {
              imageBlocks.push(b);
            }
          }
          if (imageBlocks.some((b) => b.type === "image")) {
            const isPrivate = imageBlocks.some((b) => b.__private__);
            if (!isPrivate) {
              finalBlocks.push({
                type: "images",
                imageContent: imageBlocks,
                isComplete: tool.isComplete,
              });
            }
          }
          for (const df of dfBlocks) {
            finalBlocks.push({ type: "dataframe", dataframeData: df, isComplete: tool.isComplete });
          }
        }
      }
    }
  }

  return finalBlocks;
}

/**
 * Orchestrator — calls collectTools → assembleBlocks → extractMediaBlocks.
 * Signature and output unchanged from current implementation.
 *
 * @param {Array} message - Raw message events from the AI
 * @param {boolean} isEnd - Whether the stream has ended
 * @returns {Array} Array of renderable block objects
 */
export function buildMessageBlocks(message, isEnd) {
  if (!message || message.length === 0) return [];
  const toolsById = collectTools(message);
  const blocks = assembleBlocks(message, toolsById, isEnd);
  return extractMediaBlocks(blocks);
}

/**
 * Incremental message block builder.
 *
 * Maintains state between renders and processes only new items on each call,
 * reducing per-flush work from O(n) to O(delta). The output is identical to
 * buildMessageBlocks but cheaper during active streaming.
 *
 * Usage:
 *   const builder = createMessageBuilder();       // once, per message
 *   const blocks  = builder.build(message, isEnd); // on every render
 *
 * @returns {{ build: (message: Array, isEnd: boolean) => Array }}
 */
export function createMessageBuilder() {
  let _toolsById = new Map();
  let _blocks = [];
  let _toolIndexMap = new Map();
  let _currentThinkIdx = -1; // index into _blocks, -1 = no open think block
  let _currentTextIdx = -1; // index into _blocks, -1 = no open text block
  let _processedCount = 0;
  let _wasEnd = false;

  function reset() {
    _toolsById = new Map();
    _blocks = [];
    _toolIndexMap = new Map();
    _currentThinkIdx = -1;
    _currentTextIdx = -1;
    _processedCount = 0;
    _wasEnd = false;
  }

  // Immutably replace a block at idx, preserving index stability for toolIndexMap
  function replaceBlock(idx, newBlock) {
    const arr = _blocks.slice();
    arr[idx] = newBlock;
    _blocks = arr;
  }

  function closeThinkBlock() {
    if (_currentThinkIdx < 0) return;
    const b = _blocks[_currentThinkIdx];
    if (!b.isComplete) replaceBlock(_currentThinkIdx, { ...b, isComplete: true });
    _currentThinkIdx = -1;
  }

  function closeTextBlock() {
    if (_currentTextIdx < 0) return;
    const b = _blocks[_currentTextIdx];
    if (!b.isComplete) replaceBlock(_currentTextIdx, { ...b, isComplete: true });
    _currentTextIdx = -1;
  }

  function getOrCreateThinkBlock() {
    if (_currentThinkIdx >= 0) return _blocks[_currentThinkIdx];
    closeTextBlock();
    const thinkBlock = {
      type: "think",
      content: "",
      isComplete: false,
      items: [],
      citations: [],
      contentSegments: [],
    };
    _blocks = [..._blocks, thinkBlock];
    _currentThinkIdx = _blocks.length - 1;
    return thinkBlock;
  }

  function syncToolToBlock(toolId) {
    const location = _toolIndexMap.get(toolId);
    const toolData = _toolsById.get(toolId);
    if (!location || !toolData) return;
    const block = _blocks[location.blockIndex];
    if (!block) return;
    const updates = {
      id: toolData.id,
      toolName: toolData.toolName,
      content: toolData.content,
      input: toolData.input,
      isComplete: toolData.isComplete,
      error: toolData.error,
    };
    if (location.isCanvasTool) {
      replaceBlock(location.blockIndex, { ...block, ...updates });
      return;
    }
    if (location.segmentIndex !== undefined) {
      const seg = block.contentSegments?.[location.segmentIndex];
      if (seg) {
        const newSegs = [...block.contentSegments];
        newSegs[location.segmentIndex] = { ...seg, ...updates };
        replaceBlock(location.blockIndex, { ...block, contentSegments: newSegs });
      }
    }
  }

  function addToolToThinkBlock(thinkIdx, toolData, toolId) {
    const thinkBlock = _blocks[thinkIdx];
    if (thinkBlock.contentSegments.some((s) => s.type !== "text" && s.toolId === toolId)) return;
    const segmentType = getToolSegmentType(toolData.toolName);
    const segmentIndex = thinkBlock.contentSegments.length;
    const toolEntry = {
      toolId,
      id: toolId,
      toolName: toolData.toolName,
      input: toolData.input,
      content: toolData.content,
      isComplete: toolData.isComplete,
      error: toolData.error,
    };
    replaceBlock(thinkIdx, {
      ...thinkBlock,
      contentSegments: [...thinkBlock.contentSegments, { type: segmentType, ...toolEntry }],
      isComplete: false,
    });
    _toolIndexMap.set(toolId, { blockIndex: thinkIdx, segmentIndex });
  }

  // Pass 1: update toolsById for one item
  function collectItem(item) {
    if (item.type === "tool" && item.id) {
      if (!_toolsById.has(item.id)) {
        _toolsById.set(item.id, {
          id: item.id,
          toolName: item.tool_name,
          content: null,
          input: null,
          isComplete: false,
          error: false,
          isInterrupt: false,
          interruptContent: null,
          result: null,
          hasStart: false,
          hasCompletion: false,
        });
      }
      const toolData = _toolsById.get(item.id);
      if (item.tool_start === true) {
        toolData.hasStart = true;
        toolData.toolName = item.tool_name;
        toolData.input = item.content;
      } else if (item.tool_update) {
        toolData.input = item.content;
        if (!isCanvasTool(toolData.toolName)) {
          toolData.content = item.content;
        }
      } else {
        toolData.hasCompletion = true;
        toolData.toolName = item.tool_name || toolData.toolName;
        if (toolData.toolName === "generate_chart") {
          toolData.result = item.content;
        } else {
          toolData.content = item.content;
        }
        toolData.isComplete = true;
        toolData.error = item.error || false;
      }
    } else if (item.type === "interrupt") {
      const requestId = item.content?.request_id;
      const toolName = item.content?.tool_name;
      if (toolName === "generate_chart") return;
      let targetToolId = null;
      if (requestId && _toolsById.has(requestId)) {
        targetToolId = requestId;
      } else if (toolName) {
        for (const [id, tool] of _toolsById) {
          if (tool.toolName === toolName && !tool.isInterrupt) {
            targetToolId = id;
            break;
          }
        }
      }
      if (targetToolId) {
        const toolData = _toolsById.get(targetToolId);
        toolData.interruptContent = item.content;
        toolData.isInterrupt = true;
      }
    }
  }

  // Pass 2: assemble one item into blocks using the fully-populated toolsById
  function assembleItem(item) {
    if (item.type === "text" && item.content === "[empty]") return;

    if (item.type === "tool" && item.id && item.tool_start === true) {
      if (_toolIndexMap.has(item.id)) return;
      const toolData = _toolsById.get(item.id);
      if (!toolData) return;

      if (isCanvasTool(toolData.toolName)) {
        closeThinkBlock();
        closeTextBlock();
        const canvasBlock = {
          type: "canvas_tool",
          toolId: item.id,
          toolName: toolData.toolName,
          input: toolData.input,
          content: toolData.content,
          isComplete: toolData.isComplete,
          error: toolData.error,
        };
        _blocks = [..._blocks, canvasBlock];
        _toolIndexMap.set(item.id, { blockIndex: _blocks.length - 1, isCanvasTool: true });
        return;
      }

      getOrCreateThinkBlock();
      addToolToThinkBlock(_currentThinkIdx, toolData, item.id);
      return;
    }

    if (item.type === "tool" && item.tool_update && item.id && _toolIndexMap.has(item.id)) {
      if (isCanvasTool(item.tool_name)) {
        if (item.content?.canvas_event === "meta") {
          const toolData = _toolsById.get(item.id);
          if (toolData)
            toolData.input = { title: item.content.title, type: item.content.canvas_type };
          syncToolToBlock(item.id);
        }
        return;
      }
      syncToolToBlock(item.id);
      return;
    }

    if (item.type === "tool") {
      // Completion event for an already-indexed tool: sync updated state to block immediately
      if (!item.tool_start && !item.tool_update && item.id && _toolIndexMap.has(item.id)) {
        syncToolToBlock(item.id);
      }
      return;
    }

    if (item.type === "interrupt") return;

    if (item.type === "browser_session") {
      getOrCreateThinkBlock();
      const thinkBlock = _blocks[_currentThinkIdx];
      replaceBlock(_currentThinkIdx, {
        ...thinkBlock,
        contentSegments: [
          ...thinkBlock.contentSegments,
          {
            type: "browser_session",
            liveEndpoint: item.live_endpoint,
            browserSessionId: item.browser_session_id,
            urlLifetime: item.url_lifetime,
            viewport: item.viewport,
            status: item.status,
            toolName: "browser",
            isComplete: true,
          },
        ],
      });
      return;
    }

    if (item.type === "think" && item.content != null) {
      getOrCreateThinkBlock();
      const thinkBlock = _blocks[_currentThinkIdx];
      const newCitations =
        item.citations?.length > 0
          ? [...thinkBlock.citations, ...item.citations]
          : thinkBlock.citations;
      const lastSeg = thinkBlock.contentSegments[thinkBlock.contentSegments.length - 1];
      const newSegs =
        lastSeg?.type === "text"
          ? [
              ...thinkBlock.contentSegments.slice(0, -1),
              { ...lastSeg, content: lastSeg.content + item.content },
            ]
          : [...thinkBlock.contentSegments, { type: "text", content: item.content }];
      replaceBlock(_currentThinkIdx, {
        ...thinkBlock,
        content: thinkBlock.content + item.content,
        items: [...thinkBlock.items, item],
        citations: newCitations,
        contentSegments: newSegs,
      });
      return;
    }

    if (item.type === "text" && item.content != null) {
      closeThinkBlock();
      if (_currentTextIdx >= 0) {
        const textBlock = _blocks[_currentTextIdx];
        const newCitations =
          item.citations?.length > 0
            ? [...(textBlock.citations || []), ...item.citations]
            : textBlock.citations;
        replaceBlock(_currentTextIdx, {
          ...textBlock,
          content: textBlock.content + item.content,
          items: [...textBlock.items, item],
          citations: newCitations,
        });
      } else {
        const newBlock = {
          type: "text",
          content: item.content,
          isComplete: false,
          items: [item],
          citations: item.citations || [],
        };
        _blocks = [..._blocks, newBlock];
        _currentTextIdx = _blocks.length - 1;
      }
    }
  }

  function finalizeEnd() {
    // Orphan tools: completed without a matching tool_start in the stream
    for (const [toolId, toolData] of _toolsById) {
      if (!_toolIndexMap.has(toolId) && toolData.hasCompletion) {
        if (isCanvasTool(toolData.toolName)) {
          const canvasBlock = {
            type: "canvas_tool",
            toolId,
            toolName: toolData.toolName,
            input: toolData.input,
            content: toolData.content,
            isComplete: toolData.isComplete,
            error: toolData.error,
          };
          _blocks = [..._blocks, canvasBlock];
          _toolIndexMap.set(toolId, { blockIndex: _blocks.length - 1, isCanvasTool: true });
        } else {
          getOrCreateThinkBlock();
          addToolToThinkBlock(_currentThinkIdx, toolData, toolId);
        }
      }
    }
    // Mark all tools complete and sync
    for (const toolData of _toolsById.values()) toolData.isComplete = true;
    for (const toolId of _toolIndexMap.keys()) syncToolToBlock(toolId);
    // Mark all blocks complete
    _blocks = _blocks.map((block) => ({
      ...block,
      isComplete: true,
      ...(block.type === "think" && {
        contentSegments: block.contentSegments.map((s) =>
          s.type !== "text" ? { ...s, isComplete: true } : s
        ),
      }),
    }));
    _currentThinkIdx = -1;
    _currentTextIdx = -1;
  }

  function processRange(items, start, end) {
    for (let i = start; i < end; i++) collectItem(items[i]);
    for (let i = start; i < end; i++) assembleItem(items[i]);
  }

  return {
    build(message, isEnd) {
      if (!message || message.length === 0) {
        if (_processedCount > 0) reset();
        return [];
      }
      // Full rebuild if message shrank (e.g. turn was cleared/replaced)
      if (message.length < _processedCount) {
        reset();
        processRange(message, 0, message.length);
        _processedCount = message.length;
        if (isEnd) finalizeEnd();
        _wasEnd = isEnd;
        return extractMediaBlocks(_blocks);
      }
      // Incremental: only process items not yet seen
      processRange(message, _processedCount, message.length);
      _processedCount = message.length;
      if (isEnd && !_wasEnd) finalizeEnd();
      _wasEnd = isEnd;
      return extractMediaBlocks(_blocks);
    },
  };
}
