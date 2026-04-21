import React, { useState, useRef, useEffect, useCallback } from "react";
import "./ChatInput.css";
import { useTheme } from "../ThemeContext";
import { ChatSessionFunctionsContext } from "./ChatContext";
import { useContext } from "react";
import AttachmentMenu from "./AttachmentMenu";
import {
  Plus,
  X,
  FileText,
  Paperclip,
  AlertCircle,
  Zap,
  Monitor,
  Paintbrush,
  FolderOpen,
} from "lucide-react";
import { validateAttachment, getValidationErrorMessage, encodeAttachments } from "./attachments";
import { getSelectedModelId } from "./ModelSelector";
import { toast } from "sonner";

function ActiveModeButton({ icon, label, onRemove, disabled, title }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      className="action-button toggle-button toggled research-button"
      title={title}
      disabled={disabled}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
    >
      <span className="button-main-content">
        <span className="action-icon">{hovered ? <X size={14} /> : icon}</span>
        <span className="button-label">{label}</span>
      </span>
    </button>
  );
}

const ChatInput = ({
  onSendMessage,
  onStopStreaming,
  actionButtons = [],
  placeholder = "Ask anything...",
  maxHeight = 200,
  autoFocus = true,
  disabled = false,
  isStreaming = false,
  sessionId = null,
  tools = [],
  thinkingBudget = 0,
  onToggleButton = () => {},
  onDropdownClick = () => {},
  deepAgentEnabled = false,
  onEnableDeepAgent = () => {},
  onDisableDeepAgent = () => {},
  browserEnabled = false,
  onEnableBrowser = () => {},
  onDisableBrowser = () => {},
  canvasEnabled = false,
  onEnableCanvas = () => {},
  onDisableCanvas = () => {},
  attachmentError = null,
  boundProject = null,
  onSelectProject = () => {},
  onUnbindProject = () => {},
  onDeleteProjectCanvas = () => {},
  // When truthy, render in "thread mode": strip prepareSession debouncing,
  // attachments, and tool/canvas/browser toggles. The parent is expected to
  // wire onSendMessage to a thread-specific handler.
  threadMode = false,
}) => {
  const [message, setMessage] = useState("");
  const [toggleStates, setToggleStates] = useState({});
  // Single state for which dropdown is open (replaces activeDropdown + visibleDropdown + dropdownStates + isClosing)
  const [openDropdownId, setOpenDropdownId] = useState(null);
  const [attachedFiles, setAttachedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);
  const textareaRef = useRef(null);
  const containerRef = useRef(null);
  const dropdownRefs = useRef({});
  const buttonRefs = useRef({});
  const debounceTimerRef = useRef(null);
  const prevMessageRef = useRef("");
  const preparingRef = useRef(false);
  const isFirstMount = useRef(true);
  const lastSentAttachmentsRef = useRef([]);
  const { effectiveTheme } = useTheme();
  const functions = useContext(ChatSessionFunctionsContext);

  const currentSessionId = sessionId;
  const processedThinkingBudget = thinkingBudget === false ? 0 : thinkingBudget;

  // File upload handling with validation
  const handleFileSelect = useCallback((files) => {
    const fileArray = Array.from(files);
    const validFiles = [];
    const errors = [];

    fileArray.forEach((file) => {
      const validationResult = validateAttachment(file);
      if (validationResult.valid) {
        validFiles.push(file);
      } else {
        errors.push(getValidationErrorMessage(file));
      }
    });

    if (errors.length > 0) {
      errors.forEach((error) => toast.error(error));
    }

    if (validFiles.length > 0) {
      const newFiles = validFiles.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name,
        type: file.type,
        size: file.size,
        preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        status: "pending",
      }));
      setAttachedFiles((prev) => [...prev, ...newFiles]);
    }
  }, []);

  const handleFileInputChange = useCallback(
    (e) => {
      if (e.target.files) {
        handleFileSelect(e.target.files);
        e.target.value = "";
      }
    },
    [handleFileSelect]
  );

  const handleRemoveFile = useCallback((fileId) => {
    setAttachedFiles((prev) => {
      const fileToRemove = prev.find((f) => f.id === fileId);
      if (fileToRemove?.preview) URL.revokeObjectURL(fileToRemove.preview);
      return prev.filter((f) => f.id !== fileId);
    });
  }, []);

  const handleUploadClick = useCallback(() => fileInputRef.current?.click(), []);

  // Drag and drop
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);
  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) setIsDragging(false);
  }, []);
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);
  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (e.dataTransfer.files?.length > 0) handleFileSelect(e.dataTransfer.files);
    },
    [handleFileSelect]
  );

  // Cleanup file previews on unmount
  useEffect(() => {
    return () =>
      attachedFiles.forEach((f) => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
  }, []);

  // React to attachment errors from session state (replaces eventBus subscription)
  useEffect(() => {
    if (attachmentError && lastSentAttachmentsRef.current.length > 0) {
      setAttachedFiles(lastSentAttachmentsRef.current);
      setAttachedFiles((prev) =>
        prev.map((f) => ({
          ...f,
          status: "error",
          error:
            attachmentError.details?.filename === f.name
              ? attachmentError.error
              : "Attachment processing failed",
        }))
      );
    }
  }, [attachmentError]);

  // Simplified dropdown: single openDropdownId replaces 4 separate states
  const closeDropdown = useCallback(() => setOpenDropdownId(null), []);

  const toggleDropdown = useCallback((id) => {
    setOpenDropdownId((current) => (current === id ? null : id));
  }, []);

  // Prepare session (no-op in thread mode — threads don't maintain the
  // parent session's model / tool prefs independently)
  const prepareSession = useCallback(async () => {
    if (threadMode) return;
    if (preparingRef.current) return;
    preparingRef.current = true;
    try {
      const modelId = getSelectedModelId();
      await functions.prepareSession(currentSessionId, null, processedThinkingBudget, modelId);
    } catch (error) {
      console.error("Error preparing session:", error);
    } finally {
      preparingRef.current = false;
    }
  }, [functions, currentSessionId, processedThinkingBudget, threadMode]);

  // Skip prepareSession on first mount
  useEffect(() => {
    if (isFirstMount.current) {
      const timer = setTimeout(() => {
        isFirstMount.current = false;
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, []);

  // Debounced prepareSession on typing
  useEffect(() => {
    if (isFirstMount.current) return;
    const currentMessage = message.trim();
    const prevMessage = prevMessageRef.current.trim();
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    if (currentMessage) {
      if (!prevMessage) {
        prepareSession();
      } else {
        debounceTimerRef.current = setTimeout(prepareSession, 500);
      }
    }
    prevMessageRef.current = message;
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [message, prepareSession]);

  // Periodic prepareSession every 300s
  useEffect(() => {
    const interval = setInterval(() => {
      if (message.trim()) prepareSession();
    }, 300000);
    return () => clearInterval(interval);
  }, [prepareSession, message]);

  // Listen for model changes
  useEffect(() => {
    const handleModelChange = (event) => {
      const { modelId } = event.detail;
      if (functions?.prepareSession && currentSessionId) {
        functions.prepareSession(currentSessionId, null, processedThinkingBudget, modelId);
      }
    };
    window.addEventListener("modelChanged", handleModelChange);
    return () => window.removeEventListener("modelChanged", handleModelChange);
  }, [functions, currentSessionId, processedThinkingBudget]);

  // Initialize toggle states
  useEffect(() => {
    const initialStates = {};
    actionButtons.forEach((button) => {
      if (button.isToggle) initialStates[button.id] = button.defaultToggled || false;
    });
    setToggleStates(initialStates);
  }, [actionButtons]);

  // Click outside to close dropdown
  useEffect(() => {
    if (!openDropdownId) return;
    const handleClickOutside = (event) => {
      const dropdownEl = dropdownRefs.current[openDropdownId];
      const buttonEl = buttonRefs.current[openDropdownId];
      const contentEl = dropdownEl?.querySelector(".dropdown-content");
      const isOutsideContent = contentEl ? !contentEl.contains(event.target) : true;
      const isOutsideButton = buttonEl ? !buttonEl.contains(event.target) : true;
      if (isOutsideContent && isOutsideButton) closeDropdown();
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [openDropdownId, closeDropdown]);

  // Auto-resize textarea
  const adjustTextareaHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = "auto";
      textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    }
  }, [maxHeight]);

  useEffect(() => {
    adjustTextareaHeight();
  }, [message, adjustTextareaHeight]);

  const handleInputChange = useCallback((e) => setMessage(e.target.value), []);

  const handleSend = useCallback(async () => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage || !onSendMessage || disabled || isStreaming) return;

    const messageData = {
      message: trimmedMessage,
      sessionId: currentSessionId,
      timestamp: new Date().toISOString(),
      toggleStates: { ...toggleStates },
      config: { model_id: getSelectedModelId(), budget_level: processedThinkingBudget },
    };

    if (attachedFiles.length > 0) {
      try {
        setAttachedFiles((prev) => prev.map((f) => ({ ...f, status: "encoding" })));
        messageData.attachments = await encodeAttachments(attachedFiles.map((f) => f.file));
      } catch (error) {
        console.error("Failed to encode attachments:", error);
        toast.error(error.message || "Failed to read file");
        setAttachedFiles((prev) =>
          prev.map((f) => ({ ...f, status: "error", error: error.message }))
        );
        return;
      }
    }

    lastSentAttachmentsRef.current = [...attachedFiles];
    onSendMessage(messageData);
    setMessage("");
    setAttachedFiles([]);
  }, [
    message,
    onSendMessage,
    disabled,
    isStreaming,
    currentSessionId,
    toggleStates,
    attachedFiles,
    processedThinkingBudget,
  ]);

  const handleStopStreaming = useCallback(() => {
    if (onStopStreaming && isStreaming) onStopStreaming();
  }, [onStopStreaming, isStreaming]);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        isStreaming ? handleStopStreaming() : handleSend();
      }
    },
    [isStreaming, handleSend, handleStopStreaming]
  );

  const handleToggleButton = useCallback(
    (button) => {
      // Non-toggle button with dropdown: entire click toggles dropdown
      if (!button.isToggle && button.showDropdown) {
        toggleDropdown(button.id);
        if (button.onClick) button.onClick(message, currentSessionId);
        return;
      }

      if (button.isToggle) {
        const newState = !toggleStates[button.id];
        setToggleStates((prev) => ({ ...prev, [button.id]: newState }));

        if (!newState) {
          closeDropdown();
        }

        onToggleButton(button.id, newState);
        if (button.onClick) button.onClick(message, currentSessionId, newState);
      } else {
        if (button.onClick) button.onClick(message, currentSessionId);
      }
    },
    [toggleStates, onToggleButton, message, currentSessionId, toggleDropdown, closeDropdown]
  );

  const handleDropdownClick = useCallback(
    (button, event) => {
      event.stopPropagation();
      toggleDropdown(button.id);
      onDropdownClick();
    },
    [toggleDropdown, onDropdownClick]
  );

  useEffect(() => {
    if (autoFocus && textareaRef.current && !isStreaming) textareaRef.current.focus();
  }, [autoFocus, isStreaming]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  const canSend = message.trim().length > 0 && !disabled && !isStreaming;
  const canStop = isStreaming && !disabled;
  const activeDropdownButton = actionButtons.find((b) => b.id === openDropdownId);

  return (
    <div className={`chat-input-wrapper ${effectiveTheme}`} ref={containerRef}>
      {/* Dropdown Content Area */}
      {openDropdownId === "attach" && (
        <div
          className="dropdown-content-container"
          ref={(el) => (dropdownRefs.current["attach"] = el)}
        >
          <div className="dropdown-content">
            <AttachmentMenu
              onAttachFile={() => {
                closeDropdown();
                handleUploadClick();
              }}
              onEnableDeepAgent={() => {
                closeDropdown();
                onEnableDeepAgent();
              }}
              deepAgentEnabled={deepAgentEnabled}
              onEnableBrowser={() => {
                closeDropdown();
                onEnableBrowser();
              }}
              browserEnabled={browserEnabled}
              onEnableCanvas={() => {
                closeDropdown();
                onEnableCanvas();
              }}
              canvasEnabled={canvasEnabled}
              onSelectProject={(p) => {
                closeDropdown();
                onSelectProject(p);
              }}
              onUnbindProject={() => {
                closeDropdown();
                onUnbindProject();
              }}
              onDeleteProjectCanvas={onDeleteProjectCanvas}
              boundProject={boundProject}
            />
          </div>
        </div>
      )}
      {activeDropdownButton && activeDropdownButton.dropdownContent && (
        <div
          className="dropdown-content-container"
          ref={(el) => (dropdownRefs.current[activeDropdownButton.id] = el)}
        >
          <div className="dropdown-content">
            {typeof activeDropdownButton.dropdownContent === "function"
              ? activeDropdownButton.dropdownContent({
                  message,
                  sessionId: currentSessionId,
                  isToggled: toggleStates[activeDropdownButton.id] || false,
                  onClose: closeDropdown,
                })
              : activeDropdownButton.dropdownContent}
          </div>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,.pdf,.json,.yaml,.yml,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.html,.md"
        onChange={handleFileInputChange}
        style={{ display: "none" }}
      />

      {/* Validation errors now shown via toast notifications */}

      <div
        className={`chat-input-container ${effectiveTheme} ${isDragging ? "dragging" : ""} ${threadMode ? "thread-mode" : ""}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
      >
        {isDragging && (
          <div className="drag-overlay">
            <div className="drag-overlay-content">
              <Paperclip size={24} />
              <span>Drop files here</span>
            </div>
          </div>
        )}

        {attachedFiles.length > 0 && (
          <div className="attached-files-row">
            {attachedFiles.map((file) => (
              <div
                key={file.id}
                className={`attached-file-preview ${file.status === "error" ? "error" : ""} ${file.status === "encoding" ? "encoding" : ""}`}
                title={file.error || file.name}
              >
                {file.status === "error" && (
                  <div className="file-error-indicator" title={file.error}>
                    <AlertCircle size={16} className="error-icon" />
                  </div>
                )}
                {file.preview ? (
                  <img src={file.preview} alt={file.name} className="file-thumbnail" />
                ) : (
                  <div className="file-icon">
                    <FileText size={20} />
                  </div>
                )}
                <span className="file-name">{file.name}</span>
                {file.status === "encoding" && (
                  <span className="file-status encoding">Encoding...</span>
                )}
                {file.status === "error" && file.error && (
                  <span className="file-status error-status">{file.error}</span>
                )}
                <button
                  className="remove-file-btn"
                  onClick={() => handleRemoveFile(file.id)}
                  aria-label={`Remove ${file.name}`}
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className="chat-textarea"
          placeholder={isStreaming ? "Streaming response..." : placeholder}
          value={message}
          onChange={handleInputChange}
          onKeyDown={handleKeyDown}
          disabled={disabled || isStreaming}
          rows={1}
          aria-label="Chat message input"
        />
        <div className="button-row">
          <div className="optional-buttons">
            {!threadMode && (
              <button
                ref={(el) => (buttonRefs.current["attach"] = el)}
                className={`action-button ${openDropdownId === "attach" ? "dropdown-open" : ""}`}
                onClick={() => toggleDropdown("attach")}
                disabled={disabled || isStreaming}
                title="Attach"
                aria-label="Attach"
              >
                <span className="button-main-content">
                  <span className="action-icon">
                    <Plus size={18} />
                  </span>
                </span>
              </button>
            )}

            {!threadMode &&
              actionButtons.map((button, index) => {
                const isToggled = button.isToggle && toggleStates[button.id];
                const isDropdownOpen = openDropdownId === button.id;
                const isActive = button.alwaysActive || isToggled;

                return (
                  <button
                    key={button.id || index}
                    ref={(el) => (buttonRefs.current[button.id] = el)}
                    className={`action-button ${button.isToggle || button.alwaysActive ? "toggle-button" : ""} ${isActive ? "toggled" : ""} ${isDropdownOpen ? "dropdown-open" : ""}`}
                    onClick={() => handleToggleButton(button)}
                    disabled={button.disabled || disabled || isStreaming}
                    title={button.title}
                    data-theme={effectiveTheme}
                  >
                    <span className="button-main-content">
                      {button.icon && <span className="action-icon">{button.icon}</span>}
                      {button.label && <span className="button-label">{button.label}</span>}
                    </span>
                    {((button.isToggle && isToggled) || button.alwaysActive) &&
                      button.showDropdown && (
                        <>
                          <span className="button-separator"></span>
                          <span
                            className="dropdown-arrow"
                            onClick={(e) => handleDropdownClick(button, e)}
                          >
                            <svg
                              viewBox="0 0 24 24"
                              width="14"
                              height="14"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{
                                transform: isDropdownOpen ? "rotate(180deg)" : "rotate(0deg)",
                                transition: "transform 0.2s ease",
                              }}
                            >
                              <path d="M6 9l6 6 6-6" />
                            </svg>
                          </span>
                        </>
                      )}
                  </button>
                );
              })}

            {!threadMode && deepAgentEnabled && (
              <ActiveModeButton
                icon={<Zap size={16} />}
                label="Research"
                onRemove={onDisableDeepAgent}
                disabled={disabled || isStreaming}
                title="Research Mode"
              />
            )}

            {!threadMode && browserEnabled && (
              <ActiveModeButton
                icon={<Monitor size={16} />}
                label="Browser"
                onRemove={onDisableBrowser}
                disabled={disabled || isStreaming}
                title="Browser"
              />
            )}

            {!threadMode && canvasEnabled && (
              <ActiveModeButton
                icon={<Paintbrush size={16} />}
                label="Canvas"
                onRemove={onDisableCanvas}
                disabled={disabled || isStreaming}
                title="Canvas"
              />
            )}

            {!threadMode && boundProject && (
              <ActiveModeButton
                icon={<FolderOpen size={16} />}
                label={
                  boundProject.name.length > 10
                    ? boundProject.name.slice(0, 10) + "…"
                    : boundProject.name
                }
                onRemove={onUnbindProject}
                disabled={disabled || isStreaming}
                title={`Project: ${boundProject.name}`}
              />
            )}
          </div>

          {isStreaming ? (
            <button
              className="stop-button"
              onClick={handleStopStreaming}
              disabled={!canStop}
              aria-label="Stop streaming"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            </button>
          ) : (
            <button
              className="send-button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label="Send message"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatInput;
