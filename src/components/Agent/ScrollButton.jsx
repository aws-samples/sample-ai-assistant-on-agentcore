import React from "react";
import "./ScrollButton.css";
import { useTheme } from "../ThemeContext";

/**
 * ScrollButton Component
 *
 * A reusable button component for scroll actions.
 * Features:
 * - Theme-aware styling (light/dark)
 * - Accessible with aria-label
 * - Supports both up and down directions
 */
export const ScrollButton = React.memo(({ onClick, direction = "bottom" }) => {
  const { effectiveTheme } = useTheme();
  return (
    <button
      className={`scroll-button ${effectiveTheme}`}
      onClick={onClick}
      aria-label={`Scroll to ${direction}`}
    >
      {direction === "top" ? "↑" : "↓"}
    </button>
  );
});
