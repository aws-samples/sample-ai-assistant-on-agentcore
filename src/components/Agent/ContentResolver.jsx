import React from "react";
import TextContent from "./TextContent";
import UnifiedThinkingBlock from "./UnifiedThinkingBlock";
import PptxDownloadCard from "./PptxDownloadCard";
import RetrievedImages from "./RetrievedImages";
import DataFrameTable from "./DataFrameTable";
import BrowserSessionIndicator from "./BrowserSessionIndicator";
import CanvasToolIndicator from "./CanvasToolIndicator";

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
  }) => {
    switch (type) {
      case "text":
        return (
          <TextContent
            content={msg.content}
            citations={msg.citations}
            webSearchResults={webSearchResults}
            isStreaming={isStreaming}
          />
        );
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
