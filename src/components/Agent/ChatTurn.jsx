import React from "react";
import ChatMessage from "./ChatMessage";
import UserChatMessage from "./UserChatMessage";

/**
 * ChatTurn renders a single conversation turn (user message + AI response).
 *
 *
 * @param {Object} props
 * @param {number} props.messageIndex - Index of this message turn (for scroll targeting)
 * @param {string} props.userMessage - The user's message
 * @param {Array} props.attachments - File attachments
 * @param {Object} props.aiMessage - The AI's response
 * @param {Object} props.user - User object
 * @param {boolean} props.isLast - Whether this is the last turn
 * @param {Function} props.scroll - Scroll function
 * @param {boolean} props.streaming - Whether AI is streaming
 * @param {boolean} props.isParentFirstMount - Whether parent is on first mount
 * @param {string} props.sessionId - Current session ID
 * @param {boolean} props.isHighlighted - Whether this turn should be highlighted (from search)
 * @param {boolean} props.skipAutoScroll - Whether to skip auto-scroll to bottom (for search navigation)
 */
const ChatTurn = React.memo(function ChatTurn({
  messageIndex,
  userMessage,
  attachments,
  aiMessage,
  user,
  isLast,
  scroll,
  streaming = false,
  isParentFirstMount,
  sessionId,
  isHighlighted = false,
  skipAutoScroll = false,
  boundProject = null,
}) {
  return (
    <div
      data-message-index={messageIndex}
      className={`chat-turn ${isHighlighted ? "chat-turn-highlighted" : ""}`}
      style={{ paddingTop: "10px" }}
    >
      <UserChatMessage message={userMessage} attachments={attachments} user={user} isUser={true} />
      <ChatMessage
        message={aiMessage}
        user={user}
        isUser={false}
        streaming={streaming}
        isLast={isLast}
        scroll={scroll}
        isParentFirstMount={isParentFirstMount}
        sessionId={sessionId}
        skipAutoScroll={skipAutoScroll}
        turnIndex={messageIndex}
        boundProject={boundProject}
      />
    </div>
  );
});

export default ChatTurn;
