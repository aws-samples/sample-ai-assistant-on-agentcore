import React, { useMemo, useEffect, useRef } from "react";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  RadarChart,
  Radar,
  RadialBarChart,
  RadialBar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  XAxis,
  YAxis,
  CartesianGrid,
  Cell,
  Legend,
} from "recharts";
import { ChartContainer, ChartTooltip } from "@/components/ui/chart";
import { ChartErrorPlaceholder, ChartEmptyPlaceholder } from "./ChartErrorBoundary";
import { useTheme } from "@/components/ThemeContext";

/**
 * Custom tooltip content with color indicators
 * @param {boolean} hideLabel - Whether to hide the label/title section (for pie/radial charts)
 */
const CustomTooltipContent = ({ active, payload, label, chartConfig, hideLabel = false }) => {
  if (!active || !payload || !payload.length) return null;

  return (
    <div className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      {!hideLabel && label && <div className="mb-1 font-medium">{label}</div>}
      <div className="grid gap-1.5">
        {payload.map((entry, index) => {
          // For pie/radial charts, use entry.name (the slice name). For others, use dataKey
          const isPieOrRadial = entry.dataKey === "value" && entry.name;
          const lookupKey = isPieOrRadial ? entry.name : entry.dataKey || entry.name;
          const configItem = chartConfig?.[lookupKey];
          // For pie/radial charts, color is in entry.payload.fill
          const color =
            configItem?.color ||
            entry.payload?.fill ||
            entry.color ||
            entry.stroke ||
            entry.fill ||
            "#888";
          const displayLabel = configItem?.label || lookupKey;

          return (
            <div key={index} className="flex items-center gap-2">
              <div
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: color }}
              />
              <span className="text-muted-foreground">{displayLabel}</span>
              <span className="ml-auto font-mono font-medium tabular-nums text-foreground">
                {typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/**
 * Custom legend content with proper colors for radial/pie charts
 */
const CustomLegendContent = ({ payload, chartConfig }) => {
  if (!payload || !payload.length) return null;

  return (
    <div className="flex flex-wrap justify-center gap-4 pt-2">
      {payload.map((entry, index) => {
        // Handle both Legend payload format and manual format
        const key = entry.value || entry.dataKey;
        const configItem = chartConfig?.[key];
        // Try multiple sources for color
        const color = entry.color || configItem?.color || entry.payload?.fill || "#888";
        const displayLabel = configItem?.label || key;

        return (
          <div key={index} className="flex items-center gap-1.5">
            <div
              className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
              style={{ backgroundColor: color }}
            />
            <span className="text-xs text-muted-foreground">{displayLabel}</span>
          </div>
        );
      })}
    </div>
  );
};

/**
 * Default chart colors using shadcn CSS variables.
 */
const DEFAULT_CHART_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export const getDefaultChartColor = (index) => {
  return DEFAULT_CHART_COLORS[index % DEFAULT_CHART_COLORS.length];
};

/**
 * Sanitize a key for use in CSS variable names.
 * Replaces spaces and special characters with hyphens.
 */
const sanitizeCssKey = (key) => {
  return key
    .replace(/[^a-zA-Z0-9]/g, "-")
    .replace(/-+/g, "-")
    .toLowerCase();
};

/**
 * Transform tool payload to shadcn chartConfig format.
 * Uses sanitized keys for CSS variable compatibility.
 */
const toShadcnConfig = (payload) => {
  if (!payload?.data?.length) return {};

  const seriesKeys = Object.keys(payload.data[0]?.values || {});
  const chartConfig = {};

  seriesKeys.forEach((key, index) => {
    const customConfig = payload.series_config?.[key] || {};
    const customColor = customConfig.color;
    const color = customColor || getDefaultChartColor(index);
    const sanitizedKey = sanitizeCssKey(key);

    // Use sanitized key for CSS variable, but keep original label
    chartConfig[sanitizedKey] = {
      label: customConfig.label || key,
      color: color,
      originalKey: key, // Keep reference to original key
    };
  });

  return chartConfig;
};

/**
 * Transform data points to Recharts format.
 * Sanitizes keys for CSS variable compatibility.
 */
const transformData = (data) => {
  if (!data?.length) return [];
  return data.map((point) => {
    const transformed = { label: point.label };
    // Sanitize keys in values for CSS variable compatibility
    Object.entries(point.values || {}).forEach(([key, value]) => {
      transformed[sanitizeCssKey(key)] = value;
    });
    return transformed;
  });
};

/**
 * Get series keys from data (sanitized for CSS variables)
 */
const getSeriesKeys = (data) => {
  if (!data?.length) return [];
  return Object.keys(data[0]?.values || {}).map(sanitizeCssKey);
};

export const SUPPORTED_CHART_TYPES = ["line", "bar", "area", "pie", "radar", "radial"];

export const validateChartConfig = (config) => {
  if (!config) {
    return {
      isValid: false,
      error: "No chart configuration provided",
      errorType: "missing_config",
    };
  }
  if (!config.chart_type) {
    return { isValid: false, error: "Chart type is required", errorType: "missing_chart_type" };
  }
  if (!SUPPORTED_CHART_TYPES.includes(config.chart_type)) {
    return {
      isValid: false,
      error: `Unsupported chart type: "${config.chart_type}"`,
      errorType: "invalid_chart_type",
    };
  }
  if (!config.data || !Array.isArray(config.data)) {
    return { isValid: false, error: "Chart data must be an array", errorType: "invalid_data_type" };
  }
  if (config.data.length === 0) {
    return { isValid: false, error: null, errorType: "empty_data" };
  }
  const firstPoint = config.data[0];
  if (!firstPoint.label && !firstPoint.values) {
    return { isValid: false, error: "Invalid data structure", errorType: "invalid_data_structure" };
  }
  return { isValid: true, error: null, errorType: null };
};

/**
 * ChartRenderer - Main component for rendering charts from agent tool payloads
 * @param {boolean} isExpanded - Whether the chart is in expanded/modal view (shows legend when true)
 */
const ChartRendererInner = React.forwardRef(
  (
    {
      config,
      onSuccess,
      onError,
      className,
      isExpanded = false,
      isAnimationActive = true,
      compactAxis = false,
      showLegend: showLegendProp,
    },
    ref
  ) => {
    const hasCalledCallback = useRef(false);
    const internalRef = useRef(null);
    const chartRef = ref || internalRef;
    const { effectiveTheme } = useTheme();

    const validation = useMemo(() => validateChartConfig(config), [config]);
    const transformedData = useMemo(() => transformData(config?.data), [config?.data]);
    const seriesKeys = useMemo(() => getSeriesKeys(config?.data), [config?.data]);
    const chartConfig = useMemo(() => toShadcnConfig(config), [config]);

    // Show legend when expanded (modal view) or when explicitly requested (e.g. PDF export)
    const shouldShowLegend = showLegendProp ?? isExpanded;

    // Reset callback ref when config changes so callbacks fire for new data
    useEffect(() => {
      hasCalledCallback.current = false;
    }, [config]);

    useEffect(() => {
      if (hasCalledCallback.current) return;

      if (!validation.isValid && validation.errorType !== "empty_data") {
        hasCalledCallback.current = true;
        onError?.(validation.error);
        return;
      }

      if (validation.errorType === "empty_data") {
        hasCalledCallback.current = true;
        onError?.("No data available to display");
        return;
      }

      if (SUPPORTED_CHART_TYPES.includes(config?.chart_type) && transformedData.length > 0) {
        requestAnimationFrame(() => {
          hasCalledCallback.current = true;
          onSuccess?.({
            chart_type: config.chart_type,
            title: config.title,
            data_points: config.data.length,
          });
        });
      }
    }, [validation, transformedData, config, onSuccess, onError]);

    if (!validation.isValid && validation.errorType !== "empty_data") {
      return <ChartErrorPlaceholder error={validation.error} />;
    }

    if (validation.errorType === "empty_data" || !transformedData.length) {
      return <ChartEmptyPlaceholder />;
    }

    // Render chart content based on type - must be inline for ChartContainer to work
    const renderChartContent = () => {
      switch (config.chart_type) {
        case "bar": {
          const isStacked = config.stacked || config.variant === "stacked";
          const showGrid = config.show_grid !== false;
          const xAxisProps = compactAxis
            ? { angle: -35, textAnchor: "end", height: 45, tick: { fontSize: 9 }, tickMargin: 2 }
            : {};
          const yAxisTick = compactAxis ? { fontSize: 9 } : {};
          return (
            <BarChart data={transformedData} accessibilityLayer>
              {showGrid && <CartesianGrid vertical={false} />}
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                {...xAxisProps}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} tick={yAxisTick} />
              <ChartTooltip
                cursor={false}
                content={<CustomTooltipContent chartConfig={chartConfig} />}
              />
              {shouldShowLegend && <Legend />}
              {seriesKeys.map((key) => (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={`var(--color-${key})`}
                  radius={4}
                  stackId={isStacked ? "stack" : undefined}
                  isAnimationActive={isAnimationActive}
                />
              ))}
            </BarChart>
          );
        }
        case "line": {
          const showGrid = config.show_grid !== false;
          const xAxisProps = compactAxis
            ? { angle: -35, textAnchor: "end", height: 45, tick: { fontSize: 9 }, tickMargin: 2 }
            : {};
          const yAxisTick = compactAxis ? { fontSize: 9 } : {};
          return (
            <LineChart data={transformedData} accessibilityLayer>
              {showGrid && <CartesianGrid vertical={false} />}
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                {...xAxisProps}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} tick={yAxisTick} />
              <ChartTooltip content={<CustomTooltipContent chartConfig={chartConfig} />} />
              {shouldShowLegend && <Legend />}
              {seriesKeys.map((key) => (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={`var(--color-${key})`}
                  strokeWidth={2}
                  dot={{ fill: `var(--color-${key})` }}
                  activeDot={{ r: 6 }}
                  isAnimationActive={isAnimationActive}
                />
              ))}
            </LineChart>
          );
        }
        case "area": {
          const isStacked = config.stacked !== false; // Area charts are stacked by default
          const showGrid = config.show_grid !== false;
          const xAxisProps = compactAxis
            ? { angle: -35, textAnchor: "end", height: 45, tick: { fontSize: 9 }, tickMargin: 2 }
            : {};
          const yAxisTick = compactAxis ? { fontSize: 9 } : {};
          return (
            <AreaChart data={transformedData} accessibilityLayer>
              {showGrid && <CartesianGrid vertical={false} />}
              <XAxis
                dataKey="label"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                {...xAxisProps}
              />
              <YAxis tickLine={false} axisLine={false} tickMargin={8} tick={yAxisTick} />
              <ChartTooltip content={<CustomTooltipContent chartConfig={chartConfig} />} />
              {shouldShowLegend && <Legend />}
              {seriesKeys.map((key) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={`var(--color-${key})`}
                  fill={`var(--color-${key})`}
                  fillOpacity={0.3}
                  stackId={isStacked ? "stack" : undefined}
                  isAnimationActive={isAnimationActive}
                />
              ))}
            </AreaChart>
          );
        }
        case "pie": {
          const pieData = transformedData.map((point, index) => ({
            name: point.label,
            value: point[seriesKeys[0]] || 0,
            fill: getDefaultChartColor(index),
          }));
          // Build a config for pie slices
          const pieConfig = {};
          pieData.forEach((item) => {
            pieConfig[item.name] = { label: item.name, color: item.fill };
          });
          const isDonut = config.variant === "donut" || config.inner_radius > 0;
          // Use percentage-based radius to fit container
          const innerRadius = config.inner_radius || (isDonut ? "30%" : 0);
          const outerRadius = "70%";
          const pieLabelStyle = compactAxis ? { fontSize: 9 } : {};
          return (
            <PieChart>
              <ChartTooltip
                cursor={false}
                content={<CustomTooltipContent chartConfig={pieConfig} hideLabel />}
              />
              <Pie
                data={pieData}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                labelLine={compactAxis ? { strokeWidth: 0.5 } : undefined}
                style={pieLabelStyle}
                isAnimationActive={isAnimationActive}
              >
                {pieData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              {shouldShowLegend && (
                <Legend content={<CustomLegendContent chartConfig={pieConfig} />} />
              )}
            </PieChart>
          );
        }
        case "radar": {
          const showGrid = config.show_grid !== false;
          const radarAngleTick = compactAxis ? { fontSize: 9 } : {};
          const radarRadiusTick = compactAxis ? { fontSize: 8 } : {};
          return (
            <RadarChart data={transformedData} cx="50%" cy="50%" outerRadius="80%">
              {showGrid && <PolarGrid />}
              <PolarAngleAxis dataKey="label" tick={radarAngleTick} />
              <PolarRadiusAxis tick={radarRadiusTick} />
              <ChartTooltip content={<CustomTooltipContent chartConfig={chartConfig} />} />
              {shouldShowLegend && <Legend />}
              {seriesKeys.map((key) => (
                <Radar
                  key={key}
                  dataKey={key}
                  stroke={`var(--color-${key})`}
                  fill={`var(--color-${key})`}
                  fillOpacity={0.3}
                  isAnimationActive={isAnimationActive}
                />
              ))}
            </RadarChart>
          );
        }
        case "radial": {
          const isStacked = config.stacked || config.variant === "stacked";
          const showGrid = config.variant === "grid" || config.show_grid === true;
          // Default angles: half circle (180 to 0), full circle would be (0 to 360) or (-90 to 270)
          const startAngle = config.start_angle ?? 180;
          const endAngle = config.end_angle ?? 0;
          // Detect if it's a half-circle (180 degree arc)
          const isHalfCircle = Math.abs(startAngle - endAngle) <= 180;
          // Use percentage-based radius to fit container
          // For half-circle, use thinner bars (higher inner radius)
          const innerRadius = config.inner_radius ?? (isHalfCircle ? "55%" : "40%");
          const outerRadius = isHalfCircle ? "90%" : "80%";

          if (isStacked && seriesKeys.length > 1) {
            // Stacked radial - multiple series in one data point
            // Build legend items manually for stacked radial
            const stackedLegendItems = seriesKeys.map((key) => ({
              value: key,
              color: chartConfig[key]?.color || getDefaultChartColor(seriesKeys.indexOf(key)),
            }));
            return (
              <RadialBarChart
                cx="50%"
                cy="50%"
                innerRadius={innerRadius}
                outerRadius={outerRadius}
                data={transformedData}
                startAngle={startAngle}
                endAngle={endAngle}
              >
                {showGrid && <PolarGrid gridType="circle" />}
                <ChartTooltip
                  cursor={false}
                  content={<CustomTooltipContent chartConfig={chartConfig} hideLabel />}
                />
                {seriesKeys.map((key) => (
                  <RadialBar
                    key={key}
                    dataKey={key}
                    stackId="stack"
                    fill={`var(--color-${key})`}
                    cornerRadius={5}
                    className="stroke-transparent stroke-2"
                    isAnimationActive={isAnimationActive}
                  />
                ))}
                {shouldShowLegend && (
                  <Legend
                    content={() => (
                      <CustomLegendContent payload={stackedLegendItems} chartConfig={chartConfig} />
                    )}
                  />
                )}
              </RadialBarChart>
            );
          }

          // Non-stacked radial - each data point becomes a bar
          const radialData = transformedData.map((point, index) => ({
            name: point.label,
            value: point[seriesKeys[0]] || 0,
            fill: getDefaultChartColor(index),
          }));
          // Build a config for radial bars
          const radialConfig = {};
          radialData.forEach((item) => {
            radialConfig[item.name] = { label: item.name, color: item.fill };
          });
          return (
            <RadialBarChart
              cx="50%"
              cy="50%"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              data={radialData}
              startAngle={startAngle}
              endAngle={endAngle}
            >
              {showGrid && <PolarGrid gridType="circle" />}
              <RadialBar
                background
                dataKey="value"
                cornerRadius={5}
                isAnimationActive={isAnimationActive}
              />
              <ChartTooltip
                cursor={false}
                content={<CustomTooltipContent chartConfig={radialConfig} hideLabel />}
              />
              {shouldShowLegend && (
                <Legend content={<CustomLegendContent chartConfig={radialConfig} />} />
              )}
            </RadialBarChart>
          );
        }
        default:
          return null;
      }
    };

    return (
      <div className="w-full" ref={chartRef} data-theme={effectiveTheme}>
        {config.title && (
          <h3 className="text-lg font-semibold mb-4 text-foreground">{config.title}</h3>
        )}
        <ChartContainer config={chartConfig} className={className || "h-[200px] w-full"}>
          {renderChartContent()}
        </ChartContainer>
      </div>
    );
  }
);

ChartRendererInner.displayName = "ChartRendererInner";

const ChartRenderer = React.forwardRef((props, ref) => {
  try {
    return <ChartRendererInner {...props} ref={ref} />;
  } catch (error) {
    console.error("[ChartRenderer] Error during render:", error);
    return <ChartErrorPlaceholder error={error.message} />;
  }
});

ChartRenderer.displayName = "ChartRenderer";

export default ChartRenderer;
