import { useRef, useCallback, useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { PlusCircle, ToolCase, Search, Lightbulb, FolderOpen, Clock } from "lucide-react";
import { Sidebar, SidebarContent, useSidebar } from "@/components/ui/sidebar";
import { SidebarHeader } from "./SidebarHeader";
import { NavMain } from "./NavMain";
import { NavChats } from "./NavChats";
import { NavUser } from "./NavUser";
import { ChatSearchCommand } from "@/components/ChatSearch/ChatSearchCommand";
import { searchChats } from "@/components/Agent/context/api";
import { logOut } from "@/services/Auth/auth";
import "./Sidebar.css";

// Detect if user is on Mac for keyboard shortcut display
const isMac =
  typeof navigator !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;

/**
 * AppSidebar is the main sidebar component that composes all sidebar sections.
 * Chat history is fetched from the server by NavChats component.
 *
 * Server-based chat history flow:
 * - Fetches history on mount via NavChats
 * - Refreshes after new chat via chatHistoryUpdated event
 * - Handles refresh after description generation via event listener
 *
 *
 * @param {Object} props
 * @param {Object} props.user - User object with given_name and family_name
 * @param {string} props.colorMode - Current color mode ('system', 'light', 'dark')
 * @param {string} props.effectiveTheme - Effective theme ('light' or 'dark')
 * @param {Function} props.setThemeMode - Function to set theme mode
 * @param {Function} props.setAuthUser - Function to update auth state (for logout)
 * @param {Function} props.onNewChat - Callback to clear session and start new chat
 * @param {Function} props.onChatSelect - Callback when a chat is selected
 * @param {Function} props.onHistoryUpdate - Callback when chat history is updated
 */
export function AppSidebar({
  user,
  colorMode,
  effectiveTheme,
  setThemeMode,
  setAuthUser,
  onNewChat,
  onChatSelect,
  onHistoryUpdate,
  ...props
}) {
  const navigate = useNavigate();
  const location = useLocation();
  const { state, setOpen } = useSidebar();
  const isSidebarOpen = state === "expanded";

  // Track canvas open state via document attribute
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsCanvasOpen(document.documentElement.hasAttribute("data-canvas-open"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-canvas-open"],
    });
    return () => observer.disconnect();
  }, []);

  // Show model selector in sidebar:
  // - When expanded and not on tools/skills pages (normal mode)
  // - Always when canvas is open (overlay mode) and not on tools/skills pages
  const onModelPage = location.pathname !== "/tools" && !location.pathname.startsWith("/skills");
  const showModelSelector = onModelPage && (isSidebarOpen || isCanvasOpen);

  // Ref to NavChats for triggering refresh
  const navChatsRef = useRef(null);

  // State for search command palette
  const [searchOpen, setSearchOpen] = useState(false);

  // Collapse sidebar when canvas opens
  useEffect(() => {
    const handleCanvasOpened = () => {
      setOpen(false);
    };
    window.addEventListener("canvasOpened", handleCanvasOpened);
    return () => window.removeEventListener("canvasOpened", handleCanvasOpened);
  }, [setOpen]);

  // Keyboard shortcut to open search (⌘K on Mac, Ctrl+K on Windows/Linux)
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Navigation items configuration - "New Chat", "Search", "Skills", and "Tool Settings" items
  const navItems = [
    {
      title: "New Chat",
      url: "/",
      icon: PlusCircle,
    },
    {
      title: "Search",
      icon: Search,
      isSearch: true,
      shortcut: isMac ? { modifier: "⌘", key: "K" } : { modifier: "Ctrl", key: "K" },
    },
    {
      title: "Skills",
      url: "/skills",
      icon: Lightbulb,
    },
    {
      title: "Projects",
      url: "/projects",
      icon: FolderOpen,
    },
    {
      title: "Scheduled Tasks",
      url: "/scheduled-tasks",
      icon: Clock,
    },
    {
      title: "Tools",
      url: "/tools",
      icon: ToolCase,
    },
  ];

  // Handle logout
  const handleLogout = async () => {
    try {
      await logOut();
      setAuthUser(null);
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  /**
   * Handle new chat creation - triggers history refresh after navigation
   */
  const handleNewChat = useCallback(() => {
    if (onNewChat) {
      onNewChat();
    }
  }, [onNewChat]);

  /**
   * Handle history updates from NavChats
   * Passes updated history to parent component
   */
  const handleHistoryUpdate = useCallback(
    (history) => {
      if (onHistoryUpdate) {
        onHistoryUpdate(history);
      }
    },
    [onHistoryUpdate]
  );

  /**
   * Handle search button click - opens the search command palette
   */
  const handleSearchClick = useCallback(() => {
    setSearchOpen(true);
  }, []);

  /**
   * Handle search result selection - navigates to the selected chat
   *
   * @param {string} sessionId - The session ID of the selected chat
   * @param {number} messageIndex - The message index to scroll to
   */
  const handleSearchResultSelect = useCallback(
    (sessionId, messageIndex) => {
      // Check if we're already on this chat (same-chat navigation)
      const currentPath = window.location.pathname;
      const targetPath = `/chat/${sessionId}`;
      const isSameChat = currentPath === targetPath;

      // Navigate to the chat with the session_id using hash for message targeting
      // Format: /{sessionId}#msg-{messageIndex}
      navigate(`/chat/${sessionId}#msg-${messageIndex}`);

      // For same-chat navigation, dispatch a custom event since hashchange won't fire
      // when using React Router's navigate()
      if (isSameChat) {
        // Small delay to ensure the hash is updated in the URL
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("scrollToMessage", {
              detail: { messageIndex },
            })
          );
        }, 50);
      }
      // Modal closes automatically via onOpenChange in ChatSearchCommand
    },
    [navigate]
  );

  return (
    <>
      <Sidebar collapsible="icon" {...props}>
        <SidebarHeader />
        <SidebarContent>
          <NavMain
            items={navItems}
            onNewChat={handleNewChat}
            onSearchClick={handleSearchClick}
            showModelSelector={showModelSelector}
          />
          <NavChats
            ref={navChatsRef}
            onChatSelect={onChatSelect}
            onHistoryUpdate={handleHistoryUpdate}
          />
        </SidebarContent>
        <NavUser
          user={user}
          colorMode={colorMode}
          setThemeMode={setThemeMode}
          onLogout={handleLogout}
        />
      </Sidebar>

      <ChatSearchCommand
        open={searchOpen}
        onOpenChange={setSearchOpen}
        onResultSelect={handleSearchResultSelect}
        searchFn={searchChats}
      />
    </>
  );
}

export default AppSidebar;
