/**
 * AddMCPServerDialog Component
 *
 * Dialog for adding a new MCP server via JSON configuration editor.
 * Supports both streamable_http and stdio transport types.
 *
 */

import React, { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

const PLACEHOLDER_JSON = `{
  "mcpServers": {
    "my-mcp-server": {
      "command": "uvx",
      "args": ["my-mcp-package"]
    }
  }
}`;

/**
 * Normalize parsed JSON into a flat server config object.
 * Accepts either:
 *   - mcp.json wrapper: { "mcpServers": { "name": { ...config } } }
 *   - flat config:      { "name": "...", "transport": "...", ... }
 *
 * Infers transport from fields when not explicitly set:
 *   - "command" present → "stdio"
 *   - "url" present     → "streamable_http"
 *
 * Returns { config, error } — error is a string if normalization fails.
 */
function normalizeMCPConfig(parsed) {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { config: null, error: "Config must be a JSON object" };
  }

  let config;

  // Detect mcpServers wrapper format
  if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
    const entries = Object.entries(parsed.mcpServers);
    if (entries.length === 0) {
      return { config: null, error: '"mcpServers" must contain at least one server entry' };
    }
    if (entries.length > 1) {
      return { config: null, error: "Please add one server at a time" };
    }
    const [name, serverConfig] = entries[0];
    if (typeof serverConfig !== "object" || serverConfig === null) {
      return { config: null, error: `Server "${name}" config must be an object` };
    }
    config = { name, ...serverConfig };
  } else {
    config = { ...parsed };
  }

  // Infer transport if not explicitly provided
  if (!config.transport) {
    if (config.command) {
      config.transport = "stdio";
    } else if (config.url) {
      config.transport = "streamable_http";
    }
  }

  return { config, error: null };
}

/**
 * Validate a normalized flat MCP server config.
 * Returns null if valid, or an error string if invalid.
 */
function validateMCPConfig(config) {
  if (!config.name || typeof config.name !== "string" || !config.name.trim()) {
    return '"name" is required and must be a non-empty string';
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(config.name.trim())) {
    return '"name" can only contain letters, numbers, hyphens, and underscores';
  }

  const transport = config.transport;
  if (!transport) {
    return '"transport" is required (must be "streamable_http" or "stdio")';
  }
  if (transport !== "streamable_http" && transport !== "stdio") {
    return `Unsupported transport "${transport}". Must be "streamable_http" or "stdio"`;
  }

  if (transport === "streamable_http") {
    if (!config.url || typeof config.url !== "string" || !config.url.trim()) {
      return '"url" is required for streamable_http transport';
    }
    try {
      new URL(config.url.trim());
    } catch {
      return '"url" must be a valid URL';
    }
  }

  if (transport === "stdio") {
    if (!config.command || typeof config.command !== "string" || !config.command.trim()) {
      return '"command" is required for stdio transport';
    }
    if (config.args !== undefined && !Array.isArray(config.args)) {
      return '"args" must be an array if provided';
    }
  }

  return null;
}

/**
 * AddMCPServerDialog provides a JSON editor for adding new MCP servers.
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether the dialog is open
 * @param {Function} props.onOpenChange - Callback when open state changes
 * @param {Function} props.onAdd - Callback when server is added
 * @param {boolean} props.disabled - Whether interactions are disabled
 */
function AddMCPServerDialog({ open, onOpenChange, onAdd, disabled = false }) {
  const [jsonText, setJsonText] = useState("");
  const [validationError, setValidationError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const resetForm = useCallback(() => {
    setJsonText("");
    setValidationError(null);
  }, []);

  const handleOpenChange = useCallback(
    (newOpen) => {
      if (!newOpen) {
        resetForm();
      }
      onOpenChange(newOpen);
    },
    [onOpenChange, resetForm]
  );

  const handleJsonChange = useCallback((e) => {
    setJsonText(e.target.value);
    setValidationError(null);
  }, []);

  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();

      // Parse JSON
      let parsed;
      try {
        parsed = JSON.parse(jsonText);
      } catch {
        setValidationError("Invalid JSON. Please check your syntax.");
        return;
      }

      // Normalize (handles mcpServers wrapper, infers transport)
      const { config: normalized, error: normError } = normalizeMCPConfig(parsed);
      if (normError) {
        setValidationError(normError);
        return;
      }

      // Validate normalized config
      const error = validateMCPConfig(normalized);
      if (error) {
        setValidationError(error);
        return;
      }

      setSubmitting(true);

      try {
        await onAdd(normalized);
        resetForm();
      } catch (err) {
        toast.error("Failed to add MCP server", { description: err.message });
      } finally {
        setSubmitting(false);
      }
    },
    [jsonText, onAdd, resetForm]
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Add MCP Server</DialogTitle>
            <DialogDescription>
              Provide MCP server configuration as JSON. Both HTTP and stdio transports are
              supported.
            </DialogDescription>
          </DialogHeader>

          <div className="dialog-form">
            <div className="form-field">
              <Label htmlFor="mcp-json-config">
                Server Configuration <span className="required">*</span>
              </Label>
              <textarea
                id="mcp-json-config"
                value={jsonText}
                onChange={handleJsonChange}
                placeholder={PLACEHOLDER_JSON}
                disabled={disabled || submitting}
                className={`json-editor ${validationError ? "input-error" : ""}`}
                rows={8}
                spellCheck={false}
                aria-describedby="json-hint"
                aria-invalid={!!validationError}
              />
              {validationError && (
                <p className="field-error" role="alert">
                  {validationError}
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={disabled || submitting || !jsonText.trim()}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {submitting ? "Adding" : "Add Server"}
            </Button>
          </DialogFooter>
        </form>

        <style jsx>{`
          .dialog-form {
            display: flex;
            flex-direction: column;
            gap: 1rem;
            padding: 1rem 0;
          }

          .form-field {
            display: flex;
            flex-direction: column;
            gap: 0.375rem;
          }

          .form-field label {
            font-size: 0.875rem;
            font-weight: 500;
          }

          .required {
            color: var(--color-destructive, #ef4444);
          }

          .json-editor {
            width: 100%;
            min-height: 160px;
            padding: 0.75rem;
            border: 1px solid var(--color-border);
            border-radius: 8px;
            background-color: var(--color-muted, #f4f4f5);
            color: var(--color-foreground);
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
            font-size: 0.8125rem;
            line-height: 1.5;
            resize: vertical;
            tab-size: 2;
          }

          .json-editor:focus {
            outline: none;
            border-color: var(--color-ring);
            box-shadow: 0 0 0 1px var(--color-ring);
          }

          .json-editor:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }

          .input-error {
            border-color: var(--color-destructive, #ef4444);
          }

          .field-error {
            font-size: 0.75rem;
            color: var(--color-destructive, #ef4444);
            margin: 0;
          }

          .field-hint {
            font-size: 0.6875rem;
            color: var(--color-muted-foreground);
            margin: 0;
            white-space: pre-wrap;
            font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
            line-height: 1.6;
          }

          .submit-error {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem;
            border-radius: 8px;
            background-color: var(--color-destructive-foreground, #fef2f2);
            color: var(--color-destructive, #ef4444);
            font-size: 0.875rem;
          }
        `}</style>
      </DialogContent>
    </Dialog>
  );
}

export default AddMCPServerDialog;
