import React, { useState, useCallback } from "react";
import {
  Paperclip,
  Zap,
  Monitor,
  Paintbrush,
  FolderOpen,
  ChevronRight,
  ChevronLeft,
  Loader2,
  X,
} from "lucide-react";
import { useTheme } from "../ThemeContext";
import { listProjects } from "../../services/projectsService";
import { Button } from "@/components/ui/button";

const AttachmentMenu = ({
  onAttachFile,
  onEnableDeepAgent,
  deepAgentEnabled,
  onEnableBrowser,
  browserEnabled,
  onEnableCanvas,
  canvasEnabled,
  onSelectProject,
  onUnbindProject,
  onDeleteProjectCanvas,
  boundProject,
}) => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === "dark";
  const [hoveredId, setHoveredId] = useState(null);
  const [showProjectSubmenu, setShowProjectSubmenu] = useState(false);
  const [projectList, setProjectList] = useState([]);
  const [projectListLoading, setProjectListLoading] = useState(false);

  const openProjectSubmenu = useCallback(async () => {
    setShowProjectSubmenu(true);
    setProjectListLoading(true);
    try {
      const data = await listProjects();
      setProjectList(data.projects || []);
    } catch {
      setProjectList([]);
    } finally {
      setProjectListLoading(false);
    }
  }, []);

  const menuItems = [
    { id: "attach-file", label: "Attach file", icon: Paperclip, onClick: onAttachFile },
    {
      id: "deep-agent",
      label: "Research",
      icon: Zap,
      onClick: onEnableDeepAgent,
      isToggle: true,
      isActive: deepAgentEnabled,
    },
    {
      id: "browser",
      label: "Browser",
      icon: Monitor,
      onClick: onEnableBrowser,
      isToggle: true,
      isActive: browserEnabled,
    },
    {
      id: "canvas",
      label: "Canvas",
      icon: Paintbrush,
      onClick: onEnableCanvas,
      isToggle: true,
      isActive: canvasEnabled,
    },
    {
      id: "project",
      label: boundProject ? boundProject.name : "Project",
      icon: FolderOpen,
      onClick: openProjectSubmenu,
      isToggle: true,
      isActive: Boolean(boundProject),
      hasSubmenu: true,
    },
  ];

  const s = {
    container: { padding: "4px", minWidth: "200px" },
    item: {
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "7px 10px",
      cursor: "pointer",
      transition: "background 0.15s ease",
      borderRadius: "8px",
      margin: "1px 0",
    },
    itemHover: { background: isDark ? "hsl(0 0% 25.1%)" : "#f4f4f5" },
    itemActive: { background: isDark ? "rgba(59, 130, 246, 0.2)" : "rgba(59, 130, 246, 0.15)" },
    icon: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "28px",
      height: "28px",
      borderRadius: "7px",
      background: isDark ? "hsl(0 0% 25.1%)" : "#f4f4f5",
      color: isDark ? "#a1a1aa" : "#71717a",
      flexShrink: 0,
    },
    iconActive: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "28px",
      height: "28px",
      borderRadius: "7px",
      background: isDark ? "rgba(96, 165, 250, 0.2)" : "rgba(59, 130, 246, 0.15)",
      color: isDark ? "#60a5fa" : "#3b82f6",
      flexShrink: 0,
    },
    label: { fontSize: "13px", fontWeight: 500, color: isDark ? "#fafaf9" : "#18181b", flex: 1 },
    labelActive: {
      fontSize: "13px",
      fontWeight: 500,
      color: isDark ? "#60a5fa" : "#3b82f6",
      flex: 1,
    },
    chevron: { color: isDark ? "#71717a" : "#a1a1aa" },
    subheader: {
      display: "flex",
      alignItems: "center",
      gap: "6px",
      padding: "4px 6px 6px",
      marginBottom: "2px",
      borderBottom: `1px solid ${isDark ? "hsl(0 0% 20%)" : "#e4e4e7"}`,
    },
    backBtn: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "24px",
      height: "24px",
      borderRadius: "6px",
      border: "none",
      background: "transparent",
      cursor: "pointer",
      color: isDark ? "#a1a1aa" : "#71717a",
      padding: 0,
    },
    subheaderLabel: {
      fontSize: "12px",
      fontWeight: 600,
      color: isDark ? "#a1a1aa" : "#71717a",
      flex: 1,
    },
    projectItem: {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "7px 10px",
      cursor: "pointer",
      borderRadius: "8px",
      margin: "1px 0",
      transition: "background 0.15s ease",
    },
    emptyText: {
      fontSize: "12px",
      color: isDark ? "#71717a" : "#a1a1aa",
      textAlign: "center",
      padding: "12px 8px",
    },
  };

  if (showProjectSubmenu) {
    return (
      <div style={{ padding: "4px", minWidth: "200px" }}>
        <div style={s.subheader}>
          <button style={s.backBtn} onClick={() => setShowProjectSubmenu(false)}>
            <ChevronLeft size={15} />
          </button>
          <span style={s.subheaderLabel}>Projects</span>
          {boundProject && (
            <button
              style={s.backBtn}
              title="Unbind project"
              onClick={() => {
                onUnbindProject();
                setShowProjectSubmenu(false);
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {projectListLoading ? (
          <div style={{ display: "flex", justifyContent: "center", padding: "16px" }}>
            <Loader2
              size={16}
              style={{
                animation: "spin 0.8s linear infinite",
                color: isDark ? "#a1a1aa" : "#71717a",
              }}
            />
          </div>
        ) : projectList.length === 0 ? (
          <div style={s.emptyText}>No projects yet</div>
        ) : (
          projectList.map((p) => {
            const isSelected = boundProject?.project_id === p.project_id;
            return (
              <div
                key={p.project_id}
                style={{
                  ...s.projectItem,
                  ...(hoveredId === p.project_id ? s.itemHover : {}),
                  ...(isSelected ? s.itemActive : {}),
                }}
                onMouseEnter={() => setHoveredId(p.project_id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => {
                  onSelectProject(p);
                  setShowProjectSubmenu(false);
                }}
              >
                <FolderOpen
                  size={14}
                  style={{
                    color: isSelected
                      ? isDark
                        ? "#60a5fa"
                        : "#3b82f6"
                      : isDark
                        ? "#a1a1aa"
                        : "#71717a",
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: isSelected ? 500 : 400,
                    color: isSelected
                      ? isDark
                        ? "#60a5fa"
                        : "#3b82f6"
                      : isDark
                        ? "#fafaf9"
                        : "#18181b",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {p.name}
                </span>
                {isSelected && (
                  <span style={{ fontSize: "10px", color: isDark ? "#60a5fa" : "#3b82f6" }}>✓</span>
                )}
              </div>
            );
          })
        )}
      </div>
    );
  }

  return (
    <div style={s.container}>
      {menuItems.map((item) => {
        const Icon = item.icon;
        const isActive = item.isToggle && item.isActive;
        return (
          <div
            key={item.id}
            style={{
              ...s.item,
              ...(hoveredId === item.id ? s.itemHover : {}),
              ...(isActive ? s.itemActive : {}),
            }}
            onClick={item.onClick}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <div style={isActive ? s.iconActive : s.icon}>
              <Icon size={16} />
            </div>
            <span style={isActive ? s.labelActive : s.label}>{item.label}</span>
            {item.hasSubmenu && <ChevronRight size={14} style={s.chevron} />}
          </div>
        );
      })}
    </div>
  );
};

export default AttachmentMenu;
