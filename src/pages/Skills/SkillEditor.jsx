/**
 * SkillEditor Component
 *
 * Renders skill content in the editor panel:
 * - SKILL.md: TipTap rich text editor with inline markdown formatting
 * - .py scripts: Code editor with Python syntax highlighting
 * - System skills displayed in read-only mode
 * - Save wired to saveSkillContent API
 */

import React, { useState, useEffect, useCallback } from "react";
import { Save, Loader2, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import CodeEditor from "@/components/ui/code-editor";
import TipTapEditor from "@/components/ui/tiptap-editor";
import { saveSkillContent } from "@/services/skillsService";
import "./SkillEditor.css";

/**
 * @param {Object} props
 * @param {string|null} props.selectedFile - e.g. "SKILL.md", "scripts/analysis.py", "references/charts.md", or null
 * @param {Object} props.skillData - Full skill data including markdown, scripts, templates, references
 * @param {boolean} props.isSystem - Whether this is a system (read-only) skill
 * @param {Function} props.onContentSaved - Callback after successful save to refresh data
 * @param {React.Ref} props.editorRef - Ref to access TipTapEditor API programmatically
 */
function SkillEditor({
  selectedFile,
  skillData,
  isSystem = false,
  onContentSaved,
  onToggleSkill,
  isToggling = false,
  editorRef,
}) {
  const [editContent, setEditContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);

  // Determine what we're displaying
  const isMarkdown = !selectedFile || selectedFile === "SKILL.md";
  const isScript = selectedFile?.startsWith("scripts/") && selectedFile.endsWith(".py");
  const isTemplate = selectedFile?.startsWith("templates/");
  const isReference = selectedFile?.startsWith("references/") && selectedFile.endsWith(".md");

  // Get the content for the current file
  const getFileContent = useCallback(() => {
    if (!skillData) return "";
    if (isMarkdown) return skillData.markdown || "";
    if (isScript && skillData.scripts) {
      const scriptName = selectedFile.replace("scripts/", "");
      const scriptObj = skillData.scripts.find(
        (s) => (typeof s === "string" ? s : s.filename) === scriptName
      );
      if (scriptObj && typeof scriptObj === "object") return scriptObj.content || "";
    }
    if (isReference && skillData.references) {
      const refName = selectedFile.replace("references/", "");
      const refObj = skillData.references.find(
        (r) => (typeof r === "string" ? r : r.filename) === refName
      );
      if (refObj && typeof refObj === "object") return refObj.content || "";
    }
    return "";
  }, [skillData, isMarkdown, isScript, isReference, selectedFile]);

  // Reset edit content when selection changes (for scripts)
  useEffect(() => {
    setEditContent(getFileContent());
    setEditing(false);
  }, [selectedFile, skillData?.skill_name, getFileContent]);

  const handleSave = useCallback(async () => {
    if (!skillData?.skill_name) return;
    let filename;
    if (isMarkdown) filename = "SKILL.md";
    else if (isReference) filename = selectedFile?.replace("references/", "");
    else filename = selectedFile?.replace("scripts/", "");
    if (!filename) return;

    const content =
      isMarkdown || isReference ? (editorRef?.current?.getMarkdown() ?? "") : editContent;

    try {
      setSaving(true);
      await saveSkillContent(skillData.skill_name, {
        filename,
        content,
      });
      toast.success("Content saved");
      onContentSaved?.();
    } catch (err) {
      console.error("Failed to save content:", err);
      if (err.type === "access_denied") {
        toast.error("Cannot save", { description: "System skills are read-only." });
      } else {
        toast.error("Failed to save", { description: err.message });
      }
    } finally {
      setSaving(false);
    }
  }, [
    skillData?.skill_name,
    isMarkdown,
    isReference,
    selectedFile,
    editContent,
    editorRef,
    onContentSaved,
  ]);

  // Template files — not editable, show info
  if (isTemplate) {
    const templateName = selectedFile.replace("templates/", "");
    return (
      <div className="skill-editor">
        <div className="skill-editor-file-header">
          <span className="skill-editor-filename">{templateName}</span>
          <span className="skill-editor-file-type">Template</span>
        </div>
        <div className="skill-editor-template-info">
          <p>This file type is not supported for inline editing.</p>
        </div>
      </div>
    );
  }

  // Reference files — TipTap markdown editor (same as SKILL.md)
  if (isReference) {
    const referenceName = selectedFile.replace("references/", "");
    const referenceContent = getFileContent();

    return (
      <div className="skill-editor">
        <div className="skill-editor-file-header">
          <span className="skill-editor-filename">{referenceName}</span>
          <span className="skill-editor-file-type">Reference</span>
          {!isSystem && (
            <div className="skill-editor-actions">
              {editing ? (
                <>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      editorRef?.current?.setContent(referenceContent);
                      setEditing(false);
                    }}
                    disabled={saving}
                  >
                    <X className="h-3.5 w-3.5 mr-1" />
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSave} disabled={saving}>
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5 mr-1" />
                    )}
                    Save
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(true)}
                  aria-label="Edit reference content"
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" />
                  Edit
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="skill-editor-markdown-area">
          <TipTapEditor
            ref={editorRef}
            content={referenceContent}
            editable={!isSystem && editing}
            placeholder="Add reference content here. This file will be loaded into the Code Interpreter and made available to the agent on demand."
          />
        </div>
      </div>
    );
  }

  // Script files — CodeMirror editor with Python syntax highlighting
  if (isScript) {
    const scriptName = selectedFile.replace("scripts/", "");

    return (
      <div className="skill-editor">
        <div className="skill-editor-file-header">
          <span className="skill-editor-filename">{scriptName}</span>
          <span className="skill-editor-file-type">Python Script</span>
          {!isSystem && (
            <div className="skill-editor-actions">
              <Button size="sm" onClick={handleSave} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Save className="h-3.5 w-3.5 mr-1" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>
        <div className="skill-editor-code-area">
          <CodeEditor
            value={editContent}
            onChange={setEditContent}
            readOnly={isSystem}
            language="python"
          />
        </div>
      </div>
    );
  }

  // Markdown file (SKILL.md) — TipTap rich text editor
  const markdownContent = getFileContent();
  const isDisabled = skillData?.is_disabled ?? false;

  return (
    <div className="skill-editor">
      <div className="skill-editor-file-header">
        <span className="skill-editor-filename">{skillData?.skill_name || "SKILL.md"}</span>
        <div className="skill-editor-toggle">
          <Switch
            size="sm"
            checked={!isDisabled}
            onCheckedChange={(checked) => onToggleSkill?.(skillData?.skill_name, !checked)}
            disabled={isToggling}
            aria-label={isDisabled ? "Enable skill" : "Disable skill"}
          />
          {isToggling && <Loader2 className="h-3 w-3 animate-spin skill-editor-toggle-spinner" />}
        </div>
        {!isSystem && (
          <div className="skill-editor-actions">
            {editing ? (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    editorRef?.current?.setContent(markdownContent);
                    setEditing(false);
                  }}
                  disabled={saving}
                >
                  <X className="h-3.5 w-3.5 mr-1" />
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSave} disabled={saving}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5 mr-1" />
                  )}
                  Save
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setEditing(true)}
                aria-label="Edit skill content"
              >
                <Pencil className="h-3.5 w-3.5 mr-1" />
                Edit
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="skill-editor-markdown-area">
        <TipTapEditor
          ref={editorRef}
          content={markdownContent}
          editable={!isSystem && editing}
          placeholder="No content yet. Start typing to add skill content."
        />
      </div>
    </div>
  );
}

export default SkillEditor;
