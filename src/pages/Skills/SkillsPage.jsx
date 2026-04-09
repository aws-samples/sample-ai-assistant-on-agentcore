/**
 * Skills Management Page
 *
 * Provides a sidebar + editor layout for managing user skills (SOPs).
 * Skills are standard operating procedures that the LLM can reference and execute.
 *
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { Lightbulb, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import SkillsSidebar from "./SkillsSidebar";
import SkillEditor from "./SkillEditor";
import SkillFormDialog from "./SkillFormDialog";
import {
  listSkills,
  getSkill,
  getSkillContent,
  createSkill,
  updateSkill,
  deleteSkill,
  saveSkillContent,
  deleteTemplate,
  deleteScript,
  uploadTemplate,
  uploadReference,
  deleteReference,
  toggleSkill,
} from "@/services/skillsService";
import { getUser } from "@/services/Auth/auth";
import "./SkillsPage.css";

function SkillsPage() {
  // State
  const [systemSkills, setSystemSkills] = useState([]);
  const [userSkills, setUserSkills] = useState([]);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Selection state
  const [selectedSkill, setSelectedSkill] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [selectedSkillData, setSelectedSkillData] = useState(null);
  const [loadingContent, setLoadingContent] = useState(false);

  // Dialog states
  const [showFormDialog, setShowFormDialog] = useState(false);
  const [editingSkill, setEditingSkill] = useState(null);
  const [skillToDelete, setSkillToDelete] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Toggle state
  const [togglingSkills, setTogglingSkills] = useState(new Set());

  // Add Script dialog state
  const [addScriptSkill, setAddScriptSkill] = useState(null);
  const [newScriptName, setNewScriptName] = useState("");
  const [creatingScript, setCreatingScript] = useState(false);

  // Add Reference dialog state
  const [addReferenceSkill, setAddReferenceSkill] = useState(null);
  const [newReferenceName, setNewReferenceName] = useState("");
  const [creatingReference, setCreatingReference] = useState(false);

  // Template upload ref
  const templateInputRef = useRef(null);
  const templateUploadSkillRef = useRef(null);

  // TipTap editor ref for programmatic access (AI assistant integration)
  const editorRef = useRef(null);

  // Refs for latest skills data (used in loadSkillContent to avoid stale closures)
  const systemSkillsRef = useRef(systemSkills);
  const userSkillsRef = useRef(userSkills);
  useEffect(() => {
    systemSkillsRef.current = systemSkills;
  }, [systemSkills]);
  useEffect(() => {
    userSkillsRef.current = userSkills;
  }, [userSkills]);

  // All skills combined for lookups
  const allSkills = React.useMemo(() => {
    return [...systemSkills, ...userSkills];
  }, [systemSkills, userSkills]);

  /**
   * Fetch skills on mount
   */
  useEffect(() => {
    fetchSkills();
    getUser().then((user) => {
      if (user) setCurrentUserId(user.userId);
    });
  }, []);

  const fetchSkills = useCallback(async () => {
    try {
      setLoading(true);
      const result = await listSkills();
      setSystemSkills(result.system || []);
      setUserSkills(result.user || []);
    } catch (err) {
      console.error("Failed to fetch skills:", err);
      toast.error("Failed to load skills", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Load skill content (markdown + scripts + templates) when a skill is selected.
   */
  const loadSkillContent = useCallback(async (skillName) => {
    try {
      setLoadingContent(true);
      const [skill, content] = await Promise.all([getSkill(skillName), getSkillContent(skillName)]);
      const contentData = {
        scripts: content.scripts || [],
        templates: content.templates || [],
        references: content.references || [],
      };
      // Scripts/references are {filename, content} objects — keep full objects in selectedSkillData
      // Preserve is_disabled from the list data since getSkill doesn't return it
      const listSkill = [...systemSkillsRef.current, ...userSkillsRef.current].find(
        (s) => s.skill_name === skillName
      );
      setSelectedSkillData({
        ...skill,
        markdown: content.markdown,
        ...contentData,
        is_disabled: listSkill?.is_disabled ?? skill.is_disabled ?? false,
      });
      // For the sidebar, extract just filenames so the tree renders correctly
      const sidebarData = {
        scripts: (content.scripts || []).map((s) => (typeof s === "string" ? s : s.filename)),
        templates: content.templates || [],
        references: (content.references || []).map((r) => (typeof r === "string" ? r : r.filename)),
      };
      setSystemSkills((prev) =>
        prev.map((s) => (s.skill_name === skillName ? { ...s, ...sidebarData } : s))
      );
      setUserSkills((prev) =>
        prev.map((s) => (s.skill_name === skillName ? { ...s, ...sidebarData } : s))
      );
    } catch (err) {
      console.error("Failed to load skill content:", err);
      toast.error("Failed to load skill content", { description: err.message });
      setSelectedSkillData(null);
    } finally {
      setLoadingContent(false);
    }
  }, []);

  /**
   * Handle sidebar skill selection — opens editor panel with skill content.
   */
  const handleSelectSkill = useCallback(
    (skillName) => {
      setSelectedSkill(skillName);
      setSelectedFile(null);
      loadSkillContent(skillName);
    },
    [loadSkillContent]
  );

  /**
   * Handle sidebar file selection — opens editor panel with file content.
   */
  const handleSelectFile = useCallback(
    (skillName, filePath) => {
      if (selectedSkill !== skillName) {
        loadSkillContent(skillName);
      }
      setSelectedSkill(skillName);
      setSelectedFile(filePath);
    },
    [selectedSkill, loadSkillContent]
  );

  const handleAddSkill = useCallback(() => {
    setEditingSkill(null);
    setShowFormDialog(true);
  }, []);

  /**
   * Handle editing a skill via the form dialog.
   * Can be called from context menu (with skillName) or editor header.
   */
  const handleEditSkill = useCallback(
    async (skillName) => {
      const name = skillName || selectedSkill;
      if (!name) return;
      // Find the skill to check if system
      const skill = allSkills.find((s) => s.skill_name === name);
      if (skill && (skill.user_id === "system" || skill.created_by === "system")) return;
      try {
        setSaving(true);
        const fullSkill = await getSkill(name);
        setEditingSkill(fullSkill);
        setShowFormDialog(true);
      } catch (err) {
        console.error("Failed to fetch skill:", err);
        toast.error("Failed to load skill details", { description: err.message });
      } finally {
        setSaving(false);
      }
    },
    [selectedSkill, allSkills]
  );

  const handleFormSubmit = useCallback(
    async (skillData) => {
      try {
        setSaving(true);
        if (editingSkill) {
          await updateSkill(skillData.skill_name, skillData.description, skillData.visibility);
        } else {
          await createSkill(skillData.skill_name, skillData.description, skillData.visibility);
        }
        setShowFormDialog(false);
        setEditingSkill(null);
        await fetchSkills();
        // Reload content if we edited the currently selected skill
        if (editingSkill && selectedSkill === skillData.skill_name) {
          loadSkillContent(skillData.skill_name);
        }
        // Select newly created skill
        if (!editingSkill) {
          setSelectedSkill(skillData.skill_name);
          setSelectedFile(null);
          loadSkillContent(skillData.skill_name);
        }
      } catch (err) {
        console.error("Failed to save skill:", err);
        throw err;
      } finally {
        setSaving(false);
      }
    },
    [editingSkill, fetchSkills, selectedSkill, loadSkillContent]
  );

  /**
   * Handle delete — can be called from context menu (with skillName) or editor header.
   */
  const handleDeleteSkill = useCallback(
    (skillName) => {
      const name = skillName || selectedSkill;
      if (!name) return;
      const skill = allSkills.find((s) => s.skill_name === name);
      if (!skill) return;
      if (skill.user_id === "system" || skill.created_by === "system") return;
      setSkillToDelete(skill);
    },
    [selectedSkill, allSkills]
  );

  /**
   * Handle adding a file to a skill's scripts/ folder.
   * Opens a dialog to enter the script filename.
   */
  const handleAddFile = useCallback((skillName, folder) => {
    if (folder === "scripts") {
      setAddScriptSkill(skillName);
      setNewScriptName("");
    } else if (folder === "templates") {
      templateUploadSkillRef.current = skillName;
      templateInputRef.current?.click();
    } else if (folder === "references") {
      setAddReferenceSkill(skillName);
      setNewReferenceName("");
    }
  }, []);

  /**
   * Handle template file selection from native file picker.
   */
  const handleTemplateFileChange = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      const skillName = templateUploadSkillRef.current;
      if (!file || !skillName) return;
      try {
        await uploadTemplate(skillName, file);
        toast.success(`Uploaded ${file.name}`);
        await loadSkillContent(skillName);
      } catch (err) {
        console.error("Failed to upload template:", err);
        toast.error("Upload failed", { description: err.message });
      } finally {
        if (templateInputRef.current) templateInputRef.current.value = "";
      }
    },
    [loadSkillContent]
  );

  /**
   * Confirm creating a new empty script file.
   */
  const handleConfirmAddScript = useCallback(async () => {
    if (!addScriptSkill || !newScriptName) return;
    const filename = newScriptName.endsWith(".py") ? newScriptName : `${newScriptName}.py`;
    try {
      setCreatingScript(true);
      await saveSkillContent(addScriptSkill, {
        filename: filename,
        content: "",
      });
      const skillName = addScriptSkill;
      setAddScriptSkill(null);
      setNewScriptName("");
      // Fix Radix pointer-events lock after dialog close
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      }, 0);
      // Refresh and select the new file
      await loadSkillContent(skillName);
      setSelectedSkill(skillName);
      setSelectedFile(`scripts/${filename}`);
    } catch (err) {
      console.error("Failed to create script:", err);
      toast.error("Failed to create script", { description: err.message });
    } finally {
      setCreatingScript(false);
    }
  }, [addScriptSkill, newScriptName, loadSkillContent]);

  /**
   * Confirm creating a new empty reference file.
   */
  const handleConfirmAddReference = useCallback(async () => {
    if (!addReferenceSkill || !newReferenceName) return;
    const filename = newReferenceName.endsWith(".md") ? newReferenceName : `${newReferenceName}.md`;
    try {
      setCreatingReference(true);
      await uploadReference(addReferenceSkill, filename, "");
      const skillName = addReferenceSkill;
      setAddReferenceSkill(null);
      setNewReferenceName("");
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      }, 0);
      await loadSkillContent(skillName);
      setSelectedSkill(skillName);
      setSelectedFile(`references/${filename}`);
    } catch (err) {
      console.error("Failed to create reference:", err);
      toast.error("Failed to create reference", { description: err.message });
    } finally {
      setCreatingReference(false);
    }
  }, [addReferenceSkill, newReferenceName, loadSkillContent]);

  /**
   * Handle deleting a file from a skill.
   */
  const handleDeleteFile = useCallback(
    async (skillName, filePath) => {
      if (!skillName || !filePath) return;
      if (filePath.startsWith("scripts/")) {
        const filename = filePath.replace("scripts/", "");
        try {
          await deleteScript(skillName, filename);
          toast.success(`Deleted ${filename}`);
          if (selectedSkill === skillName && selectedFile === filePath) {
            setSelectedFile(null);
          }
          await loadSkillContent(skillName);
        } catch (err) {
          console.error("Failed to delete script:", err);
          toast.error("Failed to delete script", { description: err.message });
        }
      } else if (filePath.startsWith("templates/")) {
        const filename = filePath.replace("templates/", "");
        try {
          await deleteTemplate(skillName, filename);
          toast.success(`Deleted ${filename}`);
          if (selectedSkill === skillName && selectedFile === filePath) {
            setSelectedFile(null);
          }
          await loadSkillContent(skillName);
        } catch (err) {
          console.error("Failed to delete template:", err);
          toast.error("Failed to delete template", { description: err.message });
        }
      } else if (filePath.startsWith("references/")) {
        const filename = filePath.replace("references/", "");
        try {
          await deleteReference(skillName, filename);
          toast.success(`Deleted ${filename}`);
          if (selectedSkill === skillName && selectedFile === filePath) {
            setSelectedFile(null);
          }
          await loadSkillContent(skillName);
        } catch (err) {
          console.error("Failed to delete reference:", err);
          toast.error("Failed to delete reference", { description: err.message });
        }
      }
    },
    [selectedSkill, selectedFile, loadSkillContent]
  );

  /**
   * Handle toggling a skill's enabled/disabled state.
   * Optimistic UI update with error revert.
   */
  const handleToggleSkill = useCallback(
    async (skillName, disabled) => {
      // Optimistic update
      const updateSkillList = (skills) =>
        skills.map((s) => (s.skill_name === skillName ? { ...s, is_disabled: disabled } : s));
      setSystemSkills(updateSkillList);
      setUserSkills(updateSkillList);
      if (selectedSkillData?.skill_name === skillName) {
        setSelectedSkillData((prev) => (prev ? { ...prev, is_disabled: disabled } : prev));
      }

      setTogglingSkills((prev) => new Set(prev).add(skillName));

      try {
        await toggleSkill(skillName, disabled);
      } catch (err) {
        // Revert optimistic update
        const revertSkillList = (skills) =>
          skills.map((s) => (s.skill_name === skillName ? { ...s, is_disabled: !disabled } : s));
        setSystemSkills(revertSkillList);
        setUserSkills(revertSkillList);
        if (selectedSkillData?.skill_name === skillName) {
          setSelectedSkillData((prev) => (prev ? { ...prev, is_disabled: !disabled } : prev));
        }
        toast.error("Failed to toggle skill", { description: err.message });
      } finally {
        setTogglingSkills((prev) => {
          const next = new Set(prev);
          next.delete(skillName);
          return next;
        });
      }
    },
    [selectedSkillData]
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!skillToDelete) return;
    try {
      setDeleting(true);
      await deleteSkill(skillToDelete.skill_name);
      setSkillToDelete(null);
      // Fix Radix pointer-events lock after dialog close
      setTimeout(() => {
        document.body.style.pointerEvents = "";
      }, 0);
      // Clear selection if we deleted the selected skill
      if (selectedSkill === skillToDelete.skill_name) {
        setSelectedSkill(null);
        setSelectedFile(null);
        setSelectedSkillData(null);
      }
      await fetchSkills();
    } catch (err) {
      console.error("Failed to delete skill:", err);
      toast.error("Failed to delete skill", { description: err.message });
    } finally {
      setDeleting(false);
    }
  }, [skillToDelete, selectedSkill, fetchSkills]);

  const isSystemSelected =
    selectedSkillData &&
    (selectedSkillData.user_id === "system" || selectedSkillData.created_by === "system");

  const isReadOnly =
    isSystemSelected ||
    (selectedSkillData && currentUserId && selectedSkillData.user_id !== currentUserId);

  return (
    <div className="skills-page">
      {/* Sidebar + Editor Layout */}
      <div className="skills-layout">
        <SkillsSidebar
          systemSkills={systemSkills}
          userSkills={userSkills}
          selectedSkill={selectedSkill}
          selectedFile={selectedFile}
          currentUserId={currentUserId}
          onSelectSkill={handleSelectSkill}
          onSelectFile={handleSelectFile}
          onAddSkill={handleAddSkill}
          onEditSkill={handleEditSkill}
          onDeleteSkill={handleDeleteSkill}
          onAddFile={handleAddFile}
          onDeleteFile={handleDeleteFile}
          loading={loading}
        />

        <div className="skills-editor-panel">
          {loadingContent ? (
            <div className="skills-editor-loading">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span>Loading skill content…</span>
            </div>
          ) : selectedSkillData ? (
            <div className="skills-editor-content">
              <div className="skills-editor-body">
                <SkillEditor
                  selectedFile={selectedFile}
                  skillData={selectedSkillData}
                  isSystem={isReadOnly}
                  onContentSaved={() => loadSkillContent(selectedSkill)}
                  onToggleSkill={handleToggleSkill}
                  isToggling={togglingSkills.has(selectedSkillData?.skill_name)}
                  editorRef={editorRef}
                />
              </div>
            </div>
          ) : (
            <div className="skills-editor-empty">
              <Lightbulb className="h-10 w-10 skills-editor-empty-icon" />
              <h3>Select a skill</h3>
              <p>Choose a skill from the sidebar to view or edit its content.</p>
            </div>
          )}
        </div>
      </div>

      {/* Form Dialog */}
      <SkillFormDialog
        open={showFormDialog}
        onOpenChange={(open) => {
          if (!open) {
            setShowFormDialog(false);
            setEditingSkill(null);
            setTimeout(() => {
              document.body.style.pointerEvents = "";
            }, 0);
          }
        }}
        skill={editingSkill}
        onSubmit={handleFormSubmit}
        disabled={saving}
      />

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={skillToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setSkillToDelete(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Skill</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{skillToDelete?.skill_name}&quot;? This action
              cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSkillToDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={deleting}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {deleting ? "Deleting" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Script Dialog */}
      <Dialog
        open={addScriptSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddScriptSkill(null);
            setNewScriptName("");
            setTimeout(() => {
              document.body.style.pointerEvents = "";
            }, 0);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Script</DialogTitle>
            <DialogDescription>
              Enter a filename for the new Python script. The .py extension will be added
              automatically if omitted.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="script-filename">Filename</Label>
            <Input
              id="script-filename"
              placeholder="my_script.py"
              value={newScriptName}
              onChange={(e) => setNewScriptName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newScriptName.trim()) handleConfirmAddScript();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddScriptSkill(null);
                setNewScriptName("");
              }}
              disabled={creatingScript}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAddScript}
              disabled={creatingScript || !newScriptName.trim()}
            >
              {creatingScript && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {creatingScript ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Add Reference Dialog */}
      <Dialog
        open={addReferenceSkill !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAddReferenceSkill(null);
            setNewReferenceName("");
            setTimeout(() => {
              document.body.style.pointerEvents = "";
            }, 0);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Reference</DialogTitle>
            <DialogDescription>
              Enter a filename for the new reference document. The .md extension will be added
              automatically if omitted.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="reference-filename">Filename</Label>
            <Input
              id="reference-filename"
              placeholder="charts.md"
              value={newReferenceName}
              onChange={(e) => setNewReferenceName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && newReferenceName.trim()) handleConfirmAddReference();
              }}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAddReferenceSkill(null);
                setNewReferenceName("");
              }}
              disabled={creatingReference}
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmAddReference}
              disabled={creatingReference || !newReferenceName.trim()}
            >
              {creatingReference && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {creatingReference ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Hidden file input for template uploads */}
      <input
        ref={templateInputRef}
        type="file"
        style={{ display: "none" }}
        onChange={handleTemplateFileChange}
        aria-label="Upload template file"
      />
    </div>
  );
}

export default SkillsPage;
