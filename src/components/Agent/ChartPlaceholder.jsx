import React from "react";
import { BarChart3 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useTheme } from "../ThemeContext";

// Fixed dimensions for chart container - matches ChartToolContent
const CHART_WIDTH = 500;
const CHART_HEIGHT = 250;

/**
 * Chart container wrapper - matches ChartToolContent styling
 */
const ChartContainer = ({ children, theme }) => (
  <div
    className={`chart-placeholder-container ${theme}`}
    style={{
      borderRadius: "10px",
      border: "1px solid var(--color-border)",
      padding: "12px 16px",
      backgroundColor: theme === "dark" ? "#161616" : "#F8F8F8",
      width: CHART_WIDTH,
      maxWidth: "100%",
      overflow: "hidden",
    }}
  >
    {children}
  </div>
);

/**
 * ChartPlaceholder - Skeleton loader displayed while chart tags are being streamed.
 * Shows a loading indicator with "Generating chart..." text.
 * Matches chart container dimensions from ChartToolContent.
 *
 */
const ChartPlaceholder = () => {
  const { effectiveTheme } = useTheme();

  return (
    <ChartContainer theme={effectiveTheme}>
      {/* Header with icon and generating text */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <BarChart3
            className="h-4 w-4 animate-pulse"
            style={{ color: effectiveTheme === "dark" ? "#a1a1aa" : "#71717a" }}
          />
          <span
            className="text-sm font-medium"
            style={{ color: effectiveTheme === "dark" ? "#a1a1aa" : "#71717a" }}
          >
            Generating chart...
          </span>
        </div>
        <Skeleton className="h-6 w-6 rounded" />
      </div>

      {/* Skeleton bars matching chart area */}
      <div className="flex items-end gap-1.5" style={{ height: CHART_HEIGHT - 50 }}>
        <div className="flex-1 flex items-end justify-around gap-3 h-full">
          <Skeleton className="w-10 h-[50%] rounded-t" />
          <Skeleton className="w-10 h-[70%] rounded-t" />
          <Skeleton className="w-10 h-[35%] rounded-t" />
          <Skeleton className="w-10 h-[85%] rounded-t" />
          <Skeleton className="w-10 h-[45%] rounded-t" />
          <Skeleton className="w-10 h-[60%] rounded-t" />
        </div>
      </div>
    </ChartContainer>
  );
};

export default ChartPlaceholder;
