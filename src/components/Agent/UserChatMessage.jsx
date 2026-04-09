import React, { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import MessageAvatar from "./MessageAvatar";
import AttachmentDisplay from "./AttachmentDisplay";

const MAX_LINES = 5;

const UserChatMessage = React.memo(({ message, attachments, user }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  const normalizedContent = React.useMemo(() => {
    if (typeof message === "string") {
      return message;
    }
    // If it's already an array, extract the text
    if (Array.isArray(message) && message.length > 0) {
      return message
        .filter((item) => item.type === "text")
        .map((item) => item.text || item.content)
        .join("");
    }
    // If it's already a formatted object
    if (message && typeof message === "object") {
      return message.content || message.text || "";
    }
    return "";
  }, [message]);

  const { displayContent, shouldTruncate } = React.useMemo(() => {
    const lines = normalizedContent.split("\n");
    const shouldTruncate = lines.length > MAX_LINES;
    const displayContent =
      shouldTruncate && !isExpanded ? lines.slice(0, MAX_LINES).join("\n") : normalizedContent;
    return { displayContent, shouldTruncate };
  }, [normalizedContent, isExpanded]);

  return (
    <div
      className="message-item"
      style={{
        display: "flex",
        flexDirection: "row-reverse",
        alignItems: "flex-start",
        columnGap: "8px",
        width: "100%",
        marginBottom: "32px",
      }}
    >
      <MessageAvatar
        isUser={true}
        firstName={user.given_name}
        surname={user.family_name}
        loading={false}
      />

      <div
        style={{
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          marginTop: "-4px",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            backgroundColor: "var(--chat-bubble-incoming)",
            padding: "8px 12px",
            borderRadius: "8px",
            display: "inline-block",
            maxWidth: "90%",
            minWidth: shouldTruncate ? "110px" : undefined,
            ...(shouldTruncate && !isExpanded
              ? {
                  WebkitMaskImage:
                    "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
                  maskImage: "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
                }
              : {}),
          }}
        >
          <div style={{ lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {displayContent}
          </div>
          {/* Render attachments below user message text */}
          {attachments && attachments.length > 0 && (
            <AttachmentDisplay attachments={attachments} showTooltip={false} />
          )}
        </div>
        {shouldTruncate && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="mt-1 flex items-center gap-0.5 px-1.5 py-1 rounded-[4px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            style={{ fontSize: "11px", lineHeight: 1 }}
          >
            {isExpanded ? "Show less" : "Show more"}
            {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
          </button>
        )}
      </div>
    </div>
  );
});

export default UserChatMessage;
