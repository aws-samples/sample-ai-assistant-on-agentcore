import React, { useState, useCallback, useMemo, useRef } from "react";
import { Download, Loader2, Check, FileSliders, FolderPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeContext";
import { toast } from "sonner";
import { refreshDownloadUrl } from "./context/api";
import { addArtifactToProject } from "@/services/projectsService";

// Extensions supported as project files (mirrors backend STRUCTURED_EXTENSIONS + DOCUMENT_EXTENSIONS)
const PROJECT_SUPPORTED_EXTENSIONS = new Set([
  ".csv",
  ".tsv",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".parquet",
  ".jsonl",
  ".arrow",
  ".feather",
  ".txt",
  ".md",
  ".html",
  ".htm",
  ".pdf",
  ".docx",
]);

const URL_CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * PptxDownloadCard - Displays a download card for generated PowerPoint files.
 * Renders when the generate_download_link tool completes successfully.
 * Shows filename and a download button that fetches a presigned URL on demand
 * with a 15-minute client-side cache.
 *
 */
const PptxDownloadCard = ({ toolContent, boundProject = null }) => {
  const [status, setStatus] = useState("idle"); // idle | loading | success | error
  const [addStatus, setAddStatus] = useState("idle"); // idle | loading | success | error
  const urlCache = useRef({ url: null, expiry: 0 });

  const result = useMemo(() => {
    if (!toolContent) return null;
    try {
      const parsed = typeof toolContent === "string" ? JSON.parse(toolContent) : toolContent;
      if (parsed?.status === "success" && parsed?.s3_key && parsed?.filename) {
        return parsed;
      }
      return null;
    } catch {
      return null;
    }
  }, [toolContent]);

  const handleDownload = useCallback(async () => {
    if (status === "loading" || !result?.s3_key) return;
    setStatus("loading");

    try {
      const now = Date.now();
      let url = urlCache.current.url;

      // Use cached URL if still valid
      if (!url || now >= urlCache.current.expiry) {
        const data = await refreshDownloadUrl(result.s3_key);
        if (!data?.url) throw new Error("No URL returned");
        url = data.url;
        urlCache.current = { url, expiry: now + URL_CACHE_TTL_MS };
      }

      // Fetch as blob and trigger download via hidden anchor to avoid page flash
      const resp = await fetch(url);
      if (!resp.ok) throw new Error("Download failed");
      const blob = await resp.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = result.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(blobUrl);

      setStatus("success");
      setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      setStatus("error");
      toast.error("Failed to generate download link. Please try again.");
    }
  }, [result?.s3_key, result?.filename, status]);

  const ext = result ? "." + result.filename.split(".").pop().toLowerCase() : "";
  const isProjectSupported = PROJECT_SUPPORTED_EXTENSIONS.has(ext);
  const showAddToProject = boundProject && isProjectSupported;

  const handleAddToProject = useCallback(async () => {
    if (addStatus === "loading" || !result?.s3_key) return;
    setAddStatus("loading");
    try {
      await addArtifactToProject(boundProject.project_id, result.s3_key, result.filename);
      setAddStatus("success");
      toast.success(`${result.filename} added to ${boundProject.name}`);
    } catch (err) {
      setAddStatus("idle");
      if (err.code === "file_already_exists") {
        toast.error(`${result.filename} already exists in this project`);
      } else {
        toast.error("Failed to add file to project");
      }
    }
  }, [result?.s3_key, result?.filename, boundProject, addStatus]);

  if (!result) return null;

  const buttonIcon =
    status === "loading" ? (
      <Loader2 className="h-4 w-4 animate-spin" />
    ) : status === "success" ? (
      <Check className="h-4 w-4" />
    ) : (
      <Download className="h-4 w-4" />
    );

  const buttonLabel =
    status === "loading" ? "Preparing..." : status === "success" ? "Opened" : "Download";

  return (
    <div
      style={{
        borderRadius: "10px",
        border: "1px solid var(--color-border)",
        padding: "12px 16px",
        backgroundColor: "var(--color-card)",
        maxWidth: 400,
        margin: "8px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8, marginBottom: 10 }}>
        <FileSliders
          size={18}
          className="text-muted-foreground"
          style={{ flexShrink: 0, marginTop: 2 }}
        />
        <span style={{ fontWeight: 600, fontSize: 14, wordBreak: "break-word" }}>
          {result.filename}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button size="sm" onClick={handleDownload} disabled={status === "loading"}>
          {buttonIcon}
          {buttonLabel}
        </Button>
        {showAddToProject && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddToProject}
            disabled={addStatus === "loading" || addStatus === "success"}
          >
            {addStatus === "loading" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : addStatus === "success" ? (
              <Check className="h-4 w-4" />
            ) : (
              <FolderPlus className="h-4 w-4" />
            )}
            {addStatus === "loading"
              ? "Adding..."
              : addStatus === "success"
                ? "Added"
                : "Add to Project"}
          </Button>
        )}
      </div>
    </div>
  );
};

export default PptxDownloadCard;
