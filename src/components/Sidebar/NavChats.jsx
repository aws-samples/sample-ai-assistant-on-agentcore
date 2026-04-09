import { useState, useEffect, useCallback, forwardRef, useImperativeHandle, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Trash2, Pencil, Loader2, Ellipsis, Star, StarOff } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  fetchChatHistory,
  fetchBookmarkedChatHistory,
  toggleBookmarkChat,
  generateDescription,
  deleteChatSession,
  renameChatSession,
} from "@/components/Agent/context/api";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePrefetchSessions } from "@/components/Agent/usePrefetchSessions";

/**
 * Skeleton loader for chat items - matches chat-item height
 */
const ChatItemSkeleton = () => (
  <div className="chat-item flex items-center px-1.5">
    <Skeleton className="h-5 flex-1" />
  </div>
);

/**
 * NavChats component renders the chat history in the sidebar.
 * Fetches chat history from the server instead of localStorage.
 * Only visible when sidebar is expanded.
 *
 * Server-based chat history flow:
 * - Fetches history on mount
 * - Listens for chatHistoryUpdated events to refresh after new chat/description generation
 * - Exposes refreshHistory method via ref for parent components
 *
 */
export const NavChats = forwardRef(function NavChats({ onChatSelect, onHistoryUpdate }, ref) {
  const navigate = useNavigate();
  const location = useLocation();
  const { state } = useSidebar();
  const [chatToDelete, setChatToDelete] = useState(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Track newly added chat for animation
  const [newChatId, setNewChatId] = useState(null);

  // Rename state
  const [editingChatId, setEditingChatId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef(null);

  // Server-fetched chat history state with pagination
  const [chats, setChats] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);

  // Bookmarked chats state (loaded in full, no pagination)
  const [bookmarkedChats, setBookmarkedChats] = useState([]);

  // Ref for scroll container to detect when user scrolls to bottom
  const scrollContainerRef = useRef(null);

  // Guard to prevent duplicate fetchChatHistory calls from React strict mode or effect re-runs
  const fetchedRef = useRef(false);

  const isCollapsed = state === "collapsed";

  // Derive active session ID from URL
  const activeSessionId = location.pathname.startsWith("/chat/")
    ? location.pathname.slice("/chat/".length)
    : null;

  // Lazy-load session data when chat items scroll into view
  const getLazyRef = usePrefetchSessions();

  /**
   * Fetch initial chat history and bookmarked chats from server in parallel
   */
  const loadChatHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      const [result, bookmarkedResult] = await Promise.all([
        fetchChatHistory({ limit: 20 }),
        fetchBookmarkedChatHistory(),
      ]);

      // Transform non-bookmarked sessions
      const formattedChats = result.sessions.map((session) => ({
        id: session.session_id,
        title: session.description || "New Chat",
        createdAt: session.created_at,
        bookmarked: false,
      }));

      // Transform bookmarked sessions
      const formattedBookmarked = bookmarkedResult.sessions.map((session) => ({
        id: session.session_id,
        title: session.description || "New Chat",
        createdAt: session.created_at,
        bookmarked: true,
      }));

      setChats(formattedChats);
      setBookmarkedChats(formattedBookmarked);
      setCursor(result.cursor);
      setHasMore(result.has_more);

      // Notify parent of history update if callback provided
      if (onHistoryUpdate) {
        onHistoryUpdate([...formattedBookmarked, ...formattedChats]);
      }
    } catch (err) {
      console.error("Error fetching chat history:", err);
      toast.error("Failed to load chat history", { description: err.message });
      setChats([]);
      setBookmarkedChats([]);
    } finally {
      setIsLoading(false);
    }
  }, [onHistoryUpdate]);

  /**
   * Load more chats when scrolling (infinite scroll)
   */
  const loadMoreChats = useCallback(async () => {
    if (!hasMore || isLoadingMore || !cursor) return;

    try {
      setIsLoadingMore(true);
      const result = await fetchChatHistory({ limit: 20, cursor });

      const formattedChats = result.sessions.map((session) => ({
        id: session.session_id,
        title: session.description || "New Chat",
        createdAt: session.created_at,
        bookmarked: false,
      }));

      setChats((prev) => [...prev, ...formattedChats]);
      setCursor(result.cursor);
      setHasMore(result.has_more);
    } catch (err) {
      console.error("Error loading more chats:", err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [hasMore, isLoadingMore, cursor]);

  /**
   * Add a new chat to the top of the list without refreshing
   */
  const addChat = useCallback((newChat) => {
    setChats((prev) => {
      // Check if chat already exists
      if (prev.some((chat) => chat.id === newChat.id)) {
        // Update existing chat's title
        return prev.map((chat) =>
          chat.id === newChat.id ? { ...chat, title: newChat.title } : chat
        );
      }
      // Add new chat at the top with animation
      setNewChatId(newChat.id);
      // Clear animation state after animation completes
      setTimeout(() => setNewChatId(null), 500);
      return [newChat, ...prev];
    });
  }, []);

  // Expose methods via ref for parent components
  useImperativeHandle(
    ref,
    () => ({
      refreshHistory: loadChatHistory,
      addChat,
    }),
    [loadChatHistory, addChat]
  );

  // Load chat history on mount
  useEffect(() => {
    // Guard against duplicate calls - only fetch once on initial mount
    if (fetchedRef.current) {
      return;
    }
    fetchedRef.current = true;
    loadChatHistory();
  }, [loadChatHistory]);

  // Listen for new chat created events (append instead of refresh)
  useEffect(() => {
    const handleNewChat = (event) => {
      const { sessionId, description, createdAt } = event.detail || {};
      if (sessionId) {
        addChat({
          id: sessionId,
          title: description || "New Chat",
          createdAt: createdAt || new Date().toISOString(),
        });
      }
    };

    // Listen for full refresh events (e.g., after delete)
    const handleHistoryUpdate = () => {
      loadChatHistory();
    };

    window.addEventListener("chatCreated", handleNewChat);
    window.addEventListener("chatHistoryUpdated", handleHistoryUpdate);
    return () => {
      window.removeEventListener("chatCreated", handleNewChat);
      window.removeEventListener("chatHistoryUpdated", handleHistoryUpdate);
    };
  }, [loadChatHistory, addChat]);

  const handleChatClick = (chat) => {
    // Don't navigate if we're editing this chat's title
    if (editingChatId === chat.id) return;
    if (onChatSelect) {
      onChatSelect(chat);
    }
    navigate(`/chat/${chat.id}`);
  };

  const handleDeleteClick = (e, chat) => {
    e.stopPropagation();
    setChatToDelete(chat);
  };

  /**
   * Start inline rename for a chat
   */
  const handleRenameClick = (e, chat) => {
    e.stopPropagation();
    setEditingChatId(chat.id);
    setEditingTitle(chat.title === "New Chat" ? "" : chat.title);
    // Focus the input after render
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  /**
   * Commit the rename to the server and update local state
   */
  const handleRenameSubmit = async (chatId) => {
    const trimmed = editingTitle.trim();
    if (!trimmed || isRenaming) {
      // If empty, cancel the edit
      setEditingChatId(null);
      return;
    }

    // Check if title actually changed
    const chat = chats.find((c) => c.id === chatId) || bookmarkedChats.find((c) => c.id === chatId);
    if (chat && chat.title === trimmed) {
      setEditingChatId(null);
      return;
    }

    try {
      setIsRenaming(true);
      await renameChatSession(chatId, trimmed);

      // Update local state in both lists
      setChats((prev) => prev.map((c) => (c.id === chatId ? { ...c, title: trimmed } : c)));
      setBookmarkedChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, title: trimmed } : c))
      );
    } catch (err) {
      console.error("Error renaming chat:", err);
      toast.error("Failed to rename chat", { description: err.message });
    } finally {
      setIsRenaming(false);
      setEditingChatId(null);
    }
  };

  /**
   * Cancel rename and revert
   */
  const handleRenameCancel = () => {
    setEditingChatId(null);
    setEditingTitle("");
  };

  /**
   * Handle keydown events in the rename input
   */
  const handleRenameKeyDown = (e, chatId) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleRenameSubmit(chatId);
    } else if (e.key === "Escape") {
      e.preventDefault();
      handleRenameCancel();
    }
  };

  /**
   * Delete chat from server and update local state
   */
  const handleConfirmDelete = async () => {
    if (!chatToDelete) return;

    try {
      setIsDeleting(true);

      // Call server endpoint to delete
      await deleteChatSession(chatToDelete.id);

      // Remove from local state on success (could be in either list)
      setChats((prevChats) => prevChats.filter((chat) => chat.id !== chatToDelete.id));
      setBookmarkedChats((prev) => prev.filter((chat) => chat.id !== chatToDelete.id));

      // If we're currently viewing the deleted chat, navigate away
      if (location.pathname === `/chat/${chatToDelete.id}`) {
        navigate("/");
      }

      // Notify parent of history update
      if (onHistoryUpdate) {
        onHistoryUpdate(chats.filter((chat) => chat.id !== chatToDelete.id));
      }
    } catch (err) {
      console.error("Error deleting chat:", err);
      toast.error("Failed to delete chat", { description: err.message });
    } finally {
      setIsDeleting(false);
      setChatToDelete(null);
    }
  };

  const handleCancelDelete = () => {
    setChatToDelete(null);
  };

  /**
   * Optimistically toggle a chat's bookmark state.
   * Moves the chat between sections immediately, then calls the API.
   * Reverts on failure.
   */
  const handleToggleBookmark = async (e, chat, isCurrentlyBookmarked) => {
    e.stopPropagation();

    if (isCurrentlyBookmarked) {
      // Optimistically move from bookmarked → non-bookmarked
      setBookmarkedChats((prev) => prev.filter((c) => c.id !== chat.id));
      setChats((prev) => {
        const unbookmarked = { ...chat, bookmarked: false };
        // Insert in descending created_at order
        const idx = prev.findIndex((c) => c.createdAt < unbookmarked.createdAt);
        if (idx === -1) return [...prev, unbookmarked];
        return [...prev.slice(0, idx), unbookmarked, ...prev.slice(idx)];
      });
    } else {
      // Optimistically move from non-bookmarked → bookmarked
      setChats((prev) => prev.filter((c) => c.id !== chat.id));
      setBookmarkedChats((prev) => {
        const bookmarked = { ...chat, bookmarked: true };
        const idx = prev.findIndex((c) => c.createdAt < bookmarked.createdAt);
        if (idx === -1) return [...prev, bookmarked];
        return [...prev.slice(0, idx), bookmarked, ...prev.slice(idx)];
      });
    }

    try {
      await toggleBookmarkChat(chat.id);
    } catch (err) {
      // Revert on failure
      if (isCurrentlyBookmarked) {
        setChats((prev) => prev.filter((c) => c.id !== chat.id));
        setBookmarkedChats((prev) => {
          const restored = { ...chat, bookmarked: true };
          const idx = prev.findIndex((c) => c.createdAt < restored.createdAt);
          if (idx === -1) return [...prev, restored];
          return [...prev.slice(0, idx), restored, ...prev.slice(idx)];
        });
      } else {
        setBookmarkedChats((prev) => prev.filter((c) => c.id !== chat.id));
        setChats((prev) => {
          const restored = { ...chat, bookmarked: false };
          const idx = prev.findIndex((c) => c.createdAt < restored.createdAt);
          if (idx === -1) return [...prev, restored];
          return [...prev.slice(0, idx), restored, ...prev.slice(idx)];
        });
      }

      const errorMessage = err.message || "";
      if (errorMessage.includes("bookmark_limit_reached")) {
        toast.error("You've reached the maximum of 50 bookmarked chats");
      } else {
        toast.error("Failed to update bookmark", { description: err.message });
      }
    }
  };

  const isActive = (chatId) => {
    return location.pathname === `/chat/${chatId}`;
  };

  // Handle scroll to load more - must be before early returns to maintain hook order
  const handleScroll = useCallback(
    (e) => {
      const { scrollTop, scrollHeight, clientHeight } = e.target;
      // Load more when user scrolls within 50px of bottom
      if (scrollHeight - scrollTop - clientHeight < 50) {
        loadMoreChats();
      }
    },
    [loadMoreChats]
  );

  /**
   * Check if container needs more content to be scrollable
   * If content doesn't fill the viewport but there's more data, auto-fetch
   */
  const checkAndLoadMore = useCallback(() => {
    const container = scrollContainerRef.current;
    if (!container || !hasMore || isLoadingMore || isLoading) return;

    // If scrollHeight <= clientHeight, content doesn't overflow (no scrollbar)
    // In this case, automatically load more if available
    if (container.scrollHeight <= container.clientHeight) {
      loadMoreChats();
    }
  }, [hasMore, isLoadingMore, isLoading, loadMoreChats]);

  // Check if we need to load more after initial load or after loading more
  useEffect(() => {
    // Small delay to allow DOM to update after render
    const timeoutId = setTimeout(checkAndLoadMore, 100);
    return () => clearTimeout(timeoutId);
  }, [chats.length, isLoadingMore, checkAndLoadMore]);

  // Use ResizeObserver to detect zoom/resize changes and load more if needed
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      // Debounce the check to avoid excessive calls during resize
      checkAndLoadMore();
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [checkAndLoadMore]);

  // Truncate title to fit in sidebar - increased max length
  const truncateTitle = (title, maxLength = 28) => {
    if (!title) return "New Chat";
    if (title.length <= maxLength) return title;
    return title.substring(0, maxLength) + "...";
  };

  /**
   * Renders a single chat item row with inline rename and optional dropdown menu.
   * Shared between the bookmarked and non-bookmarked sections.
   */
  const renderChatItem = (chat, { isBookmarked = false, showDropdown = true } = {}) => (
    <SidebarMenuItem key={chat.id} className={chat.id === newChatId ? "animate-slide-in" : ""}>
      <div
        ref={getLazyRef(chat.id)}
        onClick={() => handleChatClick(chat)}
        className={`chat-item group/chat-item flex items-center justify-between w-full px-1.5 py-1 text-xs rounded cursor-pointer transition-colors
          ${isActive(chat.id) ? "chat-item-active" : ""}
          ${editingChatId === chat.id ? "chat-item-editing" : ""}`}
      >
        {editingChatId === chat.id ? (
          <input
            ref={renameInputRef}
            type="text"
            value={editingTitle}
            onChange={(e) => setEditingTitle(e.target.value)}
            onBlur={() => handleRenameSubmit(chat.id)}
            onKeyDown={(e) => handleRenameKeyDown(e, chat.id)}
            onClick={(e) => e.stopPropagation()}
            className="chat-rename-input flex-1 text-xs bg-transparent outline-none border-none"
            maxLength={100}
            disabled={isRenaming}
          />
        ) : (
          <>
            <span className="truncate text-left flex-1">{truncateTitle(chat.title)}</span>
            {showDropdown && (
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <button
                    onClick={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover/chat-item:opacity-100 transition-opacity p-0.5 cursor-pointer rounded hover:bg-sidebar-accent"
                  >
                    <Ellipsis className="size-2.5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent side="right" align="start" className="min-w-[140px]">
                  {isBookmarked ? (
                    <DropdownMenuItem onClick={(e) => handleToggleBookmark(e, chat, true)}>
                      <StarOff className="size-3.5 mr-2" />
                      Remove Bookmark
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem onClick={(e) => handleToggleBookmark(e, chat, false)}>
                      <Star className="size-3.5 mr-2" />
                      Bookmark
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onClick={(e) => handleRenameClick(e, chat)}>
                    <Pencil className="size-3.5 mr-2" />
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => handleDeleteClick(e, chat)}
                    className="chat-menu-delete"
                  >
                    <Trash2 className="size-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </div>
    </SidebarMenuItem>
  );

  // Hide when collapsed
  if (isCollapsed) {
    return null;
  }

  return (
    <>
      <SidebarGroup className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div
          ref={scrollContainerRef}
          className="chat-list-scroll-container flex-1 min-h-0 overflow-y-auto"
          onScroll={handleScroll}
        >
          {/* Bookmarks section — only visible when there are bookmarked chats */}
          {bookmarkedChats.length > 0 && (
            <>
              <SidebarGroupLabel className="flex-shrink-0">
                <span className="text-xs">Bookmarks</span>
              </SidebarGroupLabel>
              <SidebarMenu>
                {bookmarkedChats.map((chat) =>
                  renderChatItem(chat, { isBookmarked: true, showDropdown: true })
                )}
              </SidebarMenu>
            </>
          )}

          {/* Recent chats section with infinite scroll */}
          <SidebarGroupLabel className="flex-shrink-0 mt-2">
            <span className="text-xs">Recent</span>
          </SidebarGroupLabel>
          {isLoading ? (
            <SidebarMenu className="pr-2">
              {[...Array(3)].map((_, i) => (
                <SidebarMenuItem key={i}>
                  <ChatItemSkeleton />
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          ) : chats.length === 0 ? (
            <div className="px-1.5 py-2 text-xs text-muted-foreground whitespace-nowrap">
              No chat history yet
            </div>
          ) : (
            <SidebarMenu className="pr-0.5">
              {chats.map((chat) =>
                renderChatItem(chat, { isBookmarked: false, showDropdown: true })
              )}
              {/* Skeleton loading for infinite scroll */}
              {isLoadingMore && (
                <>
                  {[...Array(3)].map((_, i) => (
                    <SidebarMenuItem key={`skeleton-${i}`}>
                      <ChatItemSkeleton />
                    </SidebarMenuItem>
                  ))}
                </>
              )}
            </SidebarMenu>
          )}
        </div>
      </SidebarGroup>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={chatToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            handleCancelDelete();
            // Fix Radix pointer-events lock when dialog opened from dropdown
            document.body.style.pointerEvents = "";
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.body.style.pointerEvents = "";
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete chat</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this chat?
              {chatToDelete && (
                <span className="block mt-2 font-medium text-foreground">
                  "{chatToDelete.title}"
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-row justify-end gap-2">
            <Button variant="ghost" onClick={handleCancelDelete} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? (
                <>
                  <Loader2 className="size-4 animate-spin mr-2" />
                  Deleting...
                </>
              ) : (
                "Delete"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
});

/**
 * Generate description for a chat session after first message.
 *
 * @param {string} sessionId - The session ID
 * @param {string} message - The first user message
 * @returns {Promise<string>} The generated description
 */
export const generateChatDescription = async (sessionId, message, projectId = null) => {
  try {
    const description = await generateDescription(sessionId, message, projectId);
    return description;
  } catch (error) {
    console.error("Error generating description:", error);
    // Fallback to truncated message on failure
    return message.length > 50 ? message.substring(0, 50) + "..." : message;
  }
};

export default NavChats;
