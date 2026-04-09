import React from "react";
import { AlertCircle } from "lucide-react";

/**
 * ChartErrorPlaceholder - Displays error message for chart rendering failures
 * @param {Object} props
 * @param {string} props.error - Error message to display
 */
export const ChartErrorPlaceholder = ({ error }) => (
  <div className="flex flex-col items-center justify-center p-6">
    <AlertCircle className="h-6 w-6 mb-2 text-red-500" />
    <span className="text-sm font-medium text-red-500">Chart Rendering Error</span>
    <span className="text-xs mt-1 text-center max-w-md text-red-400">
      {error || "An unexpected error occurred while rendering the chart"}
    </span>
  </div>
);

/**
 * ChartEmptyPlaceholder - Displays placeholder for empty chart data
 */
export const ChartEmptyPlaceholder = () => (
  <div className="flex flex-col items-center justify-center p-8 text-muted-foreground bg-muted/50 rounded-lg border border-muted">
    <span className="text-sm font-medium">No Data Available</span>
    <span className="text-xs text-muted-foreground/80 mt-1">The chart has no data to display</span>
  </div>
);

/**
 * ChartErrorBoundary - Error boundary for catching rendering errors in chart components
 *
 * Catches JavaScript errors during rendering and displays a fallback UI.
 * Exposes the error message via onError callback for resume_interrupt.
 *
 * @example
 * <ChartErrorBoundary onError={(error) => handleError(error)}>
 *   <ChartRenderer config={config} />
 * </ChartErrorBoundary>
 */
class ChartErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // Log error for debugging
    console.error("ChartErrorBoundary caught an error:", error, errorInfo);

    // Call onError callback to expose error for resume_interrupt
    if (this.props.onError) {
      this.props.onError(error.message || "Unknown chart rendering error");
    }
  }

  render() {
    if (this.state.hasError) {
      return <ChartErrorPlaceholder error={this.state.error?.message} />;
    }
    return this.props.children;
  }
}

export default ChartErrorBoundary;
