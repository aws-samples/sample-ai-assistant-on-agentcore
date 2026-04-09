/**
 * Chart Export Service
 *
 * Utility functions for exporting charts as SVG or PNG files.
 */

/**
 * Generate a sanitized filename from chart title
 * @param {string} title - Chart title
 * @param {string} extension - File extension (svg or png)
 * @returns {string} Sanitized filename
 */
export const generateFilename = (title, extension) => {
  const sanitized = (title || "chart")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  const timestamp = new Date().toISOString().slice(0, 10);
  return `${sanitized}-${timestamp}.${extension}`;
};

/**
 * Trigger browser download of a blob
 * @param {Blob} blob - File content as blob
 * @param {string} filename - Name for the downloaded file
 */
export const triggerDownload = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

/**
 * Extract SVG element from chart container ref
 * @param {React.RefObject} chartRef - Ref to chart container element
 * @returns {SVGElement|null} SVG element or null if not found
 */
const extractSvgElement = (chartRef) => {
  if (!chartRef?.current) return null;
  return chartRef.current.querySelector("svg");
};

/**
 * Clone and prepare SVG for export
 * Inlines computed styles to preserve appearance
 * @param {SVGElement} svgElement - Original SVG element
 * @returns {SVGElement} Cloned SVG with inlined styles
 */
const prepareSvgForExport = (svgElement) => {
  const clonedSvg = svgElement.cloneNode(true);

  // Set explicit dimensions if not present
  const rect = svgElement.getBoundingClientRect();
  if (!clonedSvg.getAttribute("width")) {
    clonedSvg.setAttribute("width", rect.width);
  }
  if (!clonedSvg.getAttribute("height")) {
    clonedSvg.setAttribute("height", rect.height);
  }

  // Add xmlns attribute for standalone SVG
  clonedSvg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clonedSvg.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");

  // Inline computed styles for text elements — match each cloned element to
  // its original counterpart so styles are read from the correct source.
  const originalTextElements = Array.from(svgElement.querySelectorAll("text, tspan"));
  const clonedTextElements = Array.from(clonedSvg.querySelectorAll("text, tspan"));
  clonedTextElements.forEach((el, index) => {
    const original = originalTextElements[index] || el;
    const computed = window.getComputedStyle(original);
    el.style.fontFamily = computed.fontFamily || "sans-serif";
    el.style.fontSize = computed.fontSize || "12px";
    el.style.fill = computed.fill || "currentColor";
  });

  // Resolve CSS variables to actual colors
  const elementsWithFill = clonedSvg.querySelectorAll("[fill], [stroke]");
  elementsWithFill.forEach((el) => {
    const fill = el.getAttribute("fill");
    const stroke = el.getAttribute("stroke");

    if (fill && fill.includes("var(")) {
      const resolvedFill = getComputedStyle(svgElement)
        .getPropertyValue(fill.match(/var\((--[^)]+)\)/)?.[1] || "")
        .trim();
      if (resolvedFill) el.setAttribute("fill", resolvedFill);
    }

    if (stroke && stroke.includes("var(")) {
      const resolvedStroke = getComputedStyle(svgElement)
        .getPropertyValue(stroke.match(/var\((--[^)]+)\)/)?.[1] || "")
        .trim();
      if (resolvedStroke) el.setAttribute("stroke", resolvedStroke);
    }
  });

  return clonedSvg;
};

/**
 * Extract legend items from chart config data.
 * Returns array of { label, color } for each series.
 * @param {Object} chartConfig - The chart config object with data and series_config
 * @returns {Array<{label: string, color: string}>}
 */
const extractLegendItems = (chartConfig) => {
  if (!chartConfig?.data?.length) return [];

  const DEFAULT_COLORS = [
    "hsl(220, 70%, 50%)",
    "hsl(160, 60%, 45%)",
    "hsl(30, 80%, 55%)",
    "hsl(280, 65%, 60%)",
    "hsl(340, 75%, 55%)",
  ];

  const seriesKeys = Object.keys(chartConfig.data[0]?.values || {});
  return seriesKeys.map((key, index) => {
    const custom = chartConfig.series_config?.[key] || {};
    return {
      label: custom.label || key,
      color: custom.color || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
    };
  });
};

/**
 * Resolve a color string that may contain CSS variables or HSL references
 * to an actual usable color for export.
 * @param {string} color - Color string (may contain hsl(var(...)))
 * @param {SVGElement} svgElement - Reference element for resolving CSS vars
 * @returns {string} Resolved color string
 */
const resolveColor = (color, svgElement) => {
  if (!color) return "#888";

  // Handle hsl(var(--chart-N)) pattern
  const varMatch = color.match(/var\((--[^)]+)\)/);
  if (varMatch && svgElement) {
    const resolved = getComputedStyle(svgElement).getPropertyValue(varMatch[1]).trim();
    if (resolved) {
      // If original was hsl(var(...)), wrap resolved value in hsl()
      if (color.startsWith("hsl(")) return `hsl(${resolved})`;
      return resolved;
    }
  }
  return color;
};

/**
 * Build a composite SVG that wraps the chart SVG with title and legend.
 * @param {SVGElement} chartSvg - The prepared chart SVG element
 * @param {Object} options
 * @param {string} [options.title] - Chart title text
 * @param {Array<{label: string, color: string}>} [options.legendItems] - Legend entries
 * @param {string} [options.textColor] - Color for title/legend text
 * @param {SVGElement} [options.originalSvg] - Original SVG for resolving CSS vars
 * @returns {SVGElement} Composite SVG element
 */
const buildCompositeSvg = (
  chartSvg,
  { title, legendItems, textColor = "#000", originalSvg } = {}
) => {
  const chartWidth = parseFloat(chartSvg.getAttribute("width")) || 500;
  const chartHeight = parseFloat(chartSvg.getAttribute("height")) || 200;

  const PADDING = 16;
  const TITLE_HEIGHT = title ? 32 : 0;
  const LEGEND_HEIGHT = legendItems?.length ? 30 : 0;
  const totalHeight = PADDING + TITLE_HEIGHT + chartHeight + LEGEND_HEIGHT + PADDING;
  const totalWidth = chartWidth + PADDING * 2;

  const ns = "http://www.w3.org/2000/svg";
  const wrapper = document.createElementNS(ns, "svg");
  wrapper.setAttribute("xmlns", ns);
  wrapper.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
  wrapper.setAttribute("width", totalWidth);
  wrapper.setAttribute("height", totalHeight);
  wrapper.setAttribute("viewBox", `0 0 ${totalWidth} ${totalHeight}`);

  let yOffset = PADDING;

  // Add title
  if (title) {
    const titleEl = document.createElementNS(ns, "text");
    titleEl.setAttribute("x", PADDING);
    titleEl.setAttribute("y", yOffset + 20);
    titleEl.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
    titleEl.setAttribute("font-size", "16");
    titleEl.setAttribute("font-weight", "600");
    titleEl.setAttribute("fill", textColor);
    titleEl.textContent = title;
    wrapper.appendChild(titleEl);
    yOffset += TITLE_HEIGHT;
  }

  // Embed chart SVG as a nested group (clone to avoid mutating the input)
  const chartGroup = document.createElementNS(ns, "g");
  chartGroup.setAttribute("transform", `translate(${PADDING}, ${yOffset})`);
  // Copy children from chartSvg into the group without mutating the original
  Array.from(chartSvg.childNodes).forEach((child) => {
    chartGroup.appendChild(child.cloneNode(true));
  });
  wrapper.appendChild(chartGroup);
  yOffset += chartHeight;

  // Add legend
  if (legendItems?.length) {
    const legendGroup = document.createElementNS(ns, "g");
    legendGroup.setAttribute("transform", `translate(${PADDING}, ${yOffset + 8})`);

    let xPos = 0;
    legendItems.forEach((item) => {
      const color = resolveColor(item.color, originalSvg);

      const rect = document.createElementNS(ns, "rect");
      rect.setAttribute("x", xPos);
      rect.setAttribute("y", 2);
      rect.setAttribute("width", 10);
      rect.setAttribute("height", 10);
      rect.setAttribute("rx", 2);
      rect.setAttribute("fill", color);
      legendGroup.appendChild(rect);

      const text = document.createElementNS(ns, "text");
      text.setAttribute("x", xPos + 14);
      text.setAttribute("y", 11);
      text.setAttribute("font-family", "system-ui, -apple-system, sans-serif");
      text.setAttribute("font-size", "12");
      text.setAttribute("fill", textColor);
      text.textContent = item.label;
      legendGroup.appendChild(text);

      // Estimate text width (rough: 7px per char)
      xPos += 14 + item.label.length * 7 + 16;
    });

    wrapper.appendChild(legendGroup);
  }

  return wrapper;
};

/**
 * Export chart as SVG file
 * Extracts SVG from chart ref, wraps with title/legend, and triggers download
 *
 * @param {React.RefObject} chartRef - Ref to chart container element
 * @param {string} [title] - Chart title for filename generation
 * @param {Object} [options] - Export options
 * @param {Object} [options.chartConfig] - Full chart config for title/legend extraction
 * @param {string} [options.textColor] - Text color for title/legend
 * @returns {Promise<{success: boolean, error?: string}>} Export result
 */
export const exportToSVG = async (chartRef, title, options = {}) => {
  const { chartConfig, textColor = "#000" } = options;

  try {
    const svgElement = extractSvgElement(chartRef);
    if (!svgElement) {
      return { success: false, error: "No SVG element found in chart" };
    }

    const preparedSvg = prepareSvgForExport(svgElement);
    const legendItems = chartConfig ? extractLegendItems(chartConfig) : [];
    const chartTitle = chartConfig?.title || title;

    const compositeSvg = buildCompositeSvg(preparedSvg, {
      title: chartTitle,
      legendItems,
      textColor,
      originalSvg: svgElement,
    });

    const svgString = new XMLSerializer().serializeToString(compositeSvg);

    // Validate SVG can be parsed
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, "image/svg+xml");
    const parseError = doc.querySelector("parsererror");
    if (parseError) {
      return { success: false, error: "Generated SVG is invalid" };
    }

    const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const filename = generateFilename(title || chartTitle, "svg");
    triggerDownload(blob, filename);

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || "Failed to export SVG" };
  }
};

/**
 * Export chart as PNG image
 * Converts SVG (with title/legend) to canvas then to PNG
 *
 * @param {React.RefObject} chartRef - Ref to chart container element
 * @param {Object} [options] - Export options
 * @param {string} [options.title] - Chart title for filename generation
 * @param {number} [options.scale=2] - Scale factor for higher resolution
 * @param {string} [options.backgroundColor='#ffffff'] - Background color
 * @param {Object} [options.chartConfig] - Full chart config for title/legend extraction
 * @param {string} [options.textColor] - Text color for title/legend
 * @returns {Promise<{success: boolean, error?: string}>} Export result
 */
export const exportToPNG = async (chartRef, options = {}) => {
  const {
    title,
    scale = 2,
    backgroundColor = "#ffffff",
    chartConfig,
    textColor = "#000",
  } = options;

  try {
    const svgElement = extractSvgElement(chartRef);
    if (!svgElement) {
      return { success: false, error: "No SVG element found in chart" };
    }

    const preparedSvg = prepareSvgForExport(svgElement);
    const legendItems = chartConfig ? extractLegendItems(chartConfig) : [];
    const chartTitle = chartConfig?.title || title;

    const compositeSvg = buildCompositeSvg(preparedSvg, {
      title: chartTitle,
      legendItems,
      textColor,
      originalSvg: svgElement,
    });

    const svgString = new XMLSerializer().serializeToString(compositeSvg);

    // Get dimensions from composite SVG
    const width = parseFloat(compositeSvg.getAttribute("width")) * scale;
    const height = parseFloat(compositeSvg.getAttribute("height")) * scale;

    // Create canvas
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");

    // Fill background
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width, height);

    // Create image from SVG
    const img = new Image();
    const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    return new Promise((resolve) => {
      img.onload = () => {
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);

        canvas.toBlob((blob) => {
          if (!blob) {
            resolve({ success: false, error: "Failed to create PNG blob" });
            return;
          }

          const filename = generateFilename(title || chartTitle, "png");
          triggerDownload(blob, filename);
          resolve({ success: true });
        }, "image/png");
      };

      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve({ success: false, error: "Failed to load SVG for PNG conversion" });
      };

      img.src = url;
    });
  } catch (error) {
    return { success: false, error: error.message || "Failed to export PNG" };
  }
};
