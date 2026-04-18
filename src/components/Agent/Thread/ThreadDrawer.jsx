import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Trash2, X } from "lucide-react";
import ChatContent from "../ChatContent";
import ChatInput from "../ChatInput";
import { ScrollButton } from "../ScrollButton";
import { ChatSessionDataContext, ChatSessionFunctionsContext } from "../ChatContext";
import { threadSessionId, THREAD_DRAFT_ID, THREAD_PENDING_ID } from "../useChatSessionFunctions";

/**
 * Right-side drawer rendering the currently-active Thread of `sessionId`.
 *
 * A Thread is stored as a synthetic session in the top-level sessions Map
 * (see useChatSessionFunctions.threadSessionId), so this drawer can simply
 * render the same ChatContent component the main chat uses. That gives us
 * the full main-chat rendering pipeline (reasoning blocks, tool calls,
 * canvas indicators, message builder) for free.
 */
export default function ThreadDrawer({ sessionId, user = null }) {
  const data = useContext(ChatSessionDataContext);
  const functions = useContext(ChatSessionFunctionsContext);
  const session = data?.sessions?.get(sessionId);
  const activeThreadId = session?.activeThreadId || null;
  const isDraft = activeThreadId === THREAD_DRAFT_ID;
  const isPending = activeThreadId === THREAD_PENDING_ID;
  const isSpecial = isDraft || isPending;
  const draftThread = session?.draftThread || null;
  const anchor = activeThreadId && !isSpecial ? session?.threadAnchors?.get(activeThreadId) : null;

  const tsid = activeThreadId && !isSpecial ? threadSessionId(sessionId, activeThreadId) : null;
  const threadSession = tsid ? data?.sessions?.get(tsid) : null;
  const threadTurns = threadSession?.chatTurns ?? [];
  const threadIsStreaming = !!threadSession?.isStreaming;
  const threadError = threadSession?.error ?? null;

  const open = !!activeThreadId;
  const scrollContainerRef = useRef(null);
  const fetchedRef = useRef(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Lazy-load history on first open if the synthetic session is empty.
  useEffect(() => {
    if (!open || !activeThreadId) return;
    if (fetchedRef.current.has(activeThreadId)) return;
    fetchedRef.current.add(activeThreadId);
    if (!threadSession || threadTurns.length === 0) {
      setIsLoading(true);
      functions
        .fetchThread(sessionId, activeThreadId)
        .catch(() => {})
        .finally(() => setIsLoading(false));
    }
  }, [open, activeThreadId, threadSession, threadTurns.length, functions, sessionId]);

  // Auto-scroll only on load-complete or new user turn — not on streaming
  // tokens. ChatContent's own auto-scroll is disabled via noopScroll below.
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading) {
      requestAnimationFrame(() => scrollToBottom(false));
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading]);

  const prevUserTurnCountRef = useRef(0);
  useEffect(() => {
    if (threadTurns.length > prevUserTurnCountRef.current) {
      requestAnimationFrame(() => scrollToBottom(false));
    }
    prevUserTurnCountRef.current = threadTurns.length;
  }, [threadTurns.length]);

  useEffect(() => {
    prevUserTurnCountRef.current = threadTurns.length;
    prevLoadingRef.current = false;
  }, [activeThreadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Callback ref: the Drawer portal mounts asynchronously, so a regular ref
  // is null on first useEffect. This wires up the scroll listener the moment
  // the element appears.
  const scrollObserverCleanup = useRef(null);

  const scrollContainerCallbackRef = useCallback(
    (el) => {
      if (scrollObserverCleanup.current) {
        scrollObserverCleanup.current();
        scrollObserverCleanup.current = null;
      }

      scrollContainerRef.current = el;

      if (!el) return;

      // Show the button when the last real content (the .chat-buttons-row
      // after the final AI response) is within 10px of leaving the scroll
      // container's bottom edge. That bottom edge is where the ChatInput
      // sits, so this fires right as content "goes behind" the input.
      let rafId = null;
      const compute = () => {
        rafId = null;
        const rows = el.querySelectorAll(".chat-buttons-row");
        const lastRow = rows.length ? rows[rows.length - 1] : null;
        if (!lastRow) {
          setShowScrollButton((prev) => (prev === false ? prev : false));
          return;
        }
        const containerBottom = el.getBoundingClientRect().bottom;
        const rowBottom = lastRow.getBoundingClientRect().bottom;
        const next = rowBottom >= containerBottom - 10;
        setShowScrollButton((prev) => (prev === next ? prev : next));
      };
      const onScroll = () => {
        if (rafId != null) return;
        rafId = requestAnimationFrame(compute);
      };

      el.addEventListener("scroll", onScroll, { passive: true });
      onScroll();

      scrollObserverCleanup.current = () => {
        el.removeEventListener("scroll", onScroll);
        if (rafId != null) cancelAnimationFrame(rafId);
      };
    },
    [activeThreadId]
  );

  const handleOpenChange = (nextOpen) => {
    if (!nextOpen) {
      if (isDraft) functions.setDraftThread(sessionId, null);
      functions.setActiveThread(sessionId, null);
    }
  };

  const handleSendFromInput = async (messageData) => {
    if (!activeThreadId) return;

    // Draft mode: first send creates the thread + streams the first response.
    if (isDraft && draftThread) {
      functions.setActiveThread(sessionId, THREAD_PENDING_ID);
      try {
        await functions.createThread({
          sessionId,
          ...draftThread,
          prompt: messageData.message,
        });
      } catch (err) {
        console.error("createThread failed:", err);
        functions.setActiveThread(sessionId, null);
      }
      return;
    }

    if (isSpecial) return;

    try {
      await functions.sendThreadMessage({
        sessionId,
        threadId: activeThreadId,
        prompt: messageData.message,
      });
    } catch (err) {
      console.error("sendThreadMessage failed:", err);
    }
  };

  const handleStop = async () => {
    if (!activeThreadId) return;
    await functions.stopThreadStream(sessionId, activeThreadId);
  };

  const handleDelete = () => {
    if (!activeThreadId) return;
    setDeleteConfirmOpen(true);
  };

  const confirmDelete = async () => {
    if (!activeThreadId) return;
    setDeleting(true);
    try {
      await functions.deleteThread(sessionId, activeThreadId);
      setDeleteConfirmOpen(false);
    } catch (err) {
      console.error("Failed to delete thread:", err);
    } finally {
      setDeleting(false);
    }
  };

  const quoteTitle =
    isDraft || isPending ? draftThread?.quotedText || "Thread" : anchor?.quoted_text || "Thread";

  // No-op passed to ChatContent so ChatMessage's auto-scroll-on-mount logic
  // is inert inside the drawer. All scrolling is explicit here.
  const noopScroll = useCallback(() => {}, []);

  // "Scroll to bottom" in the drawer means "scroll so the latest turn sits
  // at the top of the view" — matching the main chat's behaviour where each
  // new turn reserves ~100vh of space under itself. If no turns are
  // rendered yet, fall back to the absolute bottom.
  const scrollToBottom = useCallback((smooth = false) => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const maxScroll = el.scrollHeight - el.clientHeight;
    el.scrollTo({
      top: maxScroll - 16,
      behavior: smooth ? "smooth" : "auto",
    });
    setShowScrollButton(false);
  }, []);

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      direction="right"
      shouldScaleBackground={false}
    >
      <DrawerContent
        direction="right"
        showHandle={false}
        className="p-0 !inset-y-2 !right-2 !w-[680px] !max-w-[calc(100vw-1.5rem)] !ml-0 !h-auto !z-[60] !border-none rounded-2xl shadow-2xl overflow-hidden"
      >
        <DrawerHeader className="flex items-center justify-between p-4 gap-3 relative">
          <div className="flex-1 min-w-0">
            <DrawerTitle
              className="text-sm font-medium italic"
              style={{
                display: "-webkit-box",
                WebkitLineClamp: 2,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
                wordBreak: "break-word",
              }}
              title={anchor?.quoted_text || ""}
            >
              "{quoteTitle}"
            </DrawerTitle>
          </div>
          <div className="flex items-center gap-1 pl-2 shrink-0">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDelete}
              disabled={isDraft || isPending}
              aria-label="Delete thread"
              title="Delete thread"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="flex-1 min-h-0 relative">
          <div className="thread-header-fade" />
          <div
            ref={scrollContainerCallbackRef}
            className="absolute inset-0 overflow-y-auto px-4 py-4 markdown-content thread-drawer-content"
            style={{ userSelect: "text", WebkitUserSelect: "text" }}
          >
            {isDraft ? (
              <div className="text-sm text-muted-foreground py-8 text-center">
                Ask a question about the highlighted text.
              </div>
            ) : isLoading && threadTurns.length === 0 ? (
              <ThreadLoadingSkeleton />
            ) : (
              <>
                {threadTurns.length === 0 && !threadIsStreaming && !threadError && !isPending && (
                  <div className="text-sm text-muted-foreground py-8 text-center">
                    No messages yet.
                  </div>
                )}
                <ChatContent
                  chatTurns={threadTurns}
                  streaming={threadIsStreaming}
                  user={user}
                  // No-op scroll + skipAutoScroll: the drawer owns scrolling
                  // (only on load / new user turn / button click), so suppress
                  // ChatMessage's own auto-scroll-on-mount behaviour which would
                  // otherwise yank the view to the bottom on every render.
                  scroll={noopScroll}
                  isParentFirstMount={false}
                  sessionId={tsid}
                  highlightedMessageIndex={null}
                  skipAutoScroll
                  boundProject={null}
                />
                {threadError && !threadIsStreaming && (
                  <div className="mt-2 text-xs text-destructive">{threadError}</div>
                )}
              </>
            )}
          </div>

          {showScrollButton && (
            <div className="thread-scroll-button-wrap">
              <ScrollButton onClick={() => scrollToBottom(true)} direction="bottom" />
            </div>
          )}
        </div>

        <div className="px-2 pb-2">
          <ChatInput
            onSendMessage={handleSendFromInput}
            onStopStreaming={handleStop}
            placeholder={threadIsStreaming ? "Sparky is replying…" : "Follow-up message…"}
            autoFocus={open}
            isStreaming={threadIsStreaming || isPending}
            disabled={isPending}
            sessionId={tsid}
            threadMode
            actionButtons={[]}
          />
        </div>
      </DrawerContent>

      <Dialog open={deleteConfirmOpen} onOpenChange={(v) => !deleting && setDeleteConfirmOpen(v)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete thread</DialogTitle>
            <DialogDescription>
              This will permanently delete this thread and its side-conversation. This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin mr-1" size={14} />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Drawer>
  );
}

/**
 * Placeholder rendered while the thread's history is being fetched. Mimics
 * the rhythm of a user bubble followed by an assistant response so the layout
 * doesn't jump when the real messages arrive.
 */
function ThreadLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-6 py-2">
      <div className="flex justify-end">
        <Skeleton className="h-10 w-[60%] rounded-2xl" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-6 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-[90%]" />
          <Skeleton className="h-3 w-[85%]" />
          <Skeleton className="h-3 w-[70%]" />
        </div>
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-[40%] rounded-2xl" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-6 w-6 rounded-full shrink-0" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3 w-[95%]" />
          <Skeleton className="h-3 w-[60%]" />
        </div>
      </div>
    </div>
  );
}
