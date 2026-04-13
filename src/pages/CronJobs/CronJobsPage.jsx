import React, { useState, useEffect, useCallback } from "react";
import {
  Clock,
  Plus,
  Trash2,
  Pencil,
  Power,
  Loader2,
  ChevronLeft,
  X,
  Eye,
  Play,
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
  listCronJobs,
  createCronJob,
  updateCronJob,
  deleteCronJob,
  toggleCronJob,
  triggerCronJob,
  getCronJob,
  listCronExecutions,
  getCronExecution,
} from "@/services/cronJobsService";
import "./CronJobsPage.css";
import TextContent from "@/components/Agent/TextContent";

function StatusBadge({ status }) {
  return <span className={`cron-status ${status}`}>{status}</span>;
}

function ExecutionOutput({ execution, onClose }) {
  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCronExecution(execution.job_id, execution.execution_id)
      .then((data) => setOutput(data.execution?.output || "No output"))
      .catch(() => setOutput("Failed to load output"))
      .finally(() => setLoading(false));
  }, [execution]);

  return (
    <div className="cron-output-overlay" onClick={onClose}>
      <div className="cron-output-panel" onClick={(e) => e.stopPropagation()}>
        <div className="cron-output-header">
          <span>Execution Output</span>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X size={16} />
          </Button>
        </div>
        <div className="cron-output-body">
          {loading ? <Loader2 className="animate-spin" size={20} /> : <TextContent content={output || ""} />}
        </div>
      </div>
    </div>
  );
}

function CronJobDetail({ jobId, onBack }) {
  const [job, setJob] = useState(null);
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [viewExec, setViewExec] = useState(null);
  const [triggering, setTriggering] = useState(false);

  useEffect(() => {
    Promise.all([getCronJob(jobId), listCronExecutions(jobId)])
      .then(([jobData, execData]) => {
        setJob(jobData.job);
        setExecutions(execData.executions || []);
      })
      .catch(() => toast.error("Failed to load job details"))
      .finally(() => setLoading(false));
  }, [jobId]);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await triggerCronJob(jobId);
      toast.success("Job triggered — execution will appear shortly");
    } catch {
      toast.error("Failed to trigger job");
    } finally {
      setTriggering(false);
    }
  };

  if (loading) {
    return (
      <div className="cron-page">
        <div className="cron-empty" style={{ flex: 1 }}>
          <Loader2 className="animate-spin" size={24} />
        </div>
      </div>
    );
  }

  if (!job) return null;

  return (
    <div className="cron-page">
      <div className="cron-header">
        <div className="cron-header-left">
          <button className="cron-detail-back" onClick={onBack}>
            <ChevronLeft size={16} /> Back to Cron Jobs
          </button>
        </div>
      </div>
      <div className="cron-scroll">
        <div className="cron-content">
          <div className="cron-detail-title-row">
            <h1>{job.name}</h1>
            <Button size="sm" variant="outline" onClick={handleTrigger} disabled={triggering}>
              {triggering ? <Loader2 className="animate-spin mr-1" size={14} /> : <Play size={14} className="mr-1" />}
              Run Now
            </Button>
          </div>

          <dl className="cron-detail-info">
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

          <h2 className="cron-section-title">Prompt</h2>
          <div className="cron-detail-prompt">{job.prompt}</div>

          <h2 className="cron-section-title">Execution History</h2>
          {executions.length === 0 ? (
            <p style={{ color: "var(--color-muted-foreground)", fontSize: "0.875rem" }}>
              No executions yet.
            </p>
          ) : (
            <table className="cron-exec-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {[...executions]
                  .sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""))
                  .map((exec) => {
                    const started = exec.started_at ? new Date(exec.started_at) : null;
                    const finished = exec.finished_at ? new Date(exec.finished_at) : null;
                    const duration =
                      started && finished ? `${Math.round((finished - started) / 1000)}s` : "—";
                    return (
                      <tr key={exec.execution_id}>
                        <td>{started ? started.toLocaleString() : "—"}</td>
                        <td>
                          <span className={`exec-status ${exec.status}`}>{exec.status}</span>
                        </td>
                        <td>{duration}</td>
                        <td>
                          {exec.status !== "running" && (
                            <Button variant="ghost" size="sm" onClick={() => setViewExec(exec)}>
                              <Eye size={14} />
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          )}

          {viewExec && <ExecutionOutput execution={viewExec} onClose={() => setViewExec(null)} />}
        </div>
      </div>
    </div>
  );
}

function CronJobForm({ open, onClose, onSave, editJob }) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("");
  const [timezone, setTimezone] = useState("UTC");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editJob) {
      setName(editJob.name || "");
      setPrompt(editJob.prompt || "");
      setSchedule(editJob.schedule_expression || "");
      setTimezone(editJob.timezone || "UTC");
    } else {
      setName("");
      setPrompt("");
      setSchedule("");
      setTimezone("UTC");
    }
  }, [editJob, open]);

  const handleSubmit = async () => {
    if (!name.trim() || !prompt.trim() || !schedule.trim()) {
      toast.error("Name, prompt, and schedule are required");
      return;
    }
    setSaving(true);
    try {
      if (editJob) {
        await updateCronJob(editJob.job_id, {
          name,
          prompt,
          schedule_expression: schedule,
          timezone,
        });
        toast.success("Cron job updated");
      } else {
        await createCronJob({ name, prompt, schedule_expression: schedule, timezone });
        toast.success("Cron job created");
      }
      onSave();
      onClose();
    } catch (e) {
      toast.error(e.message || "Failed to save cron job");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editJob ? "Edit Cron Job" : "New Cron Job"}</DialogTitle>
          <DialogDescription>
            Schedule a prompt to run automatically on a recurring basis.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div>
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Daily report" />
          </div>
          <div>
            <Label>Schedule (cron or rate expression)</Label>
            <Input
              value={schedule}
              onChange={(e) => setSchedule(e.target.value)}
              placeholder="rate(1 day)"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Examples: rate(1 hour), rate(1 day), cron(0 9 * * ? *)
            </p>
          </div>
          <div>
            <Label>Timezone</Label>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} />
          </div>
          <div>
            <Label>Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Generate a daily summary of..."
              rows={5}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
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

export default function CronJobsPage() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editJob, setEditJob] = useState(null);
  const [detailJobId, setDetailJobId] = useState(null);

  const loadJobs = useCallback(async () => {
    try {
      const data = await listCronJobs();
      setJobs(data.jobs || []);
    } catch {
      toast.error("Failed to load cron jobs");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  const handleDelete = async (jobId) => {
    if (!confirm("Delete this cron job?")) return;
    try {
      await deleteCronJob(jobId);
      toast.success("Cron job deleted");
      loadJobs();
    } catch {
      toast.error("Failed to delete cron job");
    }
  };

  const handleToggle = async (job) => {
    try {
      await toggleCronJob(job.job_id, job.status !== "enabled");
      loadJobs();
    } catch {
      toast.error("Failed to toggle cron job");
    }
  };

  if (detailJobId) {
    return <CronJobDetail jobId={detailJobId} onBack={() => setDetailJobId(null)} />;
  }

  return (
    <div className="cron-page">
      <div className="cron-header">
        <div className="cron-header-left">
          <div className="cron-title">
            <Clock size={18} />
            <h1>Cron Jobs</h1>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditJob(null);
            setShowForm(true);
          }}
        >
          <Plus size={14} className="mr-1" /> New Job
        </Button>
      </div>

      <div className="cron-scroll">
        <div className="cron-content">
          {loading ? (
            <div className="cron-empty">
              <Loader2 className="animate-spin" size={24} />
            </div>
          ) : jobs.length === 0 ? (
            <div className="cron-empty">
              <p>No cron jobs yet. Create one to schedule recurring prompts.</p>
            </div>
          ) : (
            <table className="cron-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Schedule</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {jobs
                  .filter((j) => j.status !== "deleted")
                  .map((job) => (
                    <tr key={job.job_id}>
                      <td className="cron-name" onClick={() => setDetailJobId(job.job_id)}>
                        {job.name}
                      </td>
                      <td style={{ fontSize: "0.8125rem", color: "var(--color-muted-foreground)" }}>
                        {job.schedule_expression}
                      </td>
                      <td>
                        <StatusBadge status={job.status} />
                      </td>
                      <td style={{ fontSize: "0.8125rem", color: "var(--color-muted-foreground)" }}>
                        {new Date(job.updated_at).toLocaleDateString()}
                      </td>
                      <td>
                        <div className="cron-actions">
                          <Button
                            variant="ghost"
                            size="icon"
                            title={job.status === "enabled" ? "Disable" : "Enable"}
                            onClick={() => handleToggle(job)}
                          >
                            <Power size={14} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Edit"
                            onClick={() => {
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
                            onClick={() => handleDelete(job.job_id)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <CronJobForm
        open={showForm}
        onClose={() => setShowForm(false)}
        onSave={loadJobs}
        editJob={editJob}
      />
    </div>
  );
}
