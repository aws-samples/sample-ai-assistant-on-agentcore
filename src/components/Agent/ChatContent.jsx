import ChatTurn from "./ChatTurn";
import React, { memo } from "react";

/**
 * ChatContent renders the list of chat turns (user message + AI response pairs).
 *
 *
 * @param {Object} props
 * @param {Array} props.chatTurns - Array of chat turn objects
 * @param {boolean} props.streaming - Whether the AI is currently streaming a response
 * @param {Object} props.user - User object
 * @param {Function} props.scroll - Scroll function
 * @param {boolean} props.isParentFirstMount - Whether parent is on first mount
 * @param {string} props.sessionId - Current session ID
 * @param {number|null} props.highlightedMessageIndex - Index of message to highlight (from search)
 * @param {boolean} props.skipAutoScroll - Whether to skip auto-scroll to bottom (for search navigation)
 */
const ChatContent = memo(
  ({
    chatTurns,
    streaming,
    user,
    scroll,
    isParentFirstMount,
    sessionId,
    highlightedMessageIndex,
    skipAutoScroll = false,
    boundProject = null,
  }) => {
    return (
      <>
        {chatTurns.map((turn, index) => {
          const isLast = index === chatTurns.length - 1;
          const isHighlighted = highlightedMessageIndex === index;
          return (
            <ChatTurn
              key={turn.id}
              messageIndex={index}
              userMessage={turn.userMessage}
              attachments={turn?.attachments}
              aiMessage={turn?.aiMessage}
              user={user}
              streaming={streaming && isLast}
              isLast={isLast}
              scroll={scroll}
              isParentFirstMount={isParentFirstMount}
              sessionId={sessionId}
              isHighlighted={isHighlighted}
              skipAutoScroll={skipAutoScroll}
              boundProject={boundProject}
            />
          );
        })}
      </>
    );
  }
);

export default ChatContent;
