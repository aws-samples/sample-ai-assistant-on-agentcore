import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { ButtonGroup } from "@/components/ui/button-group";
import { StatusIndicator } from "@/components/ui/status-indicator";
import { SourcesButton } from "./WebSearchIndicator";
import { branchSession } from "./context/api";

const buildTokenPopover = (stats) => {
  if (!stats) return null;
  const {
    input_tokens: inp = 0,
    output_tokens: out = 0,
    cache_creation_input_tokens: cc = 0,
    cache_read_input_tokens: cr = 0,
  } = stats;
  const rows = [
    { label: "Input", value: inp.toLocaleString() },
    { label: "Output", value: out.toLocaleString() },
    { label: "Cache read", value: cr.toLocaleString() },
    { label: "Cache write", value: cc.toLocaleString() },
  ];
  return (
    <div style={{ minWidth: "160px" }}>
      <p style={{ fontSize: "12px", fontWeight: 600, marginBottom: "4px", opacity: 0.6 }}>
        Token usage
      </p>
      <table style={{ width: "100%", fontSize: "13px", borderCollapse: "collapse" }}>
        <tbody>
          {rows.map(({ label, value }) => (
            <tr key={label}>
              <td style={{ paddingTop: label !== "Input" ? "4px" : 0, opacity: 0.7 }}>{label}</td>
              <td
                style={{
                  paddingTop: label !== "Input" ? "4px" : 0,
                  textAlign: "right",
                  fontVariantNumeric: "tabular-nums",
                  paddingLeft: "24px",
                }}
              >
                {value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const ChatButtons = React.memo(
  ({ content, messageRef, webSources = [], sessionId, turnIndex, checkpointId, tokenStats }) => {
    const [feedback, setFeedback] = useState("");
    const [branching, setBranching] = useState(false);
    const navigate = useNavigate();

    const handleCopy = useCallback(async (contentArray) => {
      try {
        const textContent = contentArray
          .filter((item) => item.type === "text")
          .map((item) => item.content || "")
          .join("");

        await navigator.clipboard.writeText(textContent);
      } catch (err) {
        console.error("Failed to copy text: ", err);
      }
    }, []);

    const handleBranch = useCallback(async () => {
      if (branching || !sessionId || turnIndex == null) return;
      setBranching(true);
      try {
        const result = await branchSession(sessionId, turnIndex, checkpointId);
        const newSessionId = result.session_id;

        window.dispatchEvent(
          new CustomEvent("chatCreated", {
            detail: {
              sessionId: newSessionId,
              description: "Branched conversation",
              createdAt: new Date().toISOString(),
            },
          })
        );

        navigate(`/chat/${newSessionId}`);
      } catch (err) {
        console.error("Failed to branch session:", err);
      } finally {
        setBranching(false);
      }
    }, [branching, sessionId, turnIndex, checkpointId, navigate]);

    const onItemClick = useCallback(
      ({ detail }) => {
        if (["like", "dislike"].includes(detail.id)) {
          setFeedback(detail.pressed ? detail.id : "");
        }
        if (detail.id === "copy") {
          handleCopy(content);
        }
        if (detail.id === "branch") {
          handleBranch();
        }
      },
      [content, handleCopy, handleBranch]
    );

    if (content.length == 1 && content[0].text == "") {
      return null;
    }

    return (
      <div className="chat-buttons-row">
        <ButtonGroup
          onItemClick={onItemClick}
          ariaLabel="Chat actions"
          items={[
            {
              type: "group",
              text: "Vote",
              items: [
                {
                  type: "icon-toggle-button",
                  id: "like",
                  iconName: "thumbs-up",
                  pressedIconName: "thumbs-up-filled",
                  text: "Like",
                  pressed: feedback === "like",
                },
                {
                  type: "icon-toggle-button",
                  id: "dislike",
                  iconName: "thumbs-down",
                  pressedIconName: "thumbs-down-filled",
                  text: "Dislike",
                  pressed: feedback === "dislike",
                },
              ],
            },
            {
              type: "icon-button",
              id: "copy",
              iconName: "copy",
              text: "Copy",
              popoverFeedback: <StatusIndicator type="success">Message copied</StatusIndicator>,
            },
            {
              type: "icon-button",
              id: "branch",
              iconName: branching ? "loader" : "git-branch",
              text: "Branch",
              disabled: branching,
            },
            ...(tokenStats
              ? [
                  {
                    type: "icon-button",
                    id: "token-stats",
                    iconName: "bar-chart-2",
                    text: "Token usage",
                    popoverContent: buildTokenPopover(tokenStats),
                  },
                ]
              : []),
          ]}
          variant="icon"
        />
        {webSources.length > 0 && <SourcesButton sources={webSources} />}
      </div>
    );
  }
);

export default ChatButtons;
