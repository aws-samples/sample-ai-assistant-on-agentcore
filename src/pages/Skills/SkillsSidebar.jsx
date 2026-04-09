/**
 * SkillsSidebar Component
 *
 * Tree-style file explorer for skills. Includes:
 * - "Add Skill" button at the top
 * - Right-click context menus on skills (Edit / Delete), folders (Add file), and files (Delete)
 * - Description shown via HoverCard on info icon
 * - System skills shown with badge, no mutation actions
 *
 */

import React, { useState } from "react";
import {
  ChevronRight,
  FileText,
  FileCode,
  FolderOpen,
  Folder,
  Info,
  Plus,
  Pencil,
  Trash2,
  FilePlus,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "@/components/ui/hover-card";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from "@/components/ui/context-menu";
import "./SkillsSidebar.css";

/**
 * @param {Object} props
 * @param {Array} props.skills
 * @param {string|null} props.selectedSkill
 * @param {string|null} props.selectedFile
 * @param {Function} props.onSelectSkill - (skillName)
 * @param {Function} props.onSelectFile - (skillName, filePath)
 * @param {Function} props.onAddSkill - ()
 * @param {Function} props.onEditSkill - (skillName)
 * @param {Function} props.onDeleteSkill - (skillName)
 * @param {Function} props.onAddFile - (skillName, folder: "scripts"|"templates"|"references")
 * @param {Function} props.onDeleteFile - (skillName, filePath)
 * @param {boolean} props.loading
 */
function SkillsSidebar({
  systemSkills = [],
  userSkills = [],
  selectedSkill = null,
  selectedFile = null,
  currentUserId = null,
  onSelectSkill,
  onSelectFile,
  onAddSkill,
  onEditSkill,
  onDeleteSkill,
  onAddFile,
  onDeleteFile,
  loading = false,
}) {
  const [expandedSkills, setExpandedSkills] = useState({});
  const [expandedFolders, setExpandedFolders] = useState({});

  const toggleSkill = (skillName) => {
    setExpandedSkills((prev) => ({ ...prev, [skillName]: !prev[skillName] }));
  };

  const toggleFolder = (key) => {
    setExpandedFolders((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isSystemSkill = (skill) => skill.user_id === "system" || skill.created_by === "system";

  const isReadOnlySkill = (skill) =>
    isSystemSkill(skill) || (currentUserId && skill.user_id !== currentUserId);

  const renderFileTree = (skill, readOnly = false) => {
    const isReadOnly = readOnly;
    const scripts = skill.scripts || [];
    const templates = skill.templates || [];
    const references = skill.references || [];
    const scriptsKey = `${skill.skill_name}/scripts`;
    const templatesKey = `${skill.skill_name}/templates`;
    const referencesKey = `${skill.skill_name}/references`;
    const scriptsExpanded = expandedFolders[scriptsKey] || false;
    const templatesExpanded = expandedFolders[templatesKey] || false;
    const referencesExpanded = expandedFolders[referencesKey] || false;

    return (
      <ul className="tree-children">
        {/* SKILL.md */}
        <li>
          <button
            className={`tree-file ${selectedSkill === skill.skill_name && selectedFile === "SKILL.md" ? "tree-file-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onSelectFile?.(skill.skill_name, "SKILL.md");
            }}
          >
            <FileText className="tree-file-icon" />
            <span>SKILL.md</span>
          </button>
        </li>

        {/* scripts/ folder */}
        <li>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="tree-folder-row">
                <button
                  className="tree-folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(scriptsKey);
                  }}
                >
                  <ChevronRight
                    className={`tree-chevron ${scriptsExpanded ? "tree-chevron-open" : ""}`}
                  />
                  {scriptsExpanded ? (
                    <FolderOpen className="tree-folder-icon" />
                  ) : (
                    <Folder className="tree-folder-icon" />
                  )}
                  <span>scripts</span>
                </button>
              </div>
            </ContextMenuTrigger>
            {!isReadOnly && (
              <ContextMenuContent>
                <ContextMenuItem onClick={() => onAddFile?.(skill.skill_name, "scripts")}>
                  <FilePlus className="h-4 w-4" />
                  Add Script
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
          {scriptsExpanded && (
            <ul className="tree-children">
              {scripts.length > 0 ? (
                scripts.map((script) => (
                  <li key={script}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          className={`tree-file ${selectedSkill === skill.skill_name && selectedFile === `scripts/${script}` ? "tree-file-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFile?.(skill.skill_name, `scripts/${script}`);
                          }}
                        >
                          <FileCode className="tree-file-icon" />
                          <span>{script}</span>
                        </button>
                      </ContextMenuTrigger>
                      {!isReadOnly && (
                        <ContextMenuContent>
                          <ContextMenuItem
                            className="text-destructive menu-item-delete"
                            onClick={() => onDeleteFile?.(skill.skill_name, `scripts/${script}`)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </ContextMenuItem>
                        </ContextMenuContent>
                      )}
                    </ContextMenu>
                  </li>
                ))
              ) : (
                <li className="tree-empty">
                  <span className="tree-empty-text">No scripts</span>
                </li>
              )}
            </ul>
          )}
        </li>

        {/* templates/ folder */}
        <li>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="tree-folder-row">
                <button
                  className="tree-folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(templatesKey);
                  }}
                >
                  <ChevronRight
                    className={`tree-chevron ${templatesExpanded ? "tree-chevron-open" : ""}`}
                  />
                  {templatesExpanded ? (
                    <FolderOpen className="tree-folder-icon" />
                  ) : (
                    <Folder className="tree-folder-icon" />
                  )}
                  <span>templates</span>
                </button>
              </div>
            </ContextMenuTrigger>
            {!isReadOnly && (
              <ContextMenuContent>
                <ContextMenuItem onClick={() => onAddFile?.(skill.skill_name, "templates")}>
                  <FilePlus className="h-4 w-4" />
                  Add Template
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
          {templatesExpanded && (
            <ul className="tree-children">
              {templates.length > 0 ? (
                templates.map((tpl) => (
                  <li key={tpl}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          className={`tree-file ${selectedSkill === skill.skill_name && selectedFile === `templates/${tpl}` ? "tree-file-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFile?.(skill.skill_name, `templates/${tpl}`);
                          }}
                        >
                          <FileText className="tree-file-icon" />
                          <span>{tpl}</span>
                        </button>
                      </ContextMenuTrigger>
                      {!isReadOnly && (
                        <ContextMenuContent>
                          <ContextMenuItem
                            className="text-destructive menu-item-delete"
                            onClick={() => onDeleteFile?.(skill.skill_name, `templates/${tpl}`)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </ContextMenuItem>
                        </ContextMenuContent>
                      )}
                    </ContextMenu>
                  </li>
                ))
              ) : (
                <li className="tree-empty">
                  <span className="tree-empty-text">No templates</span>
                </li>
              )}
            </ul>
          )}
        </li>

        {/* references/ folder */}
        <li>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div className="tree-folder-row">
                <button
                  className="tree-folder"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFolder(referencesKey);
                  }}
                >
                  <ChevronRight
                    className={`tree-chevron ${referencesExpanded ? "tree-chevron-open" : ""}`}
                  />
                  {referencesExpanded ? (
                    <FolderOpen className="tree-folder-icon" />
                  ) : (
                    <Folder className="tree-folder-icon" />
                  )}
                  <span>references</span>
                </button>
              </div>
            </ContextMenuTrigger>
            {!isReadOnly && (
              <ContextMenuContent>
                <ContextMenuItem onClick={() => onAddFile?.(skill.skill_name, "references")}>
                  <FilePlus className="h-4 w-4" />
                  Add Reference
                </ContextMenuItem>
              </ContextMenuContent>
            )}
          </ContextMenu>
          {referencesExpanded && (
            <ul className="tree-children">
              {references.length > 0 ? (
                references.map((ref) => (
                  <li key={ref}>
                    <ContextMenu>
                      <ContextMenuTrigger asChild>
                        <button
                          className={`tree-file ${selectedSkill === skill.skill_name && selectedFile === `references/${ref}` ? "tree-file-active" : ""}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectFile?.(skill.skill_name, `references/${ref}`);
                          }}
                        >
                          <FileText className="tree-file-icon" />
                          <span>{ref}</span>
                        </button>
                      </ContextMenuTrigger>
                      {!isReadOnly && (
                        <ContextMenuContent>
                          <ContextMenuItem
                            className="text-destructive menu-item-delete"
                            onClick={() => onDeleteFile?.(skill.skill_name, `references/${ref}`)}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </ContextMenuItem>
                        </ContextMenuContent>
                      )}
                    </ContextMenu>
                  </li>
                ))
              ) : (
                <li className="tree-empty">
                  <span className="tree-empty-text">No references</span>
                </li>
              )}
            </ul>
          )}
        </li>
      </ul>
    );
  };

  const renderSkillItem = (skill, readOnly = false) => {
    const isReadOnly = readOnly;
    const isSysSkill = isSystemSkill(skill);
    const isExpanded = expandedSkills[skill.skill_name] || false;

    return (
      <li key={skill.skill_name} className="tree-item">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div className="tree-skill-row">
              <button
                className={`tree-skill-button ${isExpanded ? "tree-skill-button-expanded" : ""}`}
                onClick={() => {
                  toggleSkill(skill.skill_name);
                  if (selectedSkill !== skill.skill_name) {
                    onSelectSkill?.(skill.skill_name);
                  }
                }}
              >
                <ChevronRight className={`tree-chevron ${isExpanded ? "tree-chevron-open" : ""}`} />
                <span className="tree-skill-name">{skill.skill_name}</span>
                <HoverCard openDelay={300} closeDelay={100}>
                  <HoverCardTrigger asChild>
                    <span
                      className="tree-info-button"
                      role="button"
                      tabIndex={0}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={`Info about ${skill.skill_name}`}
                    >
                      <Info className="h-3.5 w-3.5" />
                    </span>
                  </HoverCardTrigger>
                  <HoverCardContent side="right" className="tree-hover-card">
                    {skill.description && (
                      <p className="tree-hover-card-text">{skill.description}</p>
                    )}
                  </HoverCardContent>
                </HoverCard>
              </button>
            </div>
          </ContextMenuTrigger>
          {!isReadOnly && (
            <ContextMenuContent>
              <ContextMenuItem onClick={() => onEditSkill?.(skill.skill_name)}>
                <Pencil className="h-4 w-4" />
                Edit Skill
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem
                className="text-destructive menu-item-delete"
                onClick={() => onDeleteSkill?.(skill.skill_name)}
              >
                <Trash2 className="h-4 w-4" />
                Delete Skill
              </ContextMenuItem>
            </ContextMenuContent>
          )}
        </ContextMenu>

        {isExpanded && renderFileTree(skill, readOnly)}
      </li>
    );
  };

  if (loading) {
    return (
      <div className="skills-sidebar">
        <div className="skills-sidebar-top">
          <Button size="sm" className="skills-sidebar-add-btn" disabled>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add Skill
          </Button>
        </div>
        <div className="skills-sidebar-loading">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skills-sidebar-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="skills-sidebar">
      <div className="skills-sidebar-top">
        <Button size="sm" className="skills-sidebar-add-btn" onClick={onAddSkill}>
          <Plus className="h-3.5 w-3.5 mr-1" />
          Add Skill
        </Button>
      </div>
      <ScrollArea className="skills-sidebar-scroll">
        {/* System Skills */}
        {systemSkills.length > 0 && (
          <div className="skills-sidebar-section">
            <h3 className="skills-sidebar-section-label">System</h3>
            <ul className="tree-root">{systemSkills.map((s) => renderSkillItem(s, true))}</ul>
          </div>
        )}

        {/* User Skills */}
        <div className="skills-sidebar-section">
          <h3 className="skills-sidebar-section-label">My Skills</h3>
          {userSkills.length > 0 ? (
            <ul className="tree-root">{userSkills.map((s) => renderSkillItem(s, false))}</ul>
          ) : (
            <div className="skills-sidebar-empty">
              <p>No skills yet</p>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

export default SkillsSidebar;
