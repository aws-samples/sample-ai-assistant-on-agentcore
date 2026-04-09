/**
 * TemplateManager Component
 *
 * Upload and delete controls for template files in a skill's templates/ subfolder.
 * Displays the list of current templates for the selected skill.
 *
 */

import React, { useState, useRef, useCallback } from "react";
import { Upload, Trash2, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { uploadTemplate, deleteTemplate } from "@/services/skillsService";
import "./TemplateManager.css";

/**
 * @param {Object} props
 * @param {string} props.skillName - The skill this template manager is for
 * @param {string[]} props.templates - List of template filenames
 * @param {boolean} props.isSystem - Whether this is a system (read-only) skill
 * @param {Function} props.onTemplatesChanged - Callback after upload/delete to refresh data
 */
function TemplateManager({ skillName, templates = [], isSystem = false, onTemplatesChanged }) {
  const [uploading, setUploading] = useState(false);
  const [deletingFile, setDeletingFile] = useState(null);
  const fileInputRef = useRef(null);

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      if (!file || !skillName) return;

      const MAX_SIZE = 100 * 1024 * 1024; // 100 MB
      if (file.size > MAX_SIZE) {
        toast.error("File too large", { description: "Maximum file size is 100 MB." });
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }

      try {
        setUploading(true);
        await uploadTemplate(skillName, file);
        toast.success(`Uploaded ${file.name}`);
        onTemplatesChanged?.();
      } catch (err) {
        console.error("Failed to upload template:", err);
        toast.error("Upload failed", { description: err.message });
      } finally {
        setUploading(false);
        // Reset input so the same file can be re-uploaded
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [skillName, onTemplatesChanged]
  );

  const handleDelete = useCallback(
    async (filename) => {
      if (!skillName) return;
      try {
        setDeletingFile(filename);
        await deleteTemplate(skillName, filename);
        toast.success(`Deleted ${filename}`);
        onTemplatesChanged?.();
      } catch (err) {
        console.error("Failed to delete template:", err);
        toast.error("Delete failed", { description: err.message });
      } finally {
        setDeletingFile(null);
      }
    },
    [skillName, onTemplatesChanged]
  );

  return (
    <div className="template-manager">
      <div className="template-manager-header">
        <h3 className="template-manager-title">Templates</h3>
        {!isSystem && (
          <>
            <Button variant="outline" size="sm" onClick={handleUploadClick} disabled={uploading}>
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5 mr-1" />
              )}
              Upload
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              className="template-manager-file-input"
              onChange={handleFileChange}
              aria-label="Upload template file"
            />
          </>
        )}
      </div>

      {templates.length > 0 ? (
        <ul className="template-manager-list" role="list">
          {templates.map((tpl) => (
            <li key={tpl} className="template-manager-item">
              <FileText className="h-4 w-4 template-manager-item-icon" />
              <span className="template-manager-item-name">{tpl}</span>
              {!isSystem && (
                <button
                  className="template-manager-delete-btn"
                  onClick={() => handleDelete(tpl)}
                  disabled={deletingFile === tpl}
                  aria-label={`Delete ${tpl}`}
                >
                  {deletingFile === tpl ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="template-manager-empty">No templates uploaded.</p>
      )}
    </div>
  );
}

export default TemplateManager;
