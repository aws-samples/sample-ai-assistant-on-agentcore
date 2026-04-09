import React, { useState, useRef, useEffect } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useTheme } from "../ThemeContext";
import { sparkyModelConfig } from "../../config";

const MODEL_OPTIONS = sparkyModelConfig.models;
const DEFAULT_MODEL_ID = sparkyModelConfig.defaultModelId;

const MODEL_STORAGE_KEY = "selectedModelId";

/**
 * Get the short model ID for the currently selected model.
 * Returns the default model ID if no selection exists in localStorage.
 * The backend resolves short IDs to full provider model IDs.
 * @returns {string} The short model ID (e.g. "claude-opus-4.5")
 */
export const getSelectedModelId = () => {
  const saved = localStorage.getItem(MODEL_STORAGE_KEY);
  const model = MODEL_OPTIONS.find((m) => m.id === saved);
  return model?.id || DEFAULT_MODEL_ID || MODEL_OPTIONS[0]?.id;
};

const ModelSelector = () => {
  const { effectiveTheme } = useTheme();
  const isDark = effectiveTheme === "dark";

  const [isOpen, setIsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState(() => {
    const saved = localStorage.getItem(MODEL_STORAGE_KEY);
    return (
      MODEL_OPTIONS.find((m) => m.id === saved) ||
      MODEL_OPTIONS.find((m) => m.id === DEFAULT_MODEL_ID) ||
      MODEL_OPTIONS[0]
    );
  });
  const [hoveredId, setHoveredId] = useState(null);
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (model) => {
    setSelectedModel(model);
    localStorage.setItem(MODEL_STORAGE_KEY, model.id);
    setIsOpen(false);

    // Dispatch event to notify other components of model change
    window.dispatchEvent(new CustomEvent("modelChanged", { detail: { modelId: model.id } }));
  };

  const containerStyle = {
    position: "relative",
    display: "inline-block",
  };

  const buttonStyle = {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    borderRadius: "8px",
    border: "1px solid transparent",
    background: "transparent",
    color: isDark ? "#fafaf9" : "#18181b",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
  };

  const dropdownStyle = {
    position: "absolute",
    top: "calc(100% + 4px)",
    left: 0,
    zIndex: 1000,
    minWidth: "200px",
    background: isDark ? "hsl(0 0% 14.9%)" : "#ffffff",
    border: "none",
    borderRadius: "12px",
    boxShadow: isDark ? "0 4px 12px rgba(0, 0, 0, 0.4)" : "0 4px 12px rgba(0, 0, 0, 0.1)",
    padding: "4px",
  };

  const itemStyle = (isHovered) => ({
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "8px 12px",
    cursor: "pointer",
    background: isHovered ? (isDark ? "hsl(0 0% 25.1%)" : "hsl(0 0% 91.1%)") : "transparent",
    transition: "background 0.15s ease",
    borderRadius: "8px",
    margin: "2px 0",
  });

  const labelStyle = {
    fontSize: "13px",
    fontWeight: 500,
    color: isDark ? "#fafaf9" : "#18181b",
  };

  const selectLabelStyle = {
    fontSize: "11px",
    fontWeight: 500,
    color: isDark ? "#71717a" : "#a1a1aa",
    padding: "8px 12px 4px 12px",
    textTransform: "none",
    letterSpacing: "0.5px",
  };

  return (
    <div style={containerStyle} ref={dropdownRef}>
      <button
        style={buttonStyle}
        onClick={() => setIsOpen(!isOpen)}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = isDark ? "hsl(0 0% 25.1%)" : "hsl(0 0% 91.1%)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "transparent";
        }}
      >
        {selectedModel.label}
        <ChevronDown
          size={14}
          style={{
            transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.2s ease",
          }}
        />
      </button>

      {isOpen && (
        <div style={dropdownStyle}>
          <div style={selectLabelStyle}>Choose model</div>
          {MODEL_OPTIONS.map((model) => (
            <div
              key={model.id}
              style={itemStyle(hoveredId === model.id)}
              onClick={() => handleSelect(model)}
              onMouseEnter={() => setHoveredId(model.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div style={labelStyle}>{model.label}</div>
              {selectedModel.id === model.id && (
                <Check size={16} style={{ color: isDark ? "#a1a1aa" : "#71717a" }} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ModelSelector;
