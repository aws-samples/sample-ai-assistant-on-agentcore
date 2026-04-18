import React from "react";
import TextContent from "./TextContent";
import UnifiedThinkingBlock from "./UnifiedThinkingBlock";
import PptxDownloadCard from "./PptxDownloadCard";
import RetrievedImages from "./RetrievedImages";
import DataFrameTable from "./DataFrameTable";
import BrowserSessionIndicator from "./BrowserSessionIndicator";
import CanvasToolIndicator from "./CanvasToolIndicator";
import SelectionMenu from "./Thread/SelectionMenu";
import { parseThreadSessionId } from "./useChatSessionFunctions";

const ContentResolver = React.memo(
  ({
    msg,
    type,
    isBlockComplete,
    webSearchResults,
    isStreaming,
    isStreamEnd,
    sessionId,
    boundProject = null,
    turnIndex,
    aiMessageIndex = 0,
  }) => {
    switch (type) {
      case "text": {
        // Wrap finalized assistant text in the SelectionMenu so the user can
        // right-click a highlighted span to spawn a Thread. Disabled while the
        // block is still streaming — anchoring to partial content is confusing
        // and the content hash would drift when more tokens arrive.
        const textBody = (
          <TextContent
            content={msg.content}
            citations={msg.citations}
            webSearchResults={webSearchResults}
            isStreaming={isStreaming}
          />
        );
        const isThreadSession = !!parseThreadSessionId(sessionId);
        const canThread =
          !isStreaming &&
          isBlockComplete &&
          typeof turnIndex === "number" &&
          !!sessionId &&
          !isThreadSession;
        if (!canThread) return textBody;
        return (
          <SelectionMenu
            sessionId={sessionId}
            turnIndex={turnIndex}
            aiMessageIndex={aiMessageIndex}
            textSource={typeof msg.content === "string" ? msg.content : ""}
            enabled
          >
            {textBody}
          </SelectionMenu>
        );
      }
      case "think": {
        // Find browser session in content segments
        const browserSegment = msg.contentSegments?.find((seg) => seg.type === "browser_session");
        return (
          <>
            <UnifiedThinkingBlock
              contentBlocks={msg.contentSegments}
              isGroupComplete={isBlockComplete}
            />
            {browserSegment && (
              <BrowserSessionIndicator
                liveEndpoint={browserSegment.liveEndpoint}
                browserSessionId={browserSegment.browserSessionId}
                urlLifetime={browserSegment.urlLifetime}
                viewport={browserSegment.viewport}
                status={isStreamEnd ? "terminated" : browserSegment.status}
                sessionId={sessionId}
              />
            )}
          </>
        );
      }
      case "download":
        return <PptxDownloadCard toolContent={msg.toolContent} boundProject={boundProject} />;
      case "images":
        return <RetrievedImages imageContent={msg.imageContent} />;
      case "dataframe":
        return <DataFrameTable data={msg.dataframeData} name={msg.dataframeData?.name} />;
      case "browser_session":
        return (
          <BrowserSessionIndicator
            liveEndpoint={msg.liveEndpoint}
            browserSessionId={msg.browserSessionId}
            urlLifetime={msg.urlLifetime}
            viewport={msg.viewport}
            status={isStreamEnd ? "terminated" : msg.status}
            sessionId={sessionId}
          />
        );
      case "canvas_tool":
        return (
          <CanvasToolIndicator
            toolName={msg.toolName}
            input={msg.input}
            toolCallId={msg.toolId}
            isComplete={isBlockComplete}
            isError={msg.error}
          />
        );
      default:
        return null;
    }
  }
);

export default ContentResolver;
