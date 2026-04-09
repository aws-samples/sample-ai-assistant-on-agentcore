import React, { useState, useEffect, useRef } from "react";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "../ThemeContext";
import { sparkyModelConfig } from "../../config";

const MODEL_STORAGE_KEY = "selectedModelId";
const LEVEL_LABELS = ["Low", "Medium", "High", "Max"];

const ThinkingBudget = React.memo(({ initialBudget, onBudgetChange }) => {
  const { isDark } = useTheme();
  const [hoveredId, setHoveredId] = useState(null);
  const [localBudget, setLocalBudget] = useState(initialBudget);
  const [selectedModelId, setSelectedModelId] = useState(
    () => localStorage.getItem(MODEL_STORAGE_KEY) || ""
  );

  const selectedModelConfig = sparkyModelConfig.models.find((m) => m.id === selectedModelId);
  const maxLevels = selectedModelConfig?.reasoning_levels || 3;

  // Sync from parent when initialBudget prop changes
  useEffect(() => {
    setLocalBudget(initialBudget);
  }, [initialBudget]);

  // Listen for model changes
  useEffect(() => {
    const handleModelChange = () => {
      setSelectedModelId(localStorage.getItem(MODEL_STORAGE_KEY) || "");
    };
    window.addEventListener("modelChanged", handleModelChange);
    return () => window.removeEventListener("modelChanged", handleModelChange);
  }, []);

  // Clamp budget when model changes to one with fewer levels
  useEffect(() => {
    if (localBudget && parseInt(localBudget) > maxLevels) {
      setLocalBudget(String(maxLevels));
    }
  }, [selectedModelId, localBudget, maxLevels]);

  // Debounced callback to parent
  useEffect(() => {
    const id = setTimeout(() => {
      if (onBudgetChange) onBudgetChange(localBudget);
    }, 50);
    return () => clearTimeout(id);
  }, [localBudget, onBudgetChange]);

  const items = LEVEL_LABELS.slice(0, maxLevels).map((label, i) => ({
    id: String(i + 1),
    content: label,
  }));

  const handleToggleChange = (itemId, isChecked) => {
    setLocalBudget(isChecked ? itemId : null);
  };

  const getItemStyle = (itemId) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "24px",
    padding: "8px 12px",
    borderRadius: "8px",
    margin: "2px 0",
    transition: "background-color 0.15s ease",
    backgroundColor: hoveredId === itemId ? (isDark ? "#27272a" : "#f4f4f5") : "transparent",
  });

  const textStyle = {
    fontSize: "13px",
    fontWeight: 500,
    color: isDark ? "#fafaf9" : "#18181b",
    flex: 1,
  };

  return (
    <div style={{ padding: "4px", minWidth: "200px" }}>
      <div
        style={{
          fontSize: "11px",
          fontWeight: 500,
          color: isDark ? "#71717a" : "#a1a1aa",
          padding: "8px 12px 4px 12px",
        }}
      >
        Reasoning effort
      </div>
      <ul
        style={{ listStyle: "none", margin: 0, padding: 0 }}
        role="radiogroup"
        aria-label="Thinking budget level"
      >
        {items.map((item) => (
          <li
            key={item.id}
            style={getItemStyle(item.id)}
            onMouseEnter={() => setHoveredId(item.id)}
            onMouseLeave={() => setHoveredId(null)}
          >
            <span style={textStyle}>{item.content}</span>
            <Switch
              size="sm"
              onCheckedChange={(checked) => handleToggleChange(item.id, checked)}
              checked={localBudget === item.id}
              aria-label={`${item.content} thinking budget`}
            />
          </li>
        ))}
      </ul>
    </div>
  );
});

export default ThinkingBudget;
