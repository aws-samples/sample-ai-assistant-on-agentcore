import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Loader2,
  Pencil,
  Play,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  getScheduledTask,
  listTaskExecutions,
  triggerScheduledTask,
} from "@/services/scheduledTasksService";
import { convertExecutionToChat } from "@/components/Agent/context/api";
import { DataTable, SortableHeader } from "./DataTable";
import { ExecutionOutputSheet } from "./ExecutionOutputSheet";
import { TaskForm } from "./TaskForm";

function StatusBadge({ status }) {
  return <span className={`st-status ${status}`}>{status}</span>;
}

function formatDuration(exec) {
  const started = exec.started_at ? new Date(exec.started_at) : null;
  const finished = exec.finished_at ? new Date(exec.finished_at) : null;
  const isRunning = exec.status === "running";
  let totalSec = null;
  if (started && finished) {
    totalSec = Math.round((finished - started) / 1000);
  } else if (isRunning && started) {
    totalSec = Math.round((Date.now() - started) / 1000);
  }
  if (totalSec == null) return "—";
  const suffix = isRunning ? "…" : "";
  return totalSec >= 60
    ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s${suffix}`
    : `${totalSec}s${suffix}`;
}

const PROMPT_MAX_LINES = 5;

function PromptSection({ prompt }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const { displayContent, shouldTruncate } = useMemo(() => {
    const lines = (prompt || "").split("\n");
    const shouldTruncate = lines.length > PROMPT_MAX_LINES;
    const displayContent =
      shouldTruncate && !isExpanded ? lines.slice(0, PROMPT_MAX_LINES).join("\n") : prompt;
    return { displayContent, shouldTruncate };
  }, [prompt, isExpanded]);

  return (
    <div className="mb-6">
      <h2 className="st-section-title">Prompt</h2>
      <div
        className="st-detail-prompt"
        style={
          shouldTruncate && !isExpanded
            ? {
                WebkitMaskImage:
                  "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
                maskImage: "linear-gradient(to bottom, black 0%, black 70%, transparent 100%)",
              }
            : undefined
        }
      >
        {displayContent}
      </div>
      {shouldTruncate && (
        <button
          onClick={() => setIsExpanded((v) => !v)}
          className="mt-1 flex items-center gap-0.5 px-1.5 py-1 rounded-[4px] text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          style={{ fontSize: "11px", lineHeight: 1 }}
        >
          {isExpanded ? "Show less" : "Show more"}
          {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
        </button>
      )}
    </div>
  );
}

export function TaskDetail({ jobId, onBack }) {
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [converting, setConverting] = useState(null);
  const [viewExec, setViewExec] = useState(null);
  const [triggering, setTriggering] = useState(false);
  const [editing, setEditing] = useState(false);
  const [execCursor, setExecCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadExecutions = useCallback(async () => {
    try {
      const data = await listTaskExecutions(jobId);
      setExecutions(data.executions || []);
      setExecCursor(data.cursor || null);
    } catch (err) {
      console.error('Failed to load executions:', err);
    }
  }, [jobId]);

  const loadMoreExecutions = async () => {
    if (!execCursor) return;
    setLoadingMore(true);
    try {
      const data = await listTaskExecutions(jobId, 20, execCursor);
      setExecutions((prev) => [...prev, ...(data.executions || [])]);
      setExecCursor(data.cursor || null);
    } catch (err) {
      console.error('Failed to load executions:', err);
    }
    setLoadingMore(false);
  };

  useEffect(() => {
    Promise.all([getScheduledTask(jobId), listTaskExecutions(jobId)])
      .then(([jobData, execData]) => {
        setJob(jobData.job);
        setExecutions(execData.executions || []);
        setExecCursor(execData.cursor || null);
      })
      .catch(() => toast.error("Failed to load job details"))
      .finally(() => setLoading(false));
  }, [jobId]);

  // Auto-poll while any execution is running
  useEffect(() => {
    const hasRunning = executions.some((e) => e.status === "running");
    if (!hasRunning) return;
    const interval = setInterval(loadExecutions, 5000);
    return () => clearInterval(interval);
  }, [executions, loadExecutions]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await triggerScheduledTask(jobId);
      toast.success("Task triggered");
      // Optimistic: insert a placeholder running entry immediately
      setExecutions((prev) => [
        {
          job_id: jobId,
          execution_id: `pending-${Date.now()}`,
          status: "running",
          started_at: new Date().toISOString(),
          finished_at: null,
        },
        ...prev,
      ]);
      // Poll to replace the placeholder with the real entry
      setTimeout(loadExecutions, 2000);
      setTimeout(loadExecutions, 5000);
    } catch (err) {
      console.error('Failed to trigger task:', err);
      toast.error("Failed to trigger task");
    } finally {
      setTriggering(false);
    }
  };

  const handleConvertToChat = async (exec) => {
    setConverting(exec.execution_id);
    try {
      const result = await convertExecutionToChat(exec.execution_id, job?.name);
      const newSessionId = result.session_id;
      window.dispatchEvent(
        new CustomEvent("chatCreated", {
          detail: {
            sessionId: newSessionId,
            description: `${job?.name}`,
            createdAt: new Date().toISOString(),
          },
        })
      );
      navigate(`/chat/${newSessionId}`);
    } catch (err) {
      console.error('Failed to convert execution to chat:', err);
      toast.error("Failed to convert execution to chat");
    } finally {
      setConverting(null);
    }
  };

  const execColumns = useMemo(
    () => [
      {
        accessorKey: "started_at",
        header: ({ column }) => <SortableHeader column={column}>Time</SortableHeader>,
        cell: ({ row }) => {
          const val = row.getValue("started_at");
          return val ? new Date(val).toLocaleString() : "—";
        },
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => {
          const status = row.getValue("status");
          const isRunning = status === "running";
          return (
            <span className={`exec-status ${status}`}>
              {isRunning && <Loader2 className="animate-spin inline mr-1" size={12} />}
              {status}
            </span>
          );
        },
      },
      {
        id: "duration",
        header: "Duration",
        cell: ({ row }) => formatDuration(row.original),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const exec = row.original;
          if (exec.status === "running") return null;
          return (
            <Button
              variant="ghost"
              size="sm"
              title="View output"
              onClick={(e) => {
                e.stopPropagation();
                setViewExec(exec);
              }}
            >
              <Eye size={14} />
            </Button>
          );
        },
      },
    ],
    [setViewExec]
  );

  if (!job && !loading) return null;

  return (
    <div className="st-page">
      <div className="st-header">
        <div className="st-header-left">
          <button className="st-detail-back" onClick={onBack}>
            <ChevronLeft size={16} /> Back to Scheduled Tasks
          </button>
        </div>
      </div>
      <div className="st-scroll">
        <div className="st-content">
          {loading ? (
            <div className="flex flex-col gap-5">
              {/* Title row skeleton */}
              <div className="flex items-center gap-3">
                <Skeleton className="h-6 w-48" />
                <Skeleton className="h-8 w-20" />
                <Skeleton className="h-8 w-24" />
              </div>
              {/* Info grid skeleton */}
              <div className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Fragment key={i}>
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-40" />
                  </Fragment>
                ))}
              </div>
              {/* Prompt skeleton */}
              <div>
                <Skeleton className="h-4 w-16 mb-2" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
              {/* Execution table skeleton */}
              <div>
                <Skeleton className="h-4 w-32 mb-3" />
                <div className="flex flex-col gap-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="flex gap-4 px-2">
                      <Skeleton className="h-4 w-[35%]" />
                      <Skeleton className="h-4 w-[20%]" />
                      <Skeleton className="h-4 w-[15%]" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="st-detail-title-row">
                <h1>{job.name}</h1>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                  <Pencil size={14} className="mr-1" /> Edit
                </Button>
                <Button size="sm" variant="outline" onClick={handleTrigger} disabled={triggering}>
                  {triggering ? (
                    <Loader2 className="animate-spin mr-1" size={14} />
                  ) : (
                    <Play size={14} className="mr-1" />
                  )}
                  Run Now
                </Button>
              </div>

              <dl className="st-detail-info">
                <dt>Schedule</dt>
                <dd>{job.schedule_expression}</dd>
                <dt>Timezone</dt>
                <dd>{job.timezone || "UTC"}</dd>
                <dt>Status</dt>
                <dd>
                  <StatusBadge status={job.status} />
                </dd>
                <dt>Created</dt>
                <dd>{new Date(job.created_at).toLocaleString()}</dd>
              </dl>

              <PromptSection prompt={job.prompt} />

              <h2 className="st-section-title">Execution History</h2>
              <DataTable
                columns={execColumns}
                data={executions}
                hoverRows={false}
                emptyMessage="No executions yet."
              />

              {execCursor && (
                <div className="flex justify-center mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={loadMoreExecutions}
                    disabled={loadingMore}
                  >
                    {loadingMore && <Loader2 className="animate-spin mr-1" size={14} />}
                    Load More
                  </Button>
                </div>
              )}

              <ExecutionOutputSheet
                execution={viewExec}
                onClose={() => setViewExec(null)}
                onConvertToChat={handleConvertToChat}
                converting={!!converting}
              />
            </>
          )}
        </div>
      </div>

      {job && (
        <TaskForm
          open={editing}
          onClose={() => setEditing(false)}
          onSave={async () => {
            const data = await getScheduledTask(jobId);
            setJob(data.job);
          }}
          editJob={job}
        />
      )}
    </div>
  );
}
