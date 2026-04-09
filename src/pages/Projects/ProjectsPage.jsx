import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen,
  Plus,
  Trash2,
  Upload,
  Download,
  FileText,
  X,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  RefreshCw,
  Pencil,
  MessageSquare,
  Bookmark,
  BrainCircuit,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  createProject,
  listProjects,
  updateProject,
  deleteProject,
  getUploadUrl,
  uploadFileToS3,
  confirmFileUpload,
  listProjectFiles,
  deleteProjectFile,
  getFileDownloadUrl,
  listProjectSessions,
  listProjectCanvases,
  deleteProjectCanvas,
  listProjectMemories,
  deleteProjectMemory,
} from "@/services/projectsService";
import "./ProjectsPage.css";

const FILE_STATUS_CONFIG = {
  pending_confirmation: { label: "Uploading", icon: Clock, color: "var(--color-muted-foreground)" },
  uploading: { label: "Uploading", icon: Clock, color: "var(--color-muted-foreground)" },
  processing: { label: "Indexing", icon: Loader2, color: "#3b82f6", spin: true },
  indexing: { label: "Indexing", icon: Loader2, color: "#3b82f6", spin: true },
  indexed: { label: "Indexed", icon: CheckCircle, color: "#22c55e" },
  ready: { label: "Ready", icon: CheckCircle, color: "#22c55e" },
  failed: { label: "Failed", icon: AlertCircle, color: "#ef4444" },
};

const ALLOWED_EXTENSIONS =
  ".txt,.md,.html,.htm,.pdf,.doc,.docx,.csv,.tsv,.json,.yaml,.yml,.xls,.xlsx,.ppt,.pptx,.parquet,.jsonl,.arrow,.feather";

function MemoryDeleteButton({ onClick }) {
  return (
    <button className="projects-memory-delete" title="Delete memory" onClick={onClick}>
      <X size={12} />
    </button>
  );
}

function FileStatusChip({ status }) {
  const cfg = FILE_STATUS_CONFIG[status] || FILE_STATUS_CONFIG.indexing;
  const Icon = cfg.icon;
  return (
    <span className="projects-file-status" style={{ color: cfg.color }}>
      <Icon size={13} className={cfg.spin ? "projects-spin" : ""} />
      {cfg.label}
    </span>
  );
}

function FormatBytes({ bytes }) {
  if (!bytes) return null;
  if (bytes < 1024) return <span>{bytes} B</span>;
  if (bytes < 1024 * 1024) return <span>{(bytes / 1024).toFixed(1)} KB</span>;
  return <span>{(bytes / (1024 * 1024)).toFixed(1)} MB</span>;
}

function ProjectFormDialog({ open, onClose, onSubmit, initial = null }) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name || "");
      setDescription(initial?.description || "");
    }
  }, [open, initial]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSubmit(name.trim(), description.trim());
    } finally {
      setSaving(false);
    }
  };

  const isEdit = Boolean(initial);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit project" : "New project"}</DialogTitle>
          <DialogDescription>
            {isEdit ? "Update your project details." : "Create a new knowledge base space."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="projects-form">
          <div className="projects-form-field">
            <Label htmlFor="proj-name">Name</Label>
            <Input
              id="proj-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 Research"
              required
              autoFocus
            />
          </div>
          <div className="projects-form-field">
            <Label htmlFor="proj-desc">Description</Label>
            <Input
              id="proj-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional description"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || saving}>
              {saving ? <Loader2 className="projects-spin" size={14} /> : null}
              {isEdit ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteConfirmDialog({ open, title, description, onClose, onConfirm }) {
  const [loading, setLoading] = useState(false);

  const handleConfirm = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirm} disabled={loading}>
            {loading ? <Loader2 className="projects-spin" size={14} /> : null}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProjectsPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState("files");
  const [files, setFiles] = useState([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [canvases, setCanvases] = useState([]);
  const [canvasesLoading, setCanvasesLoading] = useState(false);
  const [canvasToDelete, setCanvasToDelete] = useState(null);
  const [memories, setMemories] = useState({ facts: [], preferences: [] });
  const [memoriesLoading, setMemoriesLoading] = useState(false);
  const [memoryToDelete, setMemoryToDelete] = useState(null);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [editingProject, setEditingProject] = useState(null);
  const [projectToDelete, setProjectToDelete] = useState(null);
  const [fileToDelete, setFileToDelete] = useState(null);

  const fileInputRef = useRef(null);
  const pollingRef = useRef(null);

  // ── Load projects ──────────────────────────────────────────────────────────

  const loadProjects = useCallback(async (selectId = null) => {
    try {
      setLoading(true);
      const data = await listProjects();
      const list = data.projects || [];
      setProjects(list);
      if (selectId) {
        const found = list.find((p) => p.project_id === selectId);
        if (found) setSelectedProject(found);
      }
    } catch {
      toast.error("Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // ── Load files ─────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async (projectId) => {
    try {
      setFilesLoading(true);
      const data = await listProjectFiles(projectId);
      setFiles(data.files || []);
    } catch {
      // Non-fatal — keep existing list
    } finally {
      setFilesLoading(false);
    }
  }, []);

  // ── Load sessions ──────────────────────────────────────────────────────────

  const loadSessions = useCallback(async (projectId) => {
    try {
      setSessionsLoading(true);
      const data = await listProjectSessions(projectId);
      setSessions(data.sessions || []);
    } catch {
      // Non-fatal
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  // ── Load canvases ──────────────────────────────────────────────────────────

  const loadCanvases = useCallback(async (projectId) => {
    try {
      setCanvasesLoading(true);
      const data = await listProjectCanvases(projectId);
      setCanvases(data.canvases || []);
    } catch {
      // Non-fatal
    } finally {
      setCanvasesLoading(false);
    }
  }, []);

  // ── Load memories ──────────────────────────────────────────────────────────

  const loadMemories = useCallback(async (projectId) => {
    try {
      setMemoriesLoading(true);
      const data = await listProjectMemories(projectId);
      setMemories({ facts: data.facts || [], preferences: data.preferences || [] });
    } catch {
      // Non-fatal
    } finally {
      setMemoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (selectedProject) {
      loadFiles(selectedProject.project_id);
      setActiveTab("files");
    } else {
      setFiles([]);
      setSessions([]);
      setCanvases([]);
      setMemories({ facts: [], preferences: [] });
    }
  }, [selectedProject?.project_id]);

  // ── Poll for indexing status ───────────────────────────────────────────────

  const selectedProjectIdRef = useRef(selectedProject?.project_id);
  selectedProjectIdRef.current = selectedProject?.project_id;

  useEffect(() => {
    const hasActive = files.some((f) =>
      ["processing", "indexing", "pending_confirmation", "uploading"].includes(f.status)
    );

    if (!hasActive || !selectedProject) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
      return;
    }

    if (pollingRef.current) return; // already polling

    pollingRef.current = setInterval(() => {
      const id = selectedProjectIdRef.current;
      if (id) loadFiles(id);
    }, 5000);

    return () => {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    };
  }, [files, selectedProject?.project_id, loadFiles]);

  // Cleanup on unmount
  useEffect(() => {
    return () => clearInterval(pollingRef.current);
  }, []);

  // ── CRUD handlers ──────────────────────────────────────────────────────────

  const handleCreateProject = async (name, description) => {
    try {
      const data = await createProject(name, description);
      setShowCreateDialog(false);
      await loadProjects(data.project?.project_id);
      toast.success("Project created");
    } catch (e) {
      toast.error(e.message || "Failed to create project");
    }
  };

  const handleUpdateProject = async (name, description) => {
    try {
      await updateProject(editingProject.project_id, name, description);
      setEditingProject(null);
      const updated = { ...selectedProject, name, description };
      setSelectedProject(updated);
      setProjects((prev) => prev.map((p) => (p.project_id === updated.project_id ? updated : p)));
      toast.success("Project updated");
    } catch (e) {
      toast.error(e.message || "Failed to update project");
    }
  };

  const handleDeleteProject = async () => {
    try {
      await deleteProject(projectToDelete.project_id);
      const deletedId = projectToDelete.project_id;
      setProjectToDelete(null);
      if (selectedProject?.project_id === deletedId) {
        setSelectedProject(null);
        setFiles([]);
      }
      setProjects((prev) => prev.filter((p) => p.project_id !== deletedId));
      toast.success("Project deleted");
    } catch (e) {
      toast.error(e.message || "Failed to delete project");
    }
  };

  // ── File upload ────────────────────────────────────────────────────────────

  const handleFileUpload = useCallback(
    async (fileList) => {
      if (!selectedProject) return;
      const filesArr = Array.from(fileList);
      setUploading(true);

      for (const file of filesArr) {
        try {
          // 1. Get presigned URL
          const { file_id, upload_url } = await getUploadUrl(
            selectedProject.project_id,
            file.name,
            file.type || "application/octet-stream",
            file.size
          );

          // 2. Upload directly to S3
          await uploadFileToS3(upload_url, file);

          // 3. Confirm with backend (triggers sidecar + ingestion job)
          await confirmFileUpload(selectedProject.project_id, file_id);

          toast.success(`${file.name} uploaded`);
        } catch (e) {
          const msg =
            e.code === "file_already_exists"
              ? `${file.name} already exists in this project`
              : e.code === "file_too_large"
                ? `${file.name} is too large (max 1 GB)`
                : e.code === "invalid_file_type"
                  ? `${file.name}: unsupported file type`
                  : e.code === "project_file_limit_reached"
                    ? `Project file limit reached`
                    : e.message || `Failed to upload ${file.name}`;
          toast.error(msg);
        }
      }

      setUploading(false);
      // Refresh file list after all uploads
      await loadFiles(selectedProject.project_id);
    },
    [selectedProject, loadFiles]
  );

  const handleFileInputChange = (e) => {
    if (e.target.files?.length) {
      handleFileUpload(e.target.files);
      e.target.value = "";
    }
  };

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      if (e.dataTransfer.files?.length) handleFileUpload(e.dataTransfer.files);
    },
    [handleFileUpload]
  );

  const handleDragOver = (e) => e.preventDefault();

  // ── File delete ────────────────────────────────────────────────────────────

  const handleDeleteFile = async () => {
    try {
      await deleteProjectFile(selectedProject.project_id, fileToDelete.file_id);
      setFiles((prev) => prev.filter((f) => f.file_id !== fileToDelete.file_id));
      setFileToDelete(null);
      toast.success(`${fileToDelete.filename} deleted`);
    } catch {
      toast.error("Failed to delete file");
    }
  };

  // ── Canvas delete ──────────────────────────────────────────────────────────

  const handleDeleteCanvas = async () => {
    try {
      await deleteProjectCanvas(selectedProject.project_id, canvasToDelete.canvas_id);
      setCanvases((prev) => prev.filter((c) => c.canvas_id !== canvasToDelete.canvas_id));
      setCanvasToDelete(null);
      toast.success(`"${canvasToDelete.name}" removed from project`);
    } catch {
      toast.error("Failed to delete canvas");
    }
  };

  // ── Memory delete ──────────────────────────────────────────────────────────

  const handleDeleteMemory = async () => {
    try {
      await deleteProjectMemory(selectedProject.project_id, memoryToDelete.memory_record_id);
      setMemories((prev) => ({
        facts: prev.facts.filter((m) => m.memory_record_id !== memoryToDelete.memory_record_id),
        preferences: prev.preferences.filter(
          (m) => m.memory_record_id !== memoryToDelete.memory_record_id
        ),
      }));
      setMemoryToDelete(null);
      toast.success("Memory record deleted");
    } catch {
      toast.error("Failed to delete memory record");
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="projects-page">
      {/* Left sidebar */}
      <div className="projects-sidebar">
        <div className="projects-sidebar-header">
          <span className="projects-sidebar-title">
            <FolderOpen size={16} />
            Projects
          </span>
          <Button
            variant="ghost"
            size="icon"
            title="New project"
            onClick={() => setShowCreateDialog(true)}
          >
            <Plus size={16} />
          </Button>
        </div>

        <div className="projects-list">
          {loading ? (
            <div className="projects-loading">
              <Spinner size="sm" />
            </div>
          ) : projects.length === 0 ? (
            <div className="projects-empty-sidebar">
              <p>No projects yet</p>
              <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(true)}>
                <Plus size={14} /> Create project
              </Button>
            </div>
          ) : (
            projects.map((p) => (
              <button
                key={p.project_id}
                className={`projects-list-item ${selectedProject?.project_id === p.project_id ? "active" : ""}`}
                onClick={() => setSelectedProject(p)}
              >
                <FolderOpen size={14} />
                <span className="projects-list-item-name">{p.name}</span>
                {(() => {
                  const total = (p.file_count || 0) + (p.canvas_count || 0);
                  return total > 0 ? (
                    <span className="projects-list-item-count">{total}</span>
                  ) : null;
                })()}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="projects-main">
        {!selectedProject ? (
          <div className="projects-empty-main">
            <FolderOpen size={40} className="projects-empty-icon" />
            <p>Select a project or create a new one</p>
            <Button onClick={() => setShowCreateDialog(true)}>
              <Plus size={16} /> New project
            </Button>
          </div>
        ) : (
          <div className="projects-detail" onDrop={handleDrop} onDragOver={handleDragOver}>
            {/* Project header */}
            <div className="projects-detail-header">
              <div className="projects-detail-title-row">
                <h2 className="projects-detail-title">{selectedProject.name}</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Edit project"
                  onClick={() => setEditingProject(selectedProject)}
                >
                  <Pencil size={15} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  title="Delete project"
                  className="projects-delete-btn"
                  onClick={() => setProjectToDelete(selectedProject)}
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              {selectedProject.description && (
                <p className="projects-detail-description">{selectedProject.description}</p>
              )}
            </div>

            {/* Tabs */}
            <Tabs
              className="projects-tab-bar"
              value={activeTab}
              onValueChange={(v) => {
                setActiveTab(v);
                if (v === "artifacts") loadCanvases(selectedProject.project_id);
                else if (v === "chats") loadSessions(selectedProject.project_id);
                else if (v === "memory") loadMemories(selectedProject.project_id);
              }}
            >
              <TabsList variant="line">
                <TabsTrigger value="files" variant="line">
                  <FileText size={13} />
                  Files
                  {files.length > 0 && (
                    <span className="projects-list-item-count">{files.length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="artifacts" variant="line">
                  <Bookmark size={13} />
                  Artifacts
                  {canvases.length > 0 && (
                    <span className="projects-list-item-count">{canvases.length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="chats" variant="line">
                  <MessageSquare size={13} />
                  Chats
                  {sessions.length > 0 && (
                    <span className="projects-list-item-count">{sessions.length}</span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="memory" variant="line">
                  <BrainCircuit size={13} />
                  Memory
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {activeTab === "files" && (
              <div className="projects-files-section">
                <div className="projects-files-header">
                  <span className="projects-files-title">Files</span>
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {filesLoading && <Loader2 size={14} className="projects-spin" />}
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={uploading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      {uploading ? (
                        <Loader2 size={14} className="projects-spin" />
                      ) : (
                        <Upload size={14} />
                      )}
                      Upload files
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={ALLOWED_EXTENSIONS}
                      style={{ display: "none" }}
                      onChange={handleFileInputChange}
                    />
                  </div>
                </div>

                {filesLoading ? (
                  <div className="projects-file-list">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="projects-file-row">
                        <div className="projects-file-body">
                          <Skeleton className="h-4 w-48" />
                          <div className="projects-file-badges">
                            <Skeleton className="h-4 w-10 rounded-full" />
                            <Skeleton className="h-4 w-14 rounded-full" />
                          </div>
                        </div>
                        <div className="projects-file-actions">
                          <Skeleton className="h-5 w-5 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : files.length === 0 ? (
                  <div className="projects-drop-zone" onClick={() => fileInputRef.current?.click()}>
                    <Upload size={24} className="projects-drop-icon" />
                    <p>Drop files here or click to upload</p>
                    <p className="projects-drop-hint">
                      Documents: .txt .md .html .pdf .docx · Data: .csv .tsv .xlsx .parquet .jsonl
                    </p>
                  </div>
                ) : (
                  <div className="projects-file-list">
                    {files.map((file) => (
                      <div key={file.file_id} className="projects-file-row">
                        <div className="projects-file-body">
                          <span className="projects-file-name">{file.filename}</span>
                          <div className="projects-file-badges">
                            {file.size_bytes > 0 && (
                              <span className="projects-item-badge">
                                <FormatBytes bytes={file.size_bytes} />
                              </span>
                            )}
                            <FileStatusChip status={file.status} />
                          </div>
                        </div>
                        <div className="projects-file-actions">
                          {["ready", "indexed", "processing"].includes(file.status) && (
                            <button
                              className="projects-file-download"
                              title={`Download ${file.filename}`}
                              onClick={async () => {
                                try {
                                  const { url } = await getFileDownloadUrl(
                                    selectedProject.project_id,
                                    file.file_id
                                  );
                                  window.open(url, "_blank");
                                } catch {
                                  toast.error("Failed to download file");
                                }
                              }}
                            >
                              <Download size={13} />
                            </button>
                          )}
                          <button
                            className="projects-file-delete"
                            title={`Delete ${file.filename}`}
                            onClick={() => setFileToDelete(file)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "chats" && (
              <div className="projects-files-section">
                <div className="projects-files-header">
                  <span className="projects-files-title">Bound chats</span>
                  {sessionsLoading && <Loader2 size={14} className="projects-spin" />}
                </div>

                {sessionsLoading ? (
                  <div className="projects-file-list">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="projects-chat-row">
                        <div className="projects-file-body">
                          <Skeleton className="h-4 w-56" />
                          <div className="projects-file-badges">
                            <Skeleton className="h-4 w-14 rounded-full" />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : sessions.length === 0 ? (
                  <div className="projects-empty-chats">
                    <MessageSquare size={20} className="projects-empty-chats-icon" />
                    <p className="projects-empty-chats-text">No chats bound yet</p>
                  </div>
                ) : (
                  <div className="projects-file-list">
                    {sessions.map((s) => (
                      <button
                        key={s.session_id}
                        className="projects-chat-row"
                        onClick={() => navigate(`/chat/${s.session_id}`)}
                      >
                        <div className="projects-file-body">
                          <span className="projects-chat-title">
                            {s.description || "Untitled chat"}
                          </span>
                          {s.created_at && (
                            <div className="projects-file-badges">
                              <span className="projects-item-badge">
                                {new Date(s.created_at).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            </div>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "memory" && (
              <Tabs defaultValue="facts" className="projects-files-section">
                <div className="projects-files-header">
                  <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    {!memoriesLoading &&
                      (memories.facts.length > 0 || memories.preferences.length > 0) && (
                        <TabsList style={{ width: "fit-content" }} className="h-auto p-0.5 gap-0.5">
                          <TabsTrigger value="facts" className="px-2 py-0.5 text-xs">
                            Facts & insights
                            {memories.facts.length > 0 && (
                              <span className="projects-list-item-count" style={{ marginLeft: 5 }}>
                                {memories.facts.length}
                              </span>
                            )}
                          </TabsTrigger>
                          <TabsTrigger value="preferences" className="px-2 py-0.5 text-xs">
                            Preferences
                            {memories.preferences.length > 0 && (
                              <span className="projects-list-item-count" style={{ marginLeft: 5 }}>
                                {memories.preferences.length}
                              </span>
                            )}
                          </TabsTrigger>
                        </TabsList>
                      )}
                    {memoriesLoading && <Loader2 size={14} className="projects-spin" />}
                  </div>
                </div>

                {memoriesLoading ? (
                  <div className="projects-memory-list">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="projects-memory-item">
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-3/4 mt-1" />
                      </div>
                    ))}
                  </div>
                ) : memories.facts.length === 0 && memories.preferences.length === 0 ? (
                  <div className="projects-empty-chats">
                    <BrainCircuit size={20} className="projects-empty-chats-icon" />
                    <p className="projects-empty-chats-text">No memories yet</p>
                    <p className="projects-drop-hint">
                      Memories are extracted from conversations and appear here after sessions
                    </p>
                  </div>
                ) : (
                  <>
                    <TabsContent value="facts">
                      {memories.facts.length === 0 ? (
                        <div className="projects-empty-chats">
                          <p className="projects-empty-chats-text">No facts recorded yet</p>
                        </div>
                      ) : (
                        <div className="projects-memory-list">
                          {memories.facts.map((m, i) => (
                            <div key={m.memory_record_id || i} className="projects-memory-item">
                              <p className="projects-memory-text">{m.content}</p>
                              <MemoryDeleteButton onClick={() => setMemoryToDelete(m)} />
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>

                    <TabsContent value="preferences">
                      {memories.preferences.length === 0 ? (
                        <div className="projects-empty-chats">
                          <p className="projects-empty-chats-text">No preferences recorded yet</p>
                        </div>
                      ) : (
                        <div className="projects-memory-list">
                          {memories.preferences.map((m, i) => {
                            let parsed = null;
                            try {
                              parsed = JSON.parse(m.content);
                            } catch {}
                            if (parsed && (parsed.preference || parsed.categories)) {
                              return (
                                <div
                                  key={m.memory_record_id || i}
                                  className="projects-memory-item projects-memory-pref-card"
                                >
                                  <p className="projects-memory-pref-statement">
                                    {parsed.preference}
                                  </p>
                                  {parsed.categories?.length > 0 && (
                                    <div className="projects-memory-pref-tags">
                                      {parsed.categories.map((cat) => (
                                        <span key={cat} className="projects-memory-pref-tag">
                                          {cat}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  {parsed.context && (
                                    <p className="projects-memory-pref-context">{parsed.context}</p>
                                  )}
                                  <button
                                    className="projects-memory-delete"
                                    title="Delete memory"
                                    onClick={() => setMemoryToDelete(m)}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              );
                            }
                            return (
                              <div key={m.memory_record_id || i} className="projects-memory-item">
                                <p className="projects-memory-text">{m.content}</p>
                                <button
                                  className="projects-memory-delete"
                                  title="Delete memory"
                                  onClick={() => setMemoryToDelete(m)}
                                >
                                  <X size={12} />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </TabsContent>
                  </>
                )}
              </Tabs>
            )}

            {activeTab === "artifacts" && (
              <div className="projects-files-section">
                <div className="projects-files-header">
                  <span className="projects-files-title">Canvas artifacts</span>
                  {canvasesLoading && <Loader2 size={14} className="projects-spin" />}
                </div>

                {canvasesLoading ? (
                  <div className="projects-file-list">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="projects-file-row">
                        <div className="projects-file-body">
                          <Skeleton className="h-4 w-48" />
                          <div className="projects-file-badges">
                            <Skeleton className="h-4 w-12 rounded-full" />
                            <Skeleton className="h-4 w-14 rounded-full" />
                          </div>
                        </div>
                        <div className="projects-file-actions">
                          <Skeleton className="h-5 w-5 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : canvases.length === 0 ? (
                  <div className="projects-empty-chats">
                    <Bookmark size={20} className="projects-empty-chats-icon" />
                    <p className="projects-empty-chats-text">No saved canvases yet</p>
                    <p className="projects-drop-hint">
                      Save a canvas from the canvas panel using the bookmark button
                    </p>
                  </div>
                ) : (
                  <div className="projects-file-list">
                    {canvases.map((canvas) => (
                      <div key={canvas.canvas_id} className="projects-file-row">
                        <div className="projects-file-body">
                          <span className="projects-file-name">{canvas.name}</span>
                          <div className="projects-file-badges">
                            {canvas.type && (
                              <span className="projects-item-badge">{canvas.type}</span>
                            )}
                            {canvas.saved_at && (
                              <span className="projects-item-badge">
                                {new Date(canvas.saved_at).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                })}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="projects-file-actions">
                          <button
                            className="projects-file-delete"
                            title={`Remove ${canvas.name}`}
                            onClick={() => setCanvasToDelete(canvas)}
                          >
                            <X size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dialogs */}
      <ProjectFormDialog
        open={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
        onSubmit={handleCreateProject}
      />

      <ProjectFormDialog
        open={Boolean(editingProject)}
        onClose={() => setEditingProject(null)}
        onSubmit={handleUpdateProject}
        initial={editingProject}
      />

      <DeleteConfirmDialog
        open={Boolean(projectToDelete)}
        title="Delete project"
        description={`Delete "${projectToDelete?.name}"? All uploaded files and their indexed content will be permanently removed.`}
        onClose={() => setProjectToDelete(null)}
        onConfirm={handleDeleteProject}
      />

      <DeleteConfirmDialog
        open={Boolean(fileToDelete)}
        title="Delete file"
        description={`Delete "${fileToDelete?.filename}"? It will be removed from the project knowledge base.`}
        onClose={() => setFileToDelete(null)}
        onConfirm={handleDeleteFile}
      />

      <DeleteConfirmDialog
        open={Boolean(canvasToDelete)}
        title="Remove canvas"
        description={`Remove "${canvasToDelete?.name}" from this project? The canvas will no longer be accessible from this project.`}
        onClose={() => setCanvasToDelete(null)}
        onConfirm={handleDeleteCanvas}
      />

      <DeleteConfirmDialog
        open={Boolean(memoryToDelete)}
        title="Delete memory record"
        description="Delete this memory record? It will be permanently removed from the project's memory."
        onClose={() => setMemoryToDelete(null)}
        onConfirm={handleDeleteMemory}
      />
    </div>
  );
}

export default ProjectsPage;
