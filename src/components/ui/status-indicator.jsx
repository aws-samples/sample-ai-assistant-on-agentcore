import { cva } from "class-variance-authority";
import { Loader2, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const statusIndicatorVariants = cva("inline-flex items-center gap-1.5 text-sm", {
  variants: {
    type: {
      loading: "text-primary",
      success: "text-green-600 dark:text-green-500",
      error: "text-red-600 dark:text-red-500",
      warning: "text-yellow-600 dark:text-yellow-500",
      info: "text-blue-600 dark:text-blue-500",
    },
  },
  defaultVariants: {
    type: "info",
  },
});

const iconMap = {
  loading: Loader2,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

function StatusIndicator({ type = "info", children, className, ...props }) {
  const Icon = iconMap[type] || iconMap.info;
  const isLoading = type === "loading";

  return (
    <span
      className={cn(statusIndicatorVariants({ type }), className)}
      role="status"
      aria-live={isLoading ? "polite" : undefined}
      {...props}
    >
      <Icon className={cn("size-4 shrink-0", isLoading && "animate-spin")} aria-hidden="true" />
      {children && <span>{children}</span>}
    </span>
  );
}

export { StatusIndicator, statusIndicatorVariants };
