import React, { useMemo, useRef, useState, useCallback } from "react";
import { Download, Image, FileCode } from "lucide-react";
import ChartRenderer, { validateChartConfig } from "./ChartRenderer";
import ChartErrorBoundary, { ChartErrorPlaceholder } from "./ChartErrorBoundary";
import { useTheme } from "@/components/ThemeContext";
import { exportToSVG, exportToPNG } from "@/services/chartExport";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

// Fixed dimensions for chart container - matches ChartToolContent
const CHART_WIDTH = 500;

/**
 * Chart container wrapper - matches ChartToolContent styling
 */
const ChartContainer = ({ children, theme, exportMenu }) => (
  <div
    className={`chart-tag-container ${theme}`}
    style={{
      borderRadius: "10px",
      border: "1px solid var(--color-border)",
      padding: "12px 16px",
      backgroundColor: "var(--color-card)",
      width: CHART_WIDTH,
      maxWidth: "100%",
      overflow: "hidden",
      margin: "8px 0",
      position: "relative",
    }}
  >
    {exportMenu && (
      <div style={{ position: "absolute", top: 8, right: 8, zIndex: 10 }}>{exportMenu}</div>
    )}
    {children}
  </div>
);

/**
 * Parse the data-config attribute from a chart tag.
 * Handles both plain JSON and URL-encoded JSON.
 *
 * @param {string} dataConfig - The data-config attribute value
 * @returns {{ config: object|null, error: string|null }}
 */
export const parseChartConfig = (dataConfig) => {
  if (!dataConfig) {
    return { config: null, error: "No chart configuration provided" };
  }

  let jsonString = dataConfig;

  // Try to decode if it looks URL-encoded (contains %XX patterns)
  if (/%[0-9A-Fa-f]{2}/.test(dataConfig)) {
    try {
      jsonString = decodeURIComponent(dataConfig);
    } catch (decodeError) {
      // If decoding fails, try parsing as-is
      console.warn("[ChartTagRenderer] URL decode failed, trying raw parse:", decodeError);
    }
  }

  // Parse JSON
  try {
    const config = JSON.parse(jsonString);
    return { config, error: null };
  } catch (parseError) {
    return {
      config: null,
      error: `Invalid chart JSON: ${parseError.message}`,
    };
  }
};

/**
 * ChartTagRenderer - Renders chart elements from markdown.
 * Parses data-config attribute and renders ChartRenderer or error state.
 *
 * This component is registered as a custom markdown component for <chart> tags,
 * following the same pattern as CitationRenderer for <cite> tags.
 *
 * Format: <chart data-config='{"chart_type":"bar","title":"Sales","data":[...]}'></chart>
 *
 *
 * @param {Object} props - Component props from rehype-raw
 * @param {Object} props.node - AST node
 * @param {string} props['data-config'] - URL-encoded or plain JSON chart configuration
 */
const ChartTagRenderer = ({ node, children, ...props }) => {
  const { effectiveTheme } = useTheme();
  const dataConfig = props["data-config"];
  const chartRef = useRef(null);
  const [exporting, setExporting] = useState(false);

  // Parse and validate the chart configuration
  const { config, parseError, validationError } = useMemo(() => {
    const { config: parsedConfig, error: parseErr } = parseChartConfig(dataConfig);

    if (parseErr) {
      return { config: null, parseError: parseErr, validationError: null };
    }

    // Validate the parsed config
    const validation = validateChartConfig(parsedConfig);
    if (!validation.isValid && validation.errorType !== "empty_data") {
      return { config: parsedConfig, parseError: null, validationError: validation.error };
    }

    return { config: parsedConfig, parseError: null, validationError: null };
  }, [dataConfig]);

  const handleExportSVG = useCallback(async () => {
    setExporting(true);
    try {
      const textColor = effectiveTheme === "dark" ? "#e5e5e5" : "#171717";
      await exportToSVG(chartRef, config?.title, { chartConfig: config, textColor });
    } finally {
      setExporting(false);
    }
  }, [config, effectiveTheme]);

  const handleExportPNG = useCallback(async () => {
    setExporting(true);
    try {
      const bgColor = effectiveTheme === "dark" ? "hsl(0 0% 11%)" : "hsl(0 0% 96.1%)";
      const textColor = effectiveTheme === "dark" ? "#e5e5e5" : "#171717";
      await exportToPNG(chartRef, {
        title: config?.title,
        backgroundColor: bgColor,
        chartConfig: config,
        textColor,
      });
    } finally {
      setExporting(false);
    }
  }, [config, effectiveTheme]);

  // Handle parsing errors (malformed JSON)
  if (parseError) {
    return (
      <ChartContainer theme={effectiveTheme}>
        <ChartErrorPlaceholder error={parseError} />
      </ChartContainer>
    );
  }

  // Handle validation errors (missing required fields, unsupported chart type)
  if (validationError) {
    return (
      <ChartContainer theme={effectiveTheme}>
        <ChartErrorPlaceholder error={validationError} />
      </ChartContainer>
    );
  }

  // Handle missing config (shouldn't happen if parseError is null, but defensive)
  if (!config) {
    return (
      <ChartContainer theme={effectiveTheme}>
        <ChartErrorPlaceholder error="No chart configuration provided" />
      </ChartContainer>
    );
  }

  const exportMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center justify-center rounded-md p-1.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          disabled={exporting}
          aria-label="Export chart"
        >
          <Download className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={handleExportPNG} disabled={exporting}>
          <Image className="h-4 w-4 mr-2" />
          Export as PNG
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleExportSVG} disabled={exporting}>
          <FileCode className="h-4 w-4 mr-2" />
          Export as SVG
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Render the chart
  return (
    <ChartContainer theme={effectiveTheme} exportMenu={exportMenu}>
      <ChartErrorBoundary
        onError={(error) => console.error("[ChartTagRenderer] Render error:", error)}
      >
        <ChartRenderer
          ref={chartRef}
          config={config}
          onSuccess={() => {}}
          onError={(error) => console.error("[ChartTagRenderer] Chart error:", error)}
          isExpanded={false}
        />
      </ChartErrorBoundary>
    </ChartContainer>
  );
};

export default ChartTagRenderer;
