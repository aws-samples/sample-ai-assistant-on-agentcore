/**
 * LocalToolCard Component
 *
 * Displays a local tool with toggle switch and configuration form.
 * Shows configuration status indicator for tools requiring config.
 *
 */

import React, { useState, useCallback } from "react";
import { AlertCircle, Check, Eye, EyeOff } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

/**
 * LocalToolCard displays a local tool with its configuration options.
 *
 * @param {Object} props
 * @param {string} props.toolId - The tool identifier
 * @param {Object} props.toolDefinition - The tool definition from registry
 * @param {Object} props.toolConfig - The user's configuration for this tool
 * @param {Function} props.onToggle - Callback when tool is toggled
 * @param {Function} props.onUpdateConfig - Callback when config is updated
 * @param {boolean} props.disabled - Whether interactions are disabled
 */
function LocalToolCard({
  toolId,
  toolDefinition,
  toolConfig,
  onToggle,
  onUpdateConfig,
  disabled = false,
}) {
  const [configValues, setConfigValues] = useState(toolConfig?.config || {});
  const [showPasswords, setShowPasswords] = useState({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const isEnabled = toolConfig?.enabled ?? toolDefinition.enabled_by_default;
  const requiresConfig = toolDefinition.requires_config;
  const configFields = toolDefinition.config_fields || [];

  // Check if all required config fields are filled
  const hasRequiredConfig = configFields
    .filter((field) => field.required)
    .every((field) => {
      const value = configValues[field.name];
      return value && value.trim().length > 0;
    });

  // Determine configuration status
  const getConfigStatus = () => {
    if (!requiresConfig) return "none";
    if (hasRequiredConfig) return "configured";
    return "needs-config";
  };

  const configStatus = getConfigStatus();

  /**
   * Handle toggle with validation
   */
  const handleToggle = useCallback(
    async (checked) => {
      // If enabling and requires config but not configured, prevent toggle
      if (checked && requiresConfig && !hasRequiredConfig) {
        setError("Please configure required fields before enabling");
        return;
      }

      setError(null);
      try {
        await onToggle(checked);
      } catch (err) {
        setError(err.message || "Failed to update tool");
      }
    },
    [onToggle, requiresConfig, hasRequiredConfig]
  );

  /**
   * Handle config field change
   */
  const handleConfigChange = useCallback((fieldName, value) => {
    setConfigValues((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
    setError(null);
  }, []);

  /**
   * Handle saving configuration
   */
  const handleSaveConfig = useCallback(async () => {
    setSaving(true);
    setError(null);

    try {
      await onUpdateConfig(configValues);
    } catch (err) {
      setError(err.message || "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  }, [configValues, onUpdateConfig]);

  /**
   * Toggle password visibility
   */
  const togglePasswordVisibility = useCallback((fieldName) => {
    setShowPasswords((prev) => ({
      ...prev,
      [fieldName]: !prev[fieldName],
    }));
  }, []);

  /**
   * Check if config has changed from saved values
   */
  const hasUnsavedChanges = () => {
    const savedConfig = toolConfig?.config || {};
    return configFields.some((field) => configValues[field.name] !== savedConfig[field.name]);
  };

  return (
    <Card className="local-tool-card">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex-1">
            <CardTitle className="text-base flex items-center gap-2">
              {toolDefinition.name}
              {/* Configuration status indicator */}
              {requiresConfig && (
                <span
                  className={`config-status-badge ${configStatus}`}
                  title={configStatus === "configured" ? "Configured" : "Configuration required"}
                >
                  {configStatus === "configured" ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <AlertCircle className="h-3 w-3" />
                  )}
                </span>
              )}
            </CardTitle>
            <CardDescription className="mt-1">{toolDefinition.description}</CardDescription>
          </div>
          <Switch
            checked={isEnabled}
            onCheckedChange={handleToggle}
            disabled={disabled || saving}
            size="sm"
          />
        </div>
      </CardHeader>

      {/* Configuration form for tools that require config */}
      {requiresConfig && configFields.length > 0 && (
        <CardContent className="pt-0">
          <div className="config-form">
            {configFields.map((field) => (
              <div key={field.name} className="config-field">
                <Label htmlFor={`${toolId}-${field.name}`} className="config-label">
                  {field.label}
                  {field.required && <span className="required-marker">*</span>}
                </Label>
                <div className="config-input-wrapper">
                  <Input
                    id={`${toolId}-${field.name}`}
                    type={
                      field.type === "password" && !showPasswords[field.name]
                        ? "password"
                        : field.type === "number"
                          ? "number"
                          : "text"
                    }
                    value={configValues[field.name] || ""}
                    onChange={(e) => handleConfigChange(field.name, e.target.value)}
                    placeholder={field.default || `Enter ${field.label.toLowerCase()}`}
                    disabled={disabled || saving}
                    className="config-input"
                  />
                  {field.type === "password" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="password-toggle"
                      onClick={() => togglePasswordVisibility(field.name)}
                      disabled={disabled || saving}
                    >
                      {showPasswords[field.name] ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}

            {/* Save button */}
            {hasUnsavedChanges() && (
              <Button
                onClick={handleSaveConfig}
                disabled={disabled || saving}
                size="sm"
                className="save-config-button"
              >
                {saving ? "Saving..." : "Save Configuration"}
              </Button>
            )}
          </div>

          {/* Error message */}
          {error && (
            <p className="config-error">
              <AlertCircle className="h-3 w-3" />
              {error}
            </p>
          )}
        </CardContent>
      )}

      <style jsx>{`
        .local-tool-card {
          transition: box-shadow 0.2s ease;
        }

        .local-tool-card:hover {
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
        }

        .config-status-badge {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 18px;
          height: 18px;
          border-radius: 50%;
        }

        .config-status-badge.configured {
          background-color: var(--color-success, #22c55e);
          color: white;
        }

        .config-status-badge.needs-config {
          background-color: var(--color-warning, #f59e0b);
          color: white;
        }

        .config-form {
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
          padding-top: 0.5rem;
          border-top: 1px solid var(--color-border);
        }

        .config-field {
          display: flex;
          flex-direction: column;
          gap: 0.25rem;
        }

        .config-label {
          font-size: 0.75rem;
          font-weight: 500;
          color: var(--color-muted-foreground);
        }

        .required-marker {
          color: var(--color-destructive, #ef4444);
          margin-left: 2px;
        }

        .config-input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
        }

        .config-input {
          flex: 1;
          font-size: 0.875rem;
        }

        .password-toggle {
          position: absolute;
          right: 4px;
          height: 28px;
          width: 28px;
        }

        .save-config-button {
          margin-top: 0.5rem;
          align-self: flex-start;
        }

        .config-error {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          margin-top: 0.5rem;
          font-size: 0.75rem;
          color: var(--color-destructive, #ef4444);
        }
      `}</style>
    </Card>
  );
}

export default LocalToolCard;
