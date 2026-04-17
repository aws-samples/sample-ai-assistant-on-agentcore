import { useState, useEffect, useCallback, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { Clock, Plus, Trash2, Pencil, Power, Loader2, Eye } from "lucide-react";
import { toast } from "sonner";
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
import {
  listScheduledTasks,
  listTaskExecutions,
  deleteScheduledTask,
  toggleScheduledTask,
} from "@/services/scheduledTasksService";
import { convertExecutionToChat } from "@/components/Agent/context/api";
import { DataTable, SortableHeader } from "./components/DataTable";
import { ExecutionOutputSheet } from "./components/ExecutionOutputSheet";
import { TaskForm } from "./components/TaskForm";
import { TaskDetail } from "./components/TaskDetail";
import "./ScheduledTasksPage.css";

export function StatusBadge({ status }) {
  return <span className={`st-status ${status}`}>{status}</span>;
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
  const [latestExecs, setLatestExecs] = useState({});
  const [viewExec, setViewExec] = useState(null);
  const [converting, setConverting] = useState(null);

  const loadJobs = useCallback(async () => {
    try {
      const data = await listScheduledTasks();
      const jobList = data.jobs || [];
      setJobs(jobList);

      // Fetch latest execution for each job in parallel
      const active = jobList.filter((j) => j.status !== "deleted");
      const results = await Promise.allSettled(active.map((j) => listTaskExecutions(j.job_id, 1)));
      const execs = {};
      active.forEach((j, i) => {
        if (results[i].status === "fulfilled") {
          const list = results[i].value.executions || [];
          if (list.length) execs[j.job_id] = list[0];
        }
      });
      setLatestExecs(execs);
    } catch (err) {
      console.error("Failed to load scheduled tasks:", err);
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
      setJobs((prev) => prev.filter((j) => j.job_id !== deleteJobId));
    } catch (err) {
      console.error("Failed to delete scheduled task:", err);
      toast.error("Failed to delete scheduled task: " + (err.message || "Unknown error"));
    } finally {
      setDeleting(false);
      setDeleteJobId(null);
    }
  };

  const handleToggle = async (job, e) => {
    e.stopPropagation();
    try {
      const result = await toggleScheduledTask(job.job_id, job.status !== "enabled");
      const updated = result.job;
      setJobs((prev) => prev.map((j) => (j.job_id === job.job_id ? { ...j, ...updated } : j)));
    } catch (err) {
      console.error("Failed to toggle scheduled task:", err);
      toast.error("Failed to toggle scheduled task: " + (err.message || "Unknown error"));
    }
  };

  const handleConvertToChat = async (exec) => {
    const job = jobs.find((j) => j.job_id === exec.job_id);
    setConverting(exec.execution_id);
    try {
      const result = await convertExecutionToChat(exec.execution_id, job?.name);
      window.dispatchEvent(
        new CustomEvent("chatCreated", {
          detail: {
            sessionId: result.session_id,
            description: job?.name,
            createdAt: new Date().toISOString(),
          },
        })
      );
      navigate(`/chat/${result.session_id}`);
    } catch (err) {
      console.error("Failed to convert execution to chat:", err);
      toast.error("Failed to convert execution to chat");
    } finally {
      setConverting(null);
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
        id: "latest_output",
        header: "Latest Output",
        cell: ({ row }) => {
          const exec = latestExecs[row.original.job_id];
          if (!exec) return <span className="text-sm text-muted-foreground">—</span>;
          const isRunning = exec.status === "running";
          return isRunning ? (
            <Loader2 className="animate-spin text-muted-foreground" size={14} />
          ) : (
            <Button
              variant="ghost"
              size="icon"
              title="View latest output"
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
    [handleToggle, handleDeleteClick, navigate, setEditJob, setShowForm, latestExecs]
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

      <ExecutionOutputSheet
        execution={viewExec}
        onClose={() => setViewExec(null)}
        onConvertToChat={handleConvertToChat}
        converting={!!converting}
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
