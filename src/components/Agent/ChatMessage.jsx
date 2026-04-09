import React, { useEffect, useMemo, useRef } from "react";
import MessageAvatar from "./MessageAvatar";
import ChatButtons from "./ChatButtons";
import ContentResolver from "./ContentResolver";
import { createMessageBuilder } from "./utils/buildMessageBlocks";
import { isWebTool } from "./toolClassification";
import { parseWebResults } from "./utils/parseWebResults";
import { getAttachedTools } from "./utils/thinkBlockHelpers";

/**
 * ChatMessage Component
 *
 * Responsible for rendering individual AI messages and triggering scroll behavior.
 *
 * Scroll Trigger Logic:
 * - Only the last message triggers scroll (isLast prop)
 * - Uses hasScrolled ref to prevent duplicate scrolls
 * - Determines scroll type based on isParentFirstMount:
 *   - Initial load (isParentFirstMount=true): Instant scroll (no animation)
 *   - New messages (isParentFirstMount=false): Smooth scroll (animated)
 */
const ChatMessage = React.memo(
  ({
    message,
    streaming,
    isLast,
    scroll,
    isParentFirstMount,
    sessionId,
    skipAutoScroll = false,
    turnIndex,
    boundProject = null,
  }) => {
    const inputHeight = 240;
    const endMarker = message?.[message.length - 1];
    const isEnd = endMarker?.end === true;
    const checkpointId = endMarker?.checkpoint_id ?? null;
    const tokenStats = endMarker?.token_stats ?? null;
    const hasScrolled = useRef(false);
    const messageRef = useRef(null);

    useEffect(() => {
      // Skip auto-scroll when navigating from search results (URL has #msg-X hash)
      // Check both the prop AND the URL hash directly for reliability
      const hasMessageHash = window.location.hash.startsWith("#msg-");
      if (skipAutoScroll || hasMessageHash) {
        hasScrolled.current = true; // Mark as scrolled to prevent future auto-scrolls
        return;
      }

      if (isLast && !hasScrolled.current) {
        hasScrolled.current = true;

        // Use instant scroll on initial page load (loading existing chat)
        // Use smooth scroll only for new messages during active session
        // isParentFirstMount is true when loading existing chat, false after user sends a message
        const useSmooth = !isParentFirstMount;

        if (useSmooth) {
          // Small delay for smooth scroll to ensure DOM is ready
          setTimeout(() => {
            scroll(true);
          }, 50);
        } else {
          // Instant scroll - no delay needed
          scroll(false);
        }
      }
    }, [isLast, scroll, skipAutoScroll, isParentFirstMount]);

    const builderRef = useRef(null);
    if (!builderRef.current) builderRef.current = createMessageBuilder();
    const messageBlocks = useMemo(() => builderRef.current.build(message, isEnd), [message, isEnd]);

    // Collect web sources and search result URLs in a single pass
    const { webSources, webSearchResults } = useMemo(() => {
      const sources = [];
      const searchResults = [];
      const seenUrls = new Set();

      for (const block of messageBlocks) {
        if (block.type !== "think") continue;
        const tools = getAttachedTools(block.contentSegments);
        for (const tool of tools) {
          if (!tool.isComplete || !isWebTool(tool.toolName)) continue;

          const parsedSources = parseWebResults(tool.content);
          for (const s of parsedSources) {
            if (!seenUrls.has(s.url)) {
              seenUrls.add(s.url);
              sources.push(s);
            }
          }

          const urls = parsedSources.map((r) => r.url);
          if (urls.length > 0) {
            searchResults.push(urls);
          }
        }
      }

      return { webSources: sources, webSearchResults: searchResults };
    }, [messageBlocks]);

    return (
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          columnGap: "8px",
          width: "100%",
          marginBottom: "50px",
          height: isLast && `calc(100vh - ${inputHeight}px)`,
        }}
      >
        <MessageAvatar isUser={false} loading={streaming && !isEnd} />

        <div
          ref={messageRef}
          style={{
            flex: 1,
            minWidth: 0,
            overflowX: "clip",
            marginTop: "4px",
          }}
        >
          <div
            style={{
              backgroundColor: "",
            }}
          >
            {messageBlocks.map((block, index) => {
              const nextBlock = messageBlocks[index + 1];

              // Add spacing between all blocks when there's a next block
              const marginBottom = nextBlock ? "16px" : "2px";

              // Determine if this block is still streaming
              // A block is streaming if the overall message is streaming and the block is not complete
              const blockIsStreaming = streaming && !block.isComplete;

              return (
                <div key={index} style={{ marginBottom }}>
                  <ContentResolver
                    msg={block}
                    type={block.type}
                    isBlockComplete={block.isComplete}
                    isParentFirstMount={isParentFirstMount}
                    sessionId={sessionId}
                    webSearchResults={webSearchResults}
                    isStreaming={blockIsStreaming}
                    isStreamEnd={isEnd}
                    boundProject={boundProject}
                  />
                </div>
              );
            })}

            {isEnd && (
              <ChatButtons
                content={message}
                messageRef={messageRef}
                webSources={webSources}
                sessionId={sessionId}
                turnIndex={turnIndex}
                checkpointId={checkpointId}
                tokenStats={tokenStats}
              />
            )}

            {/* Spacer to add breathing room at the bottom of chat */}
            <div style={{ height: "50px" }} />
          </div>
        </div>
      </div>
    );
  }
);

export default ChatMessage;
