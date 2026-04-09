import * as React from "react";
import * as AvatarPrimitive from "@radix-ui/react-avatar";
import { cva } from "class-variance-authority";
import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

const SparkleIcon = ({ className }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="none"
    className={className}
  >
    <defs>
      <radialGradient
        id="avatarSparkleGradient"
        cx="30%"
        cy="30%"
        r="70%"
        gradientUnits="objectBoundingBox"
      >
        <stop offset="0" stopColor="#B8E7FF" stopOpacity="1" />
        <stop offset="0.15" stopColor="#0099FF" stopOpacity="1" />
        <stop offset="0.3" stopColor="#5C7FFF" stopOpacity="1" />
        <stop offset="0.45" stopColor="#8575FF" stopOpacity="1" />
        <stop offset="0.6" stopColor="#962EFF" stopOpacity="1" />
        <stop offset="1" stopColor="#962EFF" stopOpacity="1" />
      </radialGradient>
    </defs>
    <path
      d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .963L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"
      fill="url(#avatarSparkleGradient)"
    />
  </svg>
);

const avatarVariants = cva(
  "relative flex shrink-0 overflow-hidden rounded-full !border-none !border-0",
  {
    variants: {
      size: {
        default: "h-10 w-10",
        sm: "h-8 w-8",
        lg: "h-12 w-12",
      },
      color: {
        default: "",
        "gen-ai": "bg-transparent",
        user: "bg-zinc-600 dark:bg-zinc-600",
      },
    },
    defaultVariants: {
      size: "default",
      color: "default",
    },
  }
);

const Avatar = React.forwardRef(
  (
    {
      className,
      size,
      color,
      iconName,
      initials,
      loading,
      ariaLabel,
      tooltipText,
      tooltipSide = "left",
      children,
      ...props
    },
    ref
  ) => {
    const isGenAi = color === "gen-ai" || iconName === "gen-ai";
    const isUser = initials && !isGenAi;

    const avatarContent = (
      <AvatarPrimitive.Root
        ref={ref}
        className={cn(
          avatarVariants({ size, color: isGenAi ? "gen-ai" : isUser ? "user" : color }),
          className
        )}
        aria-label={ariaLabel}
        {...props}
      >
        {children ? (
          children
        ) : isGenAi ? (
          <AvatarFallback className="bg-transparent">
            {loading ? (
              <Loader2
                className={cn(
                  size === "sm" ? "h-6 w-6" : "h-7 w-7",
                  "animate-spin text-purple-500"
                )}
              />
            ) : (
              <SparkleIcon className={size === "sm" ? "h-7 w-7" : "h-8 w-8"} />
            )}
          </AvatarFallback>
        ) : initials ? (
          <AvatarFallback
            className={cn(
              size === "sm" ? "text-xs" : "",
              "text-white dark:text-zinc-100 bg-transparent"
            )}
          >
            {initials}
          </AvatarFallback>
        ) : null}
      </AvatarPrimitive.Root>
    );

    if (tooltipText) {
      return (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>{avatarContent}</TooltipTrigger>
            <TooltipContent side={tooltipSide} className="text-xs">
              {tooltipText}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }

    return avatarContent;
  }
);
Avatar.displayName = AvatarPrimitive.Root.displayName;

const AvatarImage = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Image
    ref={ref}
    className={cn("aspect-square h-full w-full", className)}
    {...props}
  />
));
AvatarImage.displayName = AvatarPrimitive.Image.displayName;

const AvatarFallback = React.forwardRef(({ className, ...props }, ref) => (
  <AvatarPrimitive.Fallback
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center rounded-full bg-muted !border-none !border-0",
      className
    )}
    {...props}
  />
));
AvatarFallback.displayName = AvatarPrimitive.Fallback.displayName;

export { Avatar, AvatarImage, AvatarFallback };
