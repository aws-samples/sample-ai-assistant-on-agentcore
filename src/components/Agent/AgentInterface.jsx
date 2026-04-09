import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import ScrollToBottomButton from "./ScrollToBottomButton";
import { useScrollToBottom } from "./useScrollToBottom";
import ChatContent from "./ChatContent";
import { toast } from "sonner";
import "./styles.css";
import ChatInput from "./ChatInput";
import { ChatSessionFunctionsContext } from "./ChatContext";
import { useContext } from "react";
import ThinkingBudget from "./ThinkingBudget";
import { useParams, useNavigate } from "react-router-dom";
import AgentLoader from "./LoadingAgent";
import { generateChatDescription } from "../Sidebar/NavChats";
import { sparkyModelConfig } from "../../config";
import { ClockFading } from "lucide-react";
import ErrorBoundary from "../ErrorBoundary";
import { useSessionLifecycle } from "./useSessionLifecycle";
import { useScrollToMessage } from "./useScrollToMessage";
import { CanvasProvider, useCanvas } from "./context/CanvasContext";
import { CANVAS_TOOL_IDS } from "../../services/toolConfigService";
import { canvasCallbacksRef } from "./context/streamChunkHandler";
import CanvasPanel from "./CanvasPanel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { bindProject, unbindProject } from "../../services/projectsService";
import { saveCanvasToProject, deleteProjectCanvas } from "./context/api";

// localStorage keys
const THINKING_ENABLED_KEY = "thinkingEnabled";
const THINKING_BUDGET_KEY = "thinkingBudget";
// sessionStorage key for Research mode
const RESEARCH_MODE_KEY = "researchModeEnabled";
const BROWSER_MODE_KEY = "browserModeEnabled";
const CANVAS_MODE_KEY = "canvasModeEnabled";

function ChatInterfaceContent({
  user,
  inTools,
  sessionId,
  activeSessionId,
  isInitialUrlLoad,
  chatTurns,
  isStreaming,
  error,
  currentSession,
  budget,
  setBudget,
  thinkingEnabled,
  setThinkingEnabled,
}) {
  const {
    isPanelOpen,
    createCanvas,
    updateCanvas,
    appendStreamChunk,
    setStreaming,
    openPanel,
    startUpdateStream,
    appendUpdateChunk,
    updateCanvasTitle,
    userEditCanvas,
    migrateCanvas,
    canvases,
  } = useCanvas();
  const chatContainerRef = useRef(null);

  // Sync canvas panel state to document for CSS-based sidebar mode switching
  // and collapse sidebar when canvas opens
  useEffect(() => {
    if (isPanelOpen) {
      document.documentElement.setAttribute("data-canvas-open", "true");
      window.dispatchEvent(new CustomEvent("canvasOpened"));
    } else {
      document.documentElement.removeAttribute("data-canvas-open");
    }
    return () => document.documentElement.removeAttribute("data-canvas-open");
  }, [isPanelOpen]);

  // Register canvas callbacks for the stream chunk handler via stable ref
  useEffect(() => {
    canvasCallbacksRef.current = {
      createCanvas,
      updateCanvas,
      migrateCanvas,
      getCanvas: (id) => canvases.get(id),
      appendStreamChunk,
      setStreaming,
      openPanel,
      startUpdateStream,
      appendUpdateChunk,
      updateCanvasTitle,
    };
    return () => {
      canvasCallbacksRef.current = null;
    };
  }, [
    createCanvas,
    updateCanvas,
    migrateCanvas,
    canvases,
    appendStreamChunk,
    setStreaming,
    openPanel,
    startUpdateStream,
    appendUpdateChunk,
    updateCanvasTitle,
  ]);

  const urlSessionId = useParams()["sessionId"];

  const { containerRef, showButton, scrollToBottom, setShowButton, checkScrollPosition } =
    useScrollToBottom({ scrollOnMount: true, sessionId: urlSessionId });

  // Revert the scroll-preservation hack — no longer needed with stable DOM
  const setChatContainerRef = useCallback(
    (node) => {
      chatContainerRef.current = node;
      containerRef(node);
    },
    [containerRef]
  );

  const navigate = useNavigate();
  const [isInitialPageLoad, setIsInitialPageLoad] = useState(true);
  const hasNavigatedRef = useRef(false);

  useEffect(() => {
    if (urlSessionId) setIsInitialPageLoad(true);
  }, [urlSessionId]);

  const functions = useContext(ChatSessionFunctionsContext);
  const { setSessions } = functions;

  // ── Research mode ──
  const [deepAgentEnabled, setDeepAgentEnabled] = useState(
    () => sessionStorage.getItem(RESEARCH_MODE_KEY) === "true"
  );
  useEffect(() => {
    sessionStorage.setItem(RESEARCH_MODE_KEY, String(deepAgentEnabled));
  }, [deepAgentEnabled]);

  // ── Project binding ──
  const boundProject = currentSession?.boundProject ?? null;

  const handleBindProject = useCallback(
    async (project) => {
      if (!sessionId) return;
      try {
        // Only call the API if the session is already committed (URL has session ID)
        if (urlSessionId) {
          await bindProject(sessionId, project.project_id);
        }
        setSessions((prev) => {
          const m = new Map(prev);
          const s = m.get(sessionId);
          if (s) m.set(sessionId, { ...s, boundProject: project });
          return m;
        });
        toast.success(`Project "${project.name}" bound to this chat`);
      } catch (e) {
        toast.error(e.message || "Failed to bind project");
      }
    },
    [sessionId, urlSessionId, setSessions]
  );

  const handleUnbindProject = useCallback(async () => {
    if (!sessionId) return;
    try {
      // Only call the API if the session is already committed
      if (urlSessionId) {
        await unbindProject(sessionId);
      }
      setSessions((prev) => {
        const m = new Map(prev);
        const s = m.get(sessionId);
        if (s) m.set(sessionId, { ...s, boundProject: null });
        return m;
      });
    } catch {
      toast.error("Failed to unbind project");
    }
  }, [sessionId, urlSessionId, setSessions]);

  // ── Canvas ↔ Project ──
  const handleSaveCanvasToProject = useCallback(
    async (canvasId) => {
      if (!sessionId || !boundProject) return;
      try {
        const result = await saveCanvasToProject(sessionId, boundProject.project_id, canvasId);
        const savedCanvas = {
          canvas_id: result.canvas_id,
          name: result.name,
          type: result.type,
          saved_at: result.saved_at,
        };
        setSessions((prev) => {
          const m = new Map(prev);
          const s = m.get(sessionId);
          if (!s?.boundProject) return prev;
          const filtered = (s.boundProject.saved_canvases ?? []).filter(
            (c) => c.canvas_id !== canvasId
          );
          m.set(sessionId, {
            ...s,
            boundProject: { ...s.boundProject, saved_canvases: [...filtered, savedCanvas] },
          });
          return m;
        });
        toast.success("Canvas saved to project");
      } catch (e) {
        toast.error(e.message || "Failed to save canvas to project");
        throw e;
      }
    },
    [sessionId, boundProject, setSessions]
  );

  const handleDeleteProjectCanvas = useCallback(
    async (canvasId) => {
      if (!sessionId || !boundProject) return;
      try {
        await deleteProjectCanvas(sessionId, boundProject.project_id, canvasId);
        setSessions((prev) => {
          const m = new Map(prev);
          const s = m.get(sessionId);
          if (!s?.boundProject) return prev;
          const newCanvases = (s.boundProject.saved_canvases ?? []).filter(
            (c) => c.canvas_id !== canvasId
          );
          m.set(sessionId, {
            ...s,
            boundProject: { ...s.boundProject, saved_canvases: newCanvases },
          });
          return m;
        });
      } catch (e) {
        toast.error(e.message || "Failed to remove canvas from project");
      }
    },
    [sessionId, boundProject, setSessions]
  );

  // ── Browser mode ──
  const [browserEnabled, setBrowserEnabled] = useState(
    () => sessionStorage.getItem(BROWSER_MODE_KEY) === "true"
  );
  useEffect(() => {
    sessionStorage.setItem(BROWSER_MODE_KEY, String(browserEnabled));
  }, [browserEnabled]);

  // ── Canvas mode ──
  const [canvasEnabled, setCanvasEnabled] = useState(
    () => sessionStorage.getItem(CANVAS_MODE_KEY) === "true"
  );
  useEffect(() => {
    sessionStorage.setItem(CANVAS_MODE_KEY, String(canvasEnabled));
  }, [canvasEnabled]);

  // Enabled optional tools from the prepare response (stored on the session)
  const enabledOptionalTools = currentSession?.enabledOptionalTools;

  // Clamp budget when switching to a model with fewer reasoning levels
  useEffect(() => {
    const handleModelChange = () => {
      const currentModelId = localStorage.getItem("selectedModelId") || "";
      const modelConfig = sparkyModelConfig.models.find((m) => m.id === currentModelId);
      const maxLevel = modelConfig?.reasoning_levels || 3;
      if (parseInt(budget) > maxLevel) {
        const clamped = String(maxLevel);
        setBudget(clamped);
        localStorage.setItem(THINKING_BUDGET_KEY, clamped);
      }
    };
    window.addEventListener("modelChanged", handleModelChange);
    return () => window.removeEventListener("modelChanged", handleModelChange);
  }, [budget, setBudget]);

  // ── Scroll-to-message (extracted hook) ──
  const { highlightedMessageIndex, hasMessageHash, clearMessageHash } = useScrollToMessage(
    chatContainerRef,
    chatTurns,
    sessionId,
    isInitialUrlLoad
  );

  useEffect(() => {
    if (urlSessionId) hasNavigatedRef.current = true;
  }, [urlSessionId]);

  // ── Scroll button visibility ──
  const wasLoadingRef = useRef(isInitialUrlLoad);
  useEffect(() => {
    if (chatTurns.length === 0) {
      setShowButton(false);
      return;
    }
    wasLoadingRef.current = isInitialUrlLoad;
  }, [chatTurns.length, setShowButton, isInitialUrlLoad]);

  // ── Budget / thinking callbacks ──
  const handleBudgetChange = useCallback(
    (newBudget) => {
      setBudget(newBudget);
      localStorage.setItem(THINKING_BUDGET_KEY, newBudget);
      if (newBudget !== "0") {
        setThinkingEnabled(true);
        localStorage.setItem(THINKING_ENABLED_KEY, "true");
      }
    },
    [setBudget, setThinkingEnabled]
  );

  const handleThinkingToggle = useCallback(
    (isToggled) => {
      setThinkingEnabled(isToggled);
      localStorage.setItem(THINKING_ENABLED_KEY, String(isToggled));
      if (isToggled && budget === "0") {
        setBudget("1");
        localStorage.setItem(THINKING_BUDGET_KEY, "1");
      }
    },
    [budget, setBudget, setThinkingEnabled]
  );

  // ── Deep Agent ──
  const handleEnableDeepAgent = useCallback(() => setDeepAgentEnabled(true), []);
  const handleDisableDeepAgent = useCallback(() => setDeepAgentEnabled(false), []);

  // React to deep agent errors from session state (replaces eventBus subscription)
  useEffect(() => {
    if (currentSession?.deepAgentError) {
      setDeepAgentEnabled(false);
      functions.dismissDeepAgentError(sessionId);
    }
  }, [currentSession?.deepAgentError, sessionId, functions]);

  // ── Send message ──
  const handleSendMessage = useCallback(
    async ({ message, sessionId: msgSessionId, context, attachments, config }) => {
      clearMessageHash();
      setIsInitialPageLoad(false);
      const agentMode = deepAgentEnabled ? "research" : "normal";
      const canvasCreationTools = canvasEnabled
        ? CANVAS_TOOL_IDS.filter((id) => !enabledOptionalTools || enabledOptionalTools.includes(id))
        : [];
      const enabledTools = [
        ...(browserEnabled ? ["browser"] : []),
        ...canvasCreationTools,
        ...(canvasCreationTools.length > 0 ? ["update_canvas"] : []),
      ];

      if (!hasNavigatedRef.current && !urlSessionId && sessionId) {
        hasNavigatedRef.current = true;
        navigate(`/chat/${sessionId}`, { replace: true });

        generateChatDescription(sessionId, message, boundProject?.project_id || null)
          .then((description) => {
            window.dispatchEvent(
              new CustomEvent("chatCreated", {
                detail: {
                  sessionId,
                  description: description || message.substring(0, 50),
                  createdAt: new Date().toISOString(),
                },
              })
            );
          })
          .catch(() => {
            window.dispatchEvent(
              new CustomEvent("chatCreated", {
                detail: {
                  sessionId,
                  description: message.length > 50 ? message.substring(0, 50) + "..." : message,
                  createdAt: new Date().toISOString(),
                },
              })
            );
          });
      }

      await functions.sendMessage(
        sessionId || msgSessionId,
        message,
        false,
        null,
        attachments,
        agentMode,
        config,
        0,
        enabledTools,
        boundProject?.project_id || null
      );
    },
    [
      functions,
      sessionId,
      urlSessionId,
      navigate,
      clearMessageHash,
      deepAgentEnabled,
      browserEnabled,
      canvasEnabled,
      enabledOptionalTools,
      boundProject,
    ]
  );

  const handleStopStreaming = useCallback(
    () => functions.stopStreaming(sessionId),
    [functions, sessionId]
  );
  // Show streaming errors as toast notifications and clear the error state
  useEffect(() => {
    if (error) {
      toast.error(error);
      functions.dismissError(sessionId);
    }
  }, [error, functions, sessionId]);

  const handleActionButtonClick = useCallback(
    (actionId, message, sid, isToggled) => {
      if (actionId === "thinking") handleThinkingToggle(isToggled);
      else functions.sendMessage(sid, message);
    },
    [functions, handleThinkingToggle]
  );

  // ── Action buttons config ──
  const actionButtons = useMemo(
    () => [
      {
        id: "think",
        label: "Think",
        icon: <ClockFading />,
        isToggle: true,
        showDropdown: true,
        dropdownContent: () => (
          <ThinkingBudget initialBudget={budget} onBudgetChange={handleBudgetChange} />
        ),
        defaultToggled: thinkingEnabled,
        alwaysActive: false,
        disabled: deepAgentEnabled,
        onClick: (message, sid, isToggled) =>
          handleActionButtonClick("thinking", message, sid, isToggled),
      },
    ],
    [budget, thinkingEnabled, handleBudgetChange, handleActionButtonClick, deepAgentEnabled]
  );

  const handleToggleButton = useCallback(
    (buttonId, isToggled) => {
      if (buttonId === "thinking") handleThinkingToggle(isToggled);
    },
    [handleThinkingToggle]
  );

  if (isInitialUrlLoad) return <AgentLoader isNewChat={!urlSessionId} />;

  const isEmpty = chatTurns.length === 0;

  const chatColumn = (
    <div
      className={`${inTools ? "tools-main-div" : "main-div"}${isEmpty ? " empty-state-centered" : ""}`}
    >
      <div style={{ marginBottom: "4px" }}></div>
      <div className="tools-container-wrapper">
        <div className="stick-to-bottom" ref={setChatContainerRef}>
          {isEmpty ? (
            <div className="welcome-greeting">
              <div className="welcome-greeting-hi">
                {user?.given_name && user.given_name.trim()
                  ? `Hi, ${user.given_name.trim()}`
                  : "Hi"}
              </div>
              <div className="welcome-greeting-subtitle">How can I help you today?</div>
            </div>
          ) : (
            <ErrorBoundary>
              <div
                key={activeSessionId}
                className="stick-to-bottom-content chat-content-fade-in"
                style={{ padding: "8px" }}
              >
                <ChatContent
                  chatTurns={chatTurns}
                  user={user}
                  streaming={isStreaming}
                  scroll={scrollToBottom}
                  isParentFirstMount={isInitialPageLoad}
                  sessionId={activeSessionId}
                  highlightedMessageIndex={highlightedMessageIndex}
                  skipAutoScroll={hasMessageHash()}
                  boundProject={boundProject}
                />
              </div>
            </ErrorBoundary>
          )}
        </div>
        {!isEmpty && <div className="stick-to-bottom-fade" />}
        {showButton && (
          <ScrollToBottomButton
            scroll={() => scrollToBottom(true)}
            className="scroll-to-bottom-button"
          />
        )}
      </div>

      <div>
        <div style={{ padding: "0px 5px 8px 5px" }}>
          <ChatInput
            onSendMessage={handleSendMessage}
            onStopStreaming={handleStopStreaming}
            actionButtons={actionButtons}
            placeholder="Ask anything..."
            maxHeight={200}
            autoFocus={true}
            isStreaming={isStreaming}
            tools={[]}
            thinkingBudget={thinkingEnabled && budget}
            sessionId={sessionId}
            onToggleButton={handleToggleButton}
            onDropdownClick={() => {}}
            deepAgentEnabled={deepAgentEnabled}
            onEnableDeepAgent={handleEnableDeepAgent}
            onDisableDeepAgent={handleDisableDeepAgent}
            browserEnabled={browserEnabled}
            onEnableBrowser={() => setBrowserEnabled(true)}
            onDisableBrowser={() => setBrowserEnabled(false)}
            canvasEnabled={canvasEnabled}
            onEnableCanvas={() => setCanvasEnabled(true)}
            onDisableCanvas={() => setCanvasEnabled(false)}
            attachmentError={currentSession?.attachmentError || null}
            boundProject={boundProject}
            onSelectProject={handleBindProject}
            onUnbindProject={handleUnbindProject}
            onDeleteProjectCanvas={handleDeleteProjectCanvas}
          />
        </div>
      </div>
    </div>
  );

  return (
    <>
      <ResizablePanelGroup direction="horizontal" style={{ height: "100%" }}>
        <ResizablePanel defaultSize={isPanelOpen ? 45 : 100} minSize={25}>
          {chatColumn}
        </ResizablePanel>
        {isPanelOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={55} minSize={30}>
              <CanvasPanel
                sessionId={activeSessionId}
                agentIsStreaming={isStreaming}
                boundProject={boundProject}
                onSaveCanvas={handleSaveCanvasToProject}
              />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
    </>
  );
}

/**
 * Intermediate component that owns thinking/budget state and session lifecycle,
 * then renders CanvasProvider with the resolved activeSessionId so canvas state
 * is always scoped to the correct session.
 */
function ChatInterfaceInner({ user, inTools }) {
  const urlSessionId = useParams()["sessionId"];

  // ── Thinking budget state ──
  const [budget, setBudget] = useState(() => localStorage.getItem(THINKING_BUDGET_KEY) || "1");
  const [thinkingEnabled, setThinkingEnabled] = useState(() => {
    const saved = localStorage.getItem(THINKING_ENABLED_KEY);
    if (saved !== null) return saved === "true";
    return budget !== "0";
  });

  const {
    sessionId,
    isLoading: isInitialUrlLoad,
    activeSessionId,
    chatTurns,
    isStreaming,
    error,
    currentSession,
  } = useSessionLifecycle(urlSessionId, thinkingEnabled, budget);

  return (
    <CanvasProvider activeSessionId={activeSessionId}>
      <ChatInterfaceContent
        user={user}
        inTools={inTools}
        sessionId={sessionId}
        activeSessionId={activeSessionId}
        isInitialUrlLoad={isInitialUrlLoad}
        chatTurns={chatTurns}
        isStreaming={isStreaming}
        error={error}
        currentSession={currentSession}
        budget={budget}
        setBudget={setBudget}
        thinkingEnabled={thinkingEnabled}
        setThinkingEnabled={setThinkingEnabled}
      />
    </CanvasProvider>
  );
}

function ChatInterface(props) {
  return <ChatInterfaceInner {...props} />;
}

export default ChatInterface;
