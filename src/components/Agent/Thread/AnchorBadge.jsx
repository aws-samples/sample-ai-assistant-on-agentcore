import { useContext } from "react";
import { MessagesSquare } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { ChatSessionDataContext, ChatSessionFunctionsContext } from "../ChatContext";

/**
 * A small badge appearing near an AI message turn to surface threads anchored
 * to that turn. Clicking a thread opens it in the ThreadDrawer.
 *
 * Markdown-AST level highlighting (wrapping the exact [start,end] range in
 * <mark>) is deferred — react-markdown makes AST transforms fragile against
 * streaming partial output. The badge covers the primary "how do I reopen my
 * thread?" use case reliably.
 */
export default function AnchorBadge({ sessionId, turnIndex }) {
  const data = useContext(ChatSessionDataContext);
  const functions = useContext(ChatSessionFunctionsContext);

  const session = data?.sessions?.get(sessionId);
  if (!session) return null;

  const anchors = session.threadAnchors;
  if (!anchors || anchors.size === 0) return null;

  const turnAnchors = [];
  for (const a of anchors.values()) {
    if (a.turn_index === turnIndex) turnAnchors.push(a);
  }
  if (turnAnchors.length === 0) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center"
          aria-label={`${turnAnchors.length} thread${turnAnchors.length === 1 ? "" : "s"}`}
        >
          <Badge variant="secondary" className="gap-1 cursor-pointer">
            <MessagesSquare className="h-3 w-3" />
            {turnAnchors.length} {turnAnchors.length === 1 ? "thread" : "threads"}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-80">
        <DropdownMenuLabel>Threads on this response</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {turnAnchors.map((a) => (
          <DropdownMenuItem
            key={a.thread_id}
            onSelect={() => functions.setActiveThread(sessionId, a.thread_id)}
            className="flex-col items-start gap-0.5"
          >
            <div className="text-sm font-medium truncate w-full">{a.title || "Thread"}</div>
            {a.quoted_text && (
              <div className="text-xs text-muted-foreground italic line-clamp-2 w-full">
                "{a.quoted_text}"
              </div>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
