/**
 * Tool Configuration Page
 *
 * Provides a dedicated UI for managing tool and MCP server configurations.
 * Generates a unique configuration session ID separate from chat sessions.
 *
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, ToolCase, Loader2 } from "lucide-react";
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
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import LocalToolCard from "./LocalToolCard";
import CanvasToolCard from "./CanvasToolCard";
import MCPServerCard from "./MCPServerCard";
import AddMCPServerDialog from "./AddMCPServerDialog";
import {
  getToolConfig,
  getToolRegistry,
  saveToolConfig,
  addMCPServer,
  deleteMCPServer,
  refreshMcpTools,
} from "@/services/toolConfigService";
import "./ToolConfigPage.css";

/** Canvas creation tool IDs — rendered via CanvasToolCard instead of individual LocalToolCards */
const CANVAS_TOOL_IDS = new Set([
  "create_document",
  "create_html_canvas",
  "create_code_canvas",
  "create_diagram",
  "create_svg",
  "create_mermaid",
]);

function ToolConfigPage() {
  const navigate = useNavigate();

  // State
  const [config, setConfig] = useState(null);
  const [registry, setRegistry] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAddMCPDialog, setShowAddMCPDialog] = useState(false);
  const [refreshingServers, setRefreshingServers] = useState({}); // Track refresh state per server
  const [deletingServers, setDeletingServers] = useState({}); // Track delete state per server
  const [serverToDelete, setServerToDelete] = useState(null); // Server pending deletion confirmation

  // Ref for scroll position preservation
  const scrollAreaRef = useRef(null);

  /**
   * Fetch tool configuration and registry on mount
   */
  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);

        // Fetch both config and registry in parallel
        const [configData, registryData] = await Promise.all([getToolConfig(), getToolRegistry()]);

        setConfig(configData);
        setRegistry(registryData);
      } catch (err) {
        console.error("Failed to fetch tool configuration:", err);
        toast.error("Failed to load tool configuration", { description: err.message });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  /**
   * Handle saving tool configuration
   */
  const handleSaveConfig = useCallback(async (updatedConfig) => {
    try {
      setSaving(true);

      await saveToolConfig(updatedConfig);
      setConfig(updatedConfig);
    } catch (err) {
      console.error("Failed to save tool configuration:", err);
      toast.error("Failed to save configuration", { description: err.message });
      throw err; // Re-throw so caller can handle
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Handle toggling a local tool's enabled state
   */
  const handleToggleTool = useCallback(
    async (toolId, enabled) => {
      if (!config) return;

      const updatedConfig = {
        ...config,
        local_tools: {
          ...config.local_tools,
          [toolId]: {
            ...config.local_tools[toolId],
            enabled,
          },
        },
      };

      await handleSaveConfig(updatedConfig);
    },
    [config, handleSaveConfig]
  );

  /**
   * Handle updating a tool's configuration (e.g., API key)
   */
  const handleUpdateToolConfig = useCallback(
    async (toolId, toolConfig) => {
      if (!config) return;

      const updatedConfig = {
        ...config,
        local_tools: {
          ...config.local_tools,
          [toolId]: {
            ...config.local_tools[toolId],
            config: toolConfig,
          },
        },
      };

      await handleSaveConfig(updatedConfig);
    },
    [config, handleSaveConfig]
  );

  /**
   * Handle adding an MCP server
   */
  const handleAddMCPServer = useCallback(async (server) => {
    try {
      setSaving(true);

      // Add server config to DynamoDB — tools will be discovered by sparky at session init
      const serverConfig = {
        ...server,
        enabled: true,
        tools: {},
      };

      await addMCPServer(serverConfig);

      // Refresh config
      const updatedConfig = await getToolConfig();
      setConfig(updatedConfig);
      setShowAddMCPDialog(false);
    } catch (err) {
      console.error("Failed to add MCP server:", err);
      toast.error("Failed to add MCP server", { description: err.message });
      throw err;
    } finally {
      setSaving(false);
    }
  }, []);

  /**
   * Handle confirming deletion of an MCP server
   *
   * Tracks per-server deleting state so the dialog shows loading until complete.
   * Dialog is owned by this component so it won't get stuck when card unmounts.
   */
  const handleConfirmDeleteMCPServer = useCallback(async () => {
    if (!serverToDelete) return;

    const serverName = serverToDelete.name;
    try {
      setDeletingServers((prev) => ({ ...prev, [serverName]: true }));

      await deleteMCPServer(serverName);

      // Refresh config - this will remove the server from the list
      const updatedConfig = await getToolConfig();
      setConfig(updatedConfig);
    } catch (err) {
      console.error("Failed to delete MCP server:", err);
      toast.error("Failed to delete MCP server", { description: err.message });
    } finally {
      setDeletingServers((prev) => ({ ...prev, [serverName]: false }));
      setServerToDelete(null);
      // Force cleanup of any stuck body styles from Radix Dialog
      requestAnimationFrame(() => {
        document.body.style.pointerEvents = "";
        document.body.style.overflow = "";
      });
    }
  }, [serverToDelete]);

  /**
   * Handle toggling an MCP server's tool
   */
  const handleToggleMCPTool = useCallback(
    async (serverName, toolName, enabled) => {
      if (!config) return;

      const updatedServers = config.mcp_servers.map((server) => {
        if (server.name === serverName) {
          return {
            ...server,
            tools: {
              ...server.tools,
              [toolName]: { enabled },
            },
          };
        }
        return server;
      });

      const updatedConfig = {
        ...config,
        mcp_servers: updatedServers,
      };

      await handleSaveConfig(updatedConfig);
    },
    [config, handleSaveConfig]
  );

  /**
   * Handle refreshing MCP server tools
   */
  const handleRefreshMCPServer = useCallback(async (serverName) => {
    // Preserve scroll position
    const scrollElement = scrollAreaRef.current?.querySelector("[data-radix-scroll-area-viewport]");
    const scrollTop = scrollElement?.scrollTop || 0;

    try {
      // Set refreshing state for this server
      setRefreshingServers((prev) => ({ ...prev, [serverName]: true }));

      await refreshMcpTools(serverName);

      // Refresh config to get updated tools
      const updatedConfig = await getToolConfig();
      setConfig(updatedConfig);

      // Show success toast
      toast.success(`Successfully refreshed tools for "${serverName}"`);

      // Restore scroll position
      if (scrollElement) {
        requestAnimationFrame(() => {
          scrollElement.scrollTop = scrollTop;
        });
      }
    } catch (err) {
      console.error("Failed to refresh MCP server tools:", err);
      toast.error(`Failed to refresh tools for "${serverName}"`, { description: err.message });
    } finally {
      setRefreshingServers((prev) => ({ ...prev, [serverName]: false }));
    }
  }, []);

  // Render loading state
  if (loading) {
    return (
      <div className="tool-config-page">
        <ScrollArea className="tool-config-scroll">
          <div className="tool-config-content">
            {/* Local Tools skeleton */}
            <section className="tool-config-section">
              <Skeleton className="h-5 w-28 mb-1" />
              <Skeleton className="h-4 w-72 mb-4" />
              <div className="tool-cards-grid">
                <Skeleton className="h-40 w-full rounded-xl" />
                <Skeleton className="h-40 w-full rounded-xl" />
              </div>
            </section>

            {/* MCP Servers skeleton */}
            <section className="tool-config-section">
              <div className="section-header">
                <div>
                  <Skeleton className="h-5 w-32 mb-1" />
                  <Skeleton className="h-4 w-80" />
                </div>
                <Skeleton className="h-8 w-28 rounded-md" />
              </div>
              <div className="tool-cards-grid">
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-48 w-full rounded-xl" />
                <Skeleton className="h-48 w-full rounded-xl" />
              </div>
            </section>
          </div>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="tool-config-page">
      {/* Content */}
      <ScrollArea className="tool-config-scroll" ref={scrollAreaRef}>
        <div className="tool-config-content">
          {/* Local Tools Section */}
          <section className="tool-config-section">
            <h2 className="section-title">Local Tools</h2>
            <p className="section-description">Configure built-in tools available to the agent.</p>
            <div className="tool-cards-grid">
              {registry &&
                Object.entries(registry)
                  .filter(([toolId]) => !CANVAS_TOOL_IDS.has(toolId))
                  .map(([toolId, toolDef]) => (
                    <LocalToolCard
                      key={toolId}
                      toolId={toolId}
                      toolDefinition={toolDef}
                      toolConfig={config?.local_tools?.[toolId]}
                      onToggle={(enabled) => handleToggleTool(toolId, enabled)}
                      onUpdateConfig={(toolConfig) => handleUpdateToolConfig(toolId, toolConfig)}
                      disabled={saving}
                    />
                  ))}
              {registry && (
                <CanvasToolCard
                  registry={registry}
                  localTools={config?.local_tools}
                  onToggleTool={handleToggleTool}
                  disabled={saving}
                />
              )}
            </div>
          </section>

          {/* MCP Servers Section */}
          <section className="tool-config-section">
            <div className="section-header">
              <div>
                <h2 className="section-title">MCP Servers</h2>
                <p className="section-description">
                  Connect to Model Context Protocol servers for additional tools.
                </p>
              </div>
              <Button onClick={() => setShowAddMCPDialog(true)} disabled={saving} size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add Server
              </Button>
            </div>

            {config?.mcp_servers?.length > 0 ? (
              <div className="tool-cards-grid">
                {config.mcp_servers.map((server) => (
                  <MCPServerCard
                    key={server.name}
                    server={server}
                    onToggleTool={(toolName, enabled) =>
                      handleToggleMCPTool(server.name, toolName, enabled)
                    }
                    onDeleteClick={() => setServerToDelete(server)}
                    onRefresh={() => handleRefreshMCPServer(server.name)}
                    refreshing={refreshingServers[server.name] || false}
                    deleting={deletingServers[server.name] || false}
                    disabled={saving}
                  />
                ))}
              </div>
            ) : (
              <div className="empty-state">
                <p>No MCP servers configured. Add a server to extend agent capabilities.</p>
              </div>
            )}
          </section>
        </div>
      </ScrollArea>

      {/* Add MCP Server Dialog */}
      <AddMCPServerDialog
        open={showAddMCPDialog}
        onOpenChange={setShowAddMCPDialog}
        onAdd={handleAddMCPServer}
        disabled={saving}
      />

      {/* Delete MCP Server Confirmation Dialog */}
      <Dialog
        open={serverToDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setServerToDelete(null);
            // Force cleanup of any stuck body styles from Radix
            requestAnimationFrame(() => {
              document.body.style.pointerEvents = "";
              document.body.style.overflow = "";
            });
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete MCP Server</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete "{serverToDelete?.name}"? This will remove the server
              and all its tool configurations. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setServerToDelete(null)}
              disabled={serverToDelete && deletingServers[serverToDelete.name]}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleConfirmDeleteMCPServer}
              disabled={serverToDelete && deletingServers[serverToDelete.name]}
            >
              {serverToDelete && deletingServers[serverToDelete.name] && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {serverToDelete && deletingServers[serverToDelete.name] ? "Deleting" : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default ToolConfigPage;
