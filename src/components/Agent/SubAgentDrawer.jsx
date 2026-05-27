import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { X, Bot, User } from "lucide-react";
import TextContent from "./TextContent";

/**
 * Right-side drawer that displays a single sub-agent invocation: the request
 * the parent passed in and the markdown-rendered response that came back.
 *
 * Read-only — intentionally has no chat input. Sub-agents are stateless and
 * have no follow-up conversation.
 */
export default function SubAgentDrawer({ open, onOpenChange, request, response }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} direction="right" shouldScaleBackground={false}>
      <DrawerContent
        direction="right"
        showHandle={false}
        className="p-0 !inset-y-2 !right-2 !w-[680px] !max-w-[calc(100vw-1.5rem)] !ml-0 !h-auto !z-[60] !border-none rounded-2xl shadow-2xl overflow-hidden"
      >
        <DrawerHeader className="flex items-center justify-between p-4 gap-3">
          <div className="flex-1 min-w-0">
            <DrawerTitle className="text-sm font-medium">Sub-agent</DrawerTitle>
          </div>
          <DrawerClose asChild>
            <Button variant="ghost" size="icon" aria-label="Close">
              <X className="h-4 w-4" />
            </Button>
          </DrawerClose>
        </DrawerHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4 markdown-content">
          {request && (
            <section className="mb-6">
              <header className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
                <User size={14} />
                <span>Request</span>
              </header>
              <div className="rounded-lg bg-muted/50 p-3 text-sm whitespace-pre-wrap break-words">
                {request}
              </div>
            </section>
          )}

          <section>
            <header className="flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground mb-2">
              <Bot size={14} />
              <span>Response</span>
            </header>
            {response ? (
              <div style={{ userSelect: "text", WebkitUserSelect: "text" }}>
                <TextContent content={response} />
              </div>
            ) : (
              <div className="text-sm text-muted-foreground italic">No response yet.</div>
            )}
          </section>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
