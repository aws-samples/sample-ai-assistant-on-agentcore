/**
 * MCPServerCard Component
 *
 * Displays an MCP server with its tools list.
 * Allows enabling/disabling individual MCP tools, deleting the server,
 * and refreshing tools from the server.
 *
 */

import React, { useState, useCallback } from "react";
import {
  Server,
  Trash2,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  AlertCircle,
  Check,
  Clock,
  MoreVertical,
} from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * MCPServerCard displays an MCP server with its tools.
 *
 * @param {Object} props
 * @param {Object} props.server - The MCP server configuration
 * @param {Function} props.onToggleTool - Callback when a tool is toggled
 * @param {Function} props.onDeleteClick - Callback when delete is clicked (opens dialog in parent)
 * @param {Function} props.onRefresh - Callback when server tools are refreshed
 * @param {boolean} props.refreshing - Whether the server is currently refreshing
 * @param {boolean} props.deleting - Whether the server is being deleted (managed by parent)
 * @param {boolean} props.disabled - Whether interactions are disabled
 */
function MCPServerCard({
  server,
  onToggleTool,
  onDeleteClick,
  onRefresh,
  refreshing = false,
  deleting = false,
  disabled = false,
}) {
  const [expanded, setExpanded] = useState(true);

  const tools = server.tools || {};
  const toolCount = Object.keys(tools).length;
  const enabledToolCount = Object.values(tools).filter((t) => t.enabled).length;

  /**
   * Handle tool toggle
   */
  const handleToggleTool = useCallback(
    async (toolName, enabled) => {
      try {
        await onToggleTool(toolName, enabled);
      } catch (err) {
        console.error("Failed to toggle MCP tool:", err);
      }
    },
    [onToggleTool]
  );

  /**
   * Handle refresh tools
   */
  const handleRefresh = useCallback(async () => {
    try {
      await onRefresh();
    } catch (err) {
      console.error("Failed to refresh MCP tools:", err);
    }
  }, [onRefresh]);

  /**
   * Get status indicator configuration
   */
  const getStatusConfig = (status) => {
    switch (status) {
      case "available":
        return {
          icon: Check,
          className: "status-available",
          label: "Available",
        };
      case "unavailable":
        return {
          icon: AlertCircle,
          className: "status-unavailable",
          label: "Unavailable",
        };
      case "error":
        return {
          icon: AlertCircle,
          className: "status-error",
          label: "Error",
        };
      default:
        return {
          icon: Clock,
          className: "status-unknown",
          label: "Unknown",
        };
    }
  };

  /**
   * Format last refresh timestamp
   */
  const formatLastRefresh = (timestamp) => {
    if (!timestamp) return null;
    try {
      const date = new Date(timestamp);
      return date.toLocaleString();
    } catch {
      return null;
    }
  };

  const statusConfig = getStatusConfig(server.status);
  const StatusIcon = statusConfig.icon;
  const lastRefreshFormatted = formatLastRefresh(server.last_refresh);

  // Card is disabled during delete or other operations
  const isDisabled = disabled || deleting;

  return (
    <>
      <Card className="mcp-server-card overflow-hidden">
        <CardHeader className="pb-3 !block">
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3 flex-1 min-w-0 overflow-hidden">
              <div className="server-icon">
                <Server className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0 overflow-hidden">
                <div className="flex items-center gap-1.5">
                  <CardTitle className="text-base truncate">{server.name}</CardTitle>
                  <span
                    className={`status-badge flex-shrink-0 ${statusConfig.className}`}
                    title={statusConfig.label}
                  >
                    <StatusIcon className="h-3.5 w-3.5" />
                  </span>
                </div>
                <CardDescription
                  className="mt-1 truncate"
                  title={
                    server.transport === "stdio"
                      ? `${server.command || ""} ${(server.args || []).join(" ")}`.trim()
                      : server.url
                  }
                >
                  {server.transport === "stdio"
                    ? `${server.command || "python"}${server.args?.length ? " " + server.args.join(" ") : ""}`
                    : server.url}
                </CardDescription>
                {lastRefreshFormatted && (
                  <p className="last-refresh-text">Last refreshed: {lastRefreshFormatted}</p>
                )}
              </div>
            </div>
            <div className="flex items-start flex-shrink-0 -mr-4 -mt-1">
              {/* Ellipsis dropdown menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={isDisabled || refreshing}
                    className="menu-button h-8 w-8"
                  >
                    {refreshing ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <MoreVertical className="h-4 w-4" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleRefresh} disabled={refreshing || deleting}>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Refresh tools
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setTimeout(onDeleteClick, 0)}
                    className="text-destructive focus:text-destructive menu-item-delete"
                    disabled={deleting}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete server
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </CardHeader>

        <CardContent className="pt-0">
          {/* Tools section header */}
          <button
            className="tools-header"
            onClick={() => setExpanded(!expanded)}
            disabled={toolCount === 0}
          >
            <span className="tools-count">
              {enabledToolCount}/{toolCount} tools enabled
            </span>
            {toolCount > 0 &&
              (expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />)}
          </button>

          {/* Tools list */}
          {expanded && toolCount > 0 && (
            <div className="tools-list">
              {Object.entries(tools).map(([toolName, toolConfig]) => (
                <div key={toolName} className="tool-item">
                  <div className="tool-info">
                    <span className="tool-name">{toolName}</span>
                  </div>
                  <Switch
                    checked={toolConfig.enabled}
                    onCheckedChange={(checked) => handleToggleTool(toolName, checked)}
                    disabled={isDisabled}
                    size="sm"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {toolCount === 0 && (
            <p className="no-tools-message">No tools available from this server.</p>
          )}
        </CardContent>

        <style jsx>{`
          .mcp-server-card {
            transition: box-shadow 0.2s ease;
          }

          .mcp-server-card:hover {
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
          }

          .server-icon {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 36px;
            height: 36px;
            border-radius: 8px;
            background-color: var(--color-primary);
            color: var(--color-primary-foreground);
            flex-shrink: 0;
          }

          .status-badge {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            width: 18px;
            height: 18px;
            border-radius: 50%;
          }

          .status-available {
            background-color: var(--color-success, #22c55e);
            color: white;
          }

          .status-unavailable {
            background-color: var(--color-warning, #f59e0b);
            color: white;
          }

          .status-error {
            background-color: var(--color-destructive, #ef4444);
            color: white;
          }

          .status-unknown {
            background-color: var(--color-muted-foreground);
            color: white;
          }

          .last-refresh-text {
            font-size: 0.625rem;
            color: var(--color-muted-foreground);
            margin-top: 0.25rem;
          }

          .menu-button {
            color: var(--color-muted-foreground);
          }

          .menu-button:hover {
            color: var(--color-foreground);
          }

          .tools-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            width: 100%;
            padding: 0.5rem 0;
            border: none;
            background: none;
            cursor: pointer;
            color: var(--color-muted-foreground);
            font-size: 0.75rem;
            border-top: 1px solid var(--color-border);
          }

          .tools-header:disabled {
            cursor: default;
          }

          .tools-count {
            font-weight: 500;
          }

          .tools-list {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            padding-top: 0.5rem;
          }

          .tool-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 0.5rem;
            border-radius: 6px;
            background-color: var(--color-muted);
          }

          .tool-info {
            flex: 1;
            min-width: 0;
          }

          .tool-name {
            font-size: 0.875rem;
            font-weight: 500;
            color: var(--color-foreground);
          }

          .no-tools-message {
            font-size: 0.75rem;
            color: var(--color-muted-foreground);
            text-align: center;
            padding: 0.5rem 0;
            margin: 0;
          }
        `}</style>
      </Card>
    </>
  );
}

export default MCPServerCard;
