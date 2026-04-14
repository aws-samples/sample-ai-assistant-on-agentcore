import { useState, useEffect, useCallback, useRef } from "react";
import { Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import TextContent from "@/components/Agent/TextContent";
import { getTaskExecution } from "@/services/scheduledTasksService";

export function ExecutionOutputSheet({ execution, onClose, onConvertToChat, converting }) {
  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sheetWidth, setSheetWidth] = useState(576);
  const [dragging, setDragging] = useState(false);
  const isDragging = useRef(false);

  useEffect(() => {
    if (!execution) return;
    setLoading(true);
    setOutput(null);
    getTaskExecution(execution.job_id, execution.execution_id)
      .then((data) => setOutput(data.execution?.output || "No output"))
      .catch((err) => {
        console.error('Failed to load execution output:', err);
        setOutput('Failed to load output: ' + (err.message || 'Unknown error'));
      })
      .finally(() => setLoading(false));
  }, [execution]);

  const handleOpenChange = (open) => {
    if (!open) {
      onClose();
      setOutput(null);
      setLoading(true);
    }
  };

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    isDragging.current = true;
    setDragging(true);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.min(
        Math.max(window.innerWidth - moveEvent.clientX, 360),
        window.innerWidth * 0.9
      );
      setSheetWidth(newWidth);
    };

    const onMouseUp = () => {
      isDragging.current = false;
      setDragging(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  return (
    <Sheet open={!!execution} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className={`exec-output-sheet flex flex-col overflow-visible ${dragging ? "is-dragging" : ""}`}
        style={{ "--sheet-width": `${sheetWidth}px` }}
      >
        <div
          className={`exec-output-drag-handle ${dragging ? "active" : ""}`}
          onMouseDown={onDragStart}
        />
        <SheetHeader className="flex-shrink-0">
          <div className="flex items-center gap-3 pr-8">
            <SheetTitle>Execution Output</SheetTitle>
            {execution?.status === "completed" && onConvertToChat && (
              <>
                <Separator orientation="vertical" className="h-5" />
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  disabled={converting}
                  onClick={() => onConvertToChat(execution)}
                >
                  {converting ? (
                    <Loader2 className="animate-spin mr-1" size={14} />
                  ) : (
                    <MessageSquare size={14} className="mr-1" />
                  )}
                  Continue in chat
                </Button>
              </>
            )}
          </div>
          <SheetDescription>
            {execution?.started_at ? new Date(execution.started_at).toLocaleString() : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto mt-4 text-sm leading-relaxed">
          {loading ? (
            <div className="flex flex-col gap-3 pt-2">
              {[100, 90, 75, 100, 85, 60].map((w, i) => (
                <Skeleton
                  key={i}
                  className="h-4 exec-output-skeleton"
                  style={{ width: `${w}%`, animationDelay: `${i * 60}ms` }}
                />
              ))}
            </div>
          ) : (
            <div className="exec-output-content markdown-content">
              <TextContent content={output || ""} />
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
