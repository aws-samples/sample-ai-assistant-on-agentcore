import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Clock,
  Plus,
  Trash2,
  Pencil,
  Power,
  Loader2,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  Eye,
  Play,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  MessageSquare,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Separator } from "@/components/ui/separator";
import {
  listScheduledTasks,
  createScheduledTask,
  updateScheduledTask,
  deleteScheduledTask,
  toggleScheduledTask,
  triggerScheduledTask,
  getScheduledTask,
  listTaskExecutions,
  getTaskExecution,
} from "@/services/scheduledTasksService";
import { convertExecutionToChat } from "@/components/Agent/context/api";
import "./ScheduledTasksPage.css";
import TextContent from "@/components/Agent/TextContent";
import { Skeleton } from "@/components/ui/skeleton";

function StatusBadge({ status }) {
  return <span className={`st-status ${status}`}>{status}</span>;
}

function ExecutionOutputSheet({ execution, onClose, onConvertToChat, converting }) {
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
      .catch(() => setOutput("Failed to load output"))
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

function formatDuration(exec) {
  const started = exec.started_at ? new Date(exec.started_at) : null;
  const finished = exec.finished_at ? new Date(exec.finished_at) : null;
  const isRunning = exec.status === "running";
  const totalSec =
    started && finished
      ? Math.round((finished - started) / 1000)
      : isRunning && started
        ? Math.round((Date.now() - started) / 1000)
        : null;
  if (totalSec == null) return "—";
  const suffix = isRunning ? "…" : "";
  return totalSec >= 60
    ? `${Math.floor(totalSec / 60)}m ${totalSec % 60}s${suffix}`
    : `${totalSec}s${suffix}`;
}

function DataTable({ columns, data, onRowClick, hoverRows = true, emptyMessage = "No results." }) {
  const [sorting, setSorting] = useState([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={`${onRowClick ? "cursor-pointer" : ""} ${!hoverRows ? "hover:bg-transparent" : ""}`}
                onClick={() => onRowClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHeader({ column, children }) {
  const sorted = column.getIsSorted();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-0 h-8"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {children}
      {sorted === "asc" ? (
        <ArrowUp className="ml-1 h-3 w-3" strokeWidth={1.5} />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-1 h-3 w-3" strokeWidth={1.5} />
      ) : (
        <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />
      )}
    </Button>
  );
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

function TaskDetail({ jobId, onBack }) {
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
    } catch {
      /* ignore */
    }
  }, [jobId]);

  const loadMoreExecutions = async () => {
    if (!execCursor) return;
    setLoadingMore(true);
    try {
      const data = await listTaskExecutions(jobId, 20, execCursor);
      setExecutions((prev) => [...prev, ...(data.executions || [])]);
      setExecCursor(data.cursor || null);
    } catch {
      /* ignore */
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
    } catch {
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
    } catch {
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
    []
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
                  <React.Fragment key={i}>
                    <Skeleton className="h-4 w-16" />
                    <Skeleton className="h-4 w-40" />
                  </React.Fragment>
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

const DAYS_OF_WEEK = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
];

const WORKDAYS = new Set(["MON", "TUE", "WED", "THU", "FRI"]);

const TIMEZONES = [
  "UTC",
  "US/Eastern",
  "US/Central",
  "US/Mountain",
  "US/Pacific",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Paris",
  "Europe/Stockholm",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Kolkata",
  "Asia/Dubai",
  "Australia/Sydney",
  "Pacific/Auckland",
];

function detectTimezone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.includes(tz)) return tz;
  } catch {
    /* ignore */
  }
  return "UTC";
}

const defaults = () => ({
  frequency: "daily",
  interval: "1",
  time: "09:00",
  selectedDays: ["MON"],
  dayOfMonth: "1",
});

/** Try to parse an existing schedule_expression back into form state. */
function parseScheduleExpression(expr) {
  const d = defaults();
  if (!expr) return d;

  // rate(N minutes|hours|days)
  const rateMatch = expr.match(/^rate\((\d+)\s+(minute|hour|day)s?\)$/i);
  if (rateMatch) {
    const n = rateMatch[1];
    const unit = rateMatch[2].toLowerCase();
    if (unit === "minute") return { ...d, frequency: "minutes", interval: n };
    if (unit === "hour") return { ...d, frequency: "hours", interval: n };
    if (unit === "day") return { ...d, frequency: "days", interval: n };
  }

  // cron(min hour dom month dow year)
  const cronMatch = expr.match(/^cron\((\d+)\s+(\S+)\s+(\S+)\s+\*\s+(\S+)\s+\*\)$/);
  if (cronMatch) {
    const [, min, hourField, dom, dow] = cronMatch;
    // Every N days: cron(M H */N * ? *)
    const everyNMatch = dom.match(/^\*\/(\d+)$/);
    if (everyNMatch && dow === "?") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      return { ...d, frequency: "days", interval: everyNMatch[1], time };
    }
    // Daily
    if (dom === "*" && dow === "?") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      return { ...d, frequency: "daily", time };
    }
    // Monthly
    if (dow === "?" && dom !== "?" && dom !== "*") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      return { ...d, frequency: "monthly", time, dayOfMonth: dom };
    }
    // Weekly / Workdays
    if (dom === "?" && dow !== "?") {
      const time = `${hourField.padStart(2, "0")}:${min.padStart(2, "0")}`;
      const days = dow.split(",");
      const isWorkdays = days.length === 5 && days.every((day) => WORKDAYS.has(day));
      if (dow === "MON-FRI" || isWorkdays) {
        return { ...d, frequency: "workdays", time };
      }
      return { ...d, frequency: "weekly", time, selectedDays: days };
    }
  }

  // Fallback — daily
  return d;
}

/** Build schedule_expression from form state. */
function buildScheduleExpression({ frequency, interval, time, selectedDays, dayOfMonth }) {
  const [h, m] = (time || "09:00").split(":").map(Number);
  switch (frequency) {
    case "minutes": {
      const n = Math.max(1, parseInt(interval, 10) || 1);
      return `rate(${n} ${n === 1 ? "minute" : "minutes"})`;
    }
    case "hours": {
      const n = Math.max(1, parseInt(interval, 10) || 1);
      return `rate(${n} ${n === 1 ? "hour" : "hours"})`;
    }
    case "days": {
      const n = Math.max(1, parseInt(interval, 10) || 1);
      return `cron(${m} ${h} */${n} * ? *)`;
    }
    case "daily":
      return `cron(${m} ${h} * * ? *)`;
    case "workdays":
      return `cron(${m} ${h} ? * MON-FRI *)`;
    case "weekly": {
      const dow = selectedDays.length > 0 ? selectedDays.join(",") : "MON";
      return `cron(${m} ${h} ? * ${dow} *)`;
    }
    case "monthly":
      return `cron(${m} ${h} ${dayOfMonth} * ? *)`;
    default:
      return "";
  }
}

function TaskForm({ open, onClose, onSave, editJob }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [timezone, setTimezone] = useState(detectTimezone);
  const [saving, setSaving] = useState(false);

  // Schedule builder state
  const [frequency, setFrequency] = useState("daily");
  const [interval, setInterval] = useState("1");
  const [time, setTime] = useState("09:00");
  const [selectedDays, setSelectedDays] = useState(["MON"]);
  const [dayOfMonth, setDayOfMonth] = useState("1");

  const toggleDay = (day) => {
    setSelectedDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]
    );
  };

  useEffect(() => {
    if (editJob) {
      setName(editJob.name || "");
      setPrompt(editJob.prompt || "");
      setTimezone(editJob.timezone || "UTC");
      const parsed = parseScheduleExpression(editJob.schedule_expression);
      setFrequency(parsed.frequency);
      setInterval(parsed.interval);
      setTime(parsed.time);
      setSelectedDays(parsed.selectedDays);
      setDayOfMonth(parsed.dayOfMonth);
    } else {
      setName("");
      setPrompt("");
      setTimezone(detectTimezone());
      const d = defaults();
      setFrequency(d.frequency);
      setInterval(d.interval);
      setTime(d.time);
      setSelectedDays(d.selectedDays);
      setDayOfMonth(d.dayOfMonth);
    }
  }, [editJob, open]);

  const schedule = buildScheduleExpression({ frequency, interval, time, selectedDays, dayOfMonth });

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim() || !schedule.trim()) {
      toast.error("Name, prompt, and schedule are required");
      return;
    }
    setSaving(true);
    try {
      if (editJob) {
        await updateScheduledTask(editJob.job_id, {
          name,
          prompt,
          schedule_expression: schedule,
          timezone,
        });
        toast.success("Scheduled task updated");
      } else {
        await createScheduledTask({ name, prompt, schedule_expression: schedule, timezone });
        toast.success("Scheduled task created");
      }
      onSave();
      onClose();
    } catch (e) {
      toast.error(e.message || "Failed to save scheduled task");
    } finally {
      setSaving(false);
    }
  };

  const showInterval = frequency === "hours" || frequency === "days";
  const showTime = frequency !== "hours";
  const showDays = frequency === "weekly";
  const showDayOfMonth = frequency === "monthly";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editJob ? "Edit Scheduled Task" : "New Scheduled Task"}</DialogTitle>
          <DialogDescription>
            Schedule a prompt to run automatically on a recurring basis.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Name</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Daily report"
            />
          </div>

          <div>
            <Label>Repeat</Label>
            <Select value={frequency} onValueChange={setFrequency}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="hours">Every N hours</SelectItem>
                <SelectItem value="days">Every N days</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="workdays">Workdays (Mon–Fri)</SelectItem>
                <SelectItem value="weekly">Specific days of the week</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {showInterval && (
            <div>
              <Label>Every</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  className="w-20"
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                />
                <span className="text-sm text-muted-foreground">
                  {frequency === "hours" ? "hour(s)" : "day(s)"}
                </span>
              </div>
            </div>
          )}

          {showDays && (
            <div>
              <Label>Days</Label>
              <div className="flex gap-1 flex-wrap">
                {DAYS_OF_WEEK.map((d) => (
                  <Button
                    key={d.value}
                    type="button"
                    size="sm"
                    variant={selectedDays.includes(d.value) ? "default" : "outline"}
                    className="h-8 px-3 text-xs"
                    onClick={() => toggleDay(d.value)}
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {showDayOfMonth && (
            <div>
              <Label>Day of month</Label>
              <Input
                type="number"
                min="1"
                max="28"
                className="w-20"
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(e.target.value)}
              />
            </div>
          )}

          {showTime && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Time</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <Label>Timezone</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <div>
            <Label>Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Generate a daily summary of..."
              rows={5}
            />
          </div>

          {schedule && (
            <p className="text-xs text-muted-foreground">
              Expression: <code className="bg-muted px-1 py-0.5 rounded">{schedule}</code>
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="animate-spin mr-2" size={14} />}
            {editJob ? "Update" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function ScheduledTasksPage() {
  const { taskId } = useParams();
  const navigate = useNavigate();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [deleteJobId, setDeleteJobId] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const loadJobs = useCallback(async () => {
    try {
      const data = await listScheduledTasks();
      setJobs(data.jobs || []);
    } catch {
      toast.error("Failed to load scheduled tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleDeleteClick = (jobId, e) => {
    e.stopPropagation();
    setDeleteJobId(jobId);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteJobId) return;
    setDeleting(true);
    try {
      await deleteScheduledTask(deleteJobId);
      toast.success("Scheduled task deleted");
      loadJobs();
    } catch {
      toast.error("Failed to delete scheduled task");
    } finally {
      setDeleting(false);
      setDeleteJobId(null);
    }
  };

  const handleToggle = async (job, e) => {
    e.stopPropagation();
    try {
      await toggleScheduledTask(job.job_id, job.status !== "enabled");
      loadJobs();
    } catch {
      toast.error("Failed to toggle scheduled task");
    }
  };

  const jobColumns = useMemo(
    () => [
      {
        accessorKey: "name",
        header: ({ column }) => <SortableHeader column={column}>Name</SortableHeader>,
        cell: ({ row }) => (
          <span
            className="font-medium cursor-pointer hover:underline"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/scheduled-tasks/${row.original.job_id}`);
            }}
          >
            {row.getValue("name")}
          </span>
        ),
      },
      {
        accessorKey: "schedule_expression",
        header: "Schedule",
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {row.getValue("schedule_expression")}
          </span>
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusBadge status={row.getValue("status")} />,
      },
      {
        accessorKey: "updated_at",
        header: ({ column }) => <SortableHeader column={column}>Updated</SortableHeader>,
        cell: ({ row }) => (
          <span className="text-sm text-muted-foreground">
            {new Date(row.getValue("updated_at")).toLocaleDateString()}
          </span>
        ),
      },
      {
        id: "actions",
        header: "",
        cell: ({ row }) => {
          const job = row.original;
          return (
            <div className="flex gap-1 justify-end">
              <Button
                variant="ghost"
                size="icon"
                title={job.status === "enabled" ? "Disable" : "Enable"}
                onClick={(e) => handleToggle(job, e)}
              >
                <Power size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Edit"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditJob(job);
                  setShowForm(true);
                }}
              >
                <Pencil size={14} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                title="Delete"
                onClick={(e) => handleDeleteClick(job.job_id, e)}
              >
                <Trash2 size={14} />
              </Button>
            </div>
          );
        },
      },
    ],
    []
  );

  const filteredJobs = useMemo(() => jobs.filter((j) => j.status !== "deleted"), [jobs]);

  if (taskId) {
    return <TaskDetail jobId={taskId} onBack={() => navigate("/scheduled-tasks")} />;
  }

  return (
    <div className="st-page">
      <div className="st-header">
        <div className="st-header-left">
          <div className="st-title">
            <Clock size={18} />
            <h1>Scheduled Tasks</h1>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditJob(null);
            setShowForm(true);
          }}
        >
          <Plus size={14} className="mr-1" /> New Task
        </Button>
      </div>

      <div className="st-scroll">
        <div className="st-content">
          {loading ? (
            <div className="flex flex-col gap-3 py-2">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="flex gap-4 px-2">
                  <Skeleton className="h-4 w-[30%]" />
                  <Skeleton className="h-4 w-[25%]" />
                  <Skeleton className="h-4 w-[15%]" />
                  <Skeleton className="h-4 w-[20%]" />
                </div>
              ))}
            </div>
          ) : (
            <DataTable
              columns={jobColumns}
              data={filteredJobs}
              emptyMessage="No scheduled tasks yet. Create one to schedule recurring prompts."
            />
          )}
        </div>
      </div>

      <TaskForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSave={loadJobs}
        editJob={editJob}
      />

      <Dialog open={!!deleteJobId} onOpenChange={(v) => !v && setDeleteJobId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete scheduled task</DialogTitle>
            <DialogDescription>
              This will permanently delete this task and its schedule. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteJobId(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteConfirm} disabled={deleting}>
              {deleting && <Loader2 className="animate-spin mr-1" size={14} />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
