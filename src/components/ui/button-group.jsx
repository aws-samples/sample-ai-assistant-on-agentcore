import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "./button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";
import { ThumbsUp, ThumbsDown, Copy, Check, GitBranch, Loader2, BarChart2 } from "lucide-react";
import { HoverCard, HoverCardTrigger, HoverCardContent } from "./hover-card";

// Icon mapping for common icons
const iconMap = {
  "thumbs-up": ThumbsUp,
  "thumbs-up-filled": ThumbsUp,
  "thumbs-down": ThumbsDown,
  "thumbs-down-filled": ThumbsDown,
  copy: Copy,
  check: Check,
  "git-branch": GitBranch,
  loader: Loader2,
  "bar-chart-2": BarChart2,
};

const ButtonGroupItem = React.forwardRef(({ item, onItemClick, className }, ref) => {
  const [showFeedback, setShowFeedback] = React.useState(false);
  const [popoverOpen, setPopoverOpen] = React.useState(false);
  const feedbackTimeoutRef = React.useRef(null);

  const handleClick = React.useCallback(() => {
    const newPressed = item.type === "icon-toggle-button" ? !item.pressed : undefined;

    onItemClick?.({
      detail: {
        id: item.id,
        pressed: newPressed,
      },
    });

    // Toggle persistent popover if provided
    if (item.popoverContent) {
      setPopoverOpen((v) => !v);
      return;
    }

    // Show popover feedback if provided
    if (item.popoverFeedback) {
      setShowFeedback(true);
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
      feedbackTimeoutRef.current = setTimeout(() => {
        setShowFeedback(false);
      }, 2000);
    }
  }, [item, onItemClick]);

  React.useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) {
        clearTimeout(feedbackTimeoutRef.current);
      }
    };
  }, []);

  // Get the appropriate icon
  const getIcon = () => {
    if (item.type === "icon-toggle-button" && item.pressed && item.pressedIconName) {
      const IconComponent = iconMap[item.pressedIconName];
      return IconComponent ? <IconComponent className="h-4 w-4 fill-current" /> : null;
    }
    const iconName = item.iconName || item.icon;
    const IconComponent = iconMap[iconName];
    if (!IconComponent) return null;
    const spinClass = iconName === "loader" ? "h-4 w-4 animate-spin" : "h-4 w-4";
    return <IconComponent className={spinClass} />;
  };

  const isToggleButton = item.type === "icon-toggle-button";
  const isPressed = isToggleButton && item.pressed;

  const buttonContent = (
    <Button
      ref={ref}
      variant="ghost"
      size="icon"
      className={cn(
        "h-8 w-8 rounded-md",
        isPressed && "bg-accent text-accent-foreground",
        className
      )}
      onClick={handleClick}
      disabled={item.disabled}
      aria-pressed={isToggleButton ? item.pressed : undefined}
      aria-label={item.text}
    >
      {getIcon()}
    </Button>
  );

  if (item.popoverContent) {
    return (
      <HoverCard open={popoverOpen} onOpenChange={setPopoverOpen}>
        <HoverCardTrigger asChild>{buttonContent}</HoverCardTrigger>
        <HoverCardContent align="start" className="pb-0">
          {item.popoverContent}
        </HoverCardContent>
      </HoverCard>
    );
  }

  if (item.text || item.popoverFeedback) {
    return (
      <Tooltip open={showFeedback ? true : undefined}>
        <TooltipTrigger asChild>{buttonContent}</TooltipTrigger>
        <TooltipContent
          side="bottom"
          className={cn(
            "text-xs",
            showFeedback &&
              item.popoverFeedback &&
              "bg-card text-card-foreground border border-border shadow-md"
          )}
        >
          {showFeedback && item.popoverFeedback ? item.popoverFeedback : item.text}
        </TooltipContent>
      </Tooltip>
    );
  }

  return buttonContent;
});
ButtonGroupItem.displayName = "ButtonGroupItem";

const ButtonGroup = React.forwardRef(
  ({ items, onItemClick, ariaLabel, variant = "default", className }, ref) => {
    // Flatten grouped items
    const flattenedItems = React.useMemo(() => {
      const result = [];
      items.forEach((item) => {
        if (item.type === "group" && item.items) {
          result.push(...item.items);
        } else {
          result.push(item);
        }
      });
      return result;
    }, [items]);

    return (
      <TooltipProvider delayDuration={300}>
        <div
          ref={ref}
          role="group"
          aria-label={ariaLabel}
          className={cn(
            "inline-flex items-center gap-1",
            variant === "icon" && "gap-0.5",
            className
          )}
        >
          {flattenedItems.map((item) => (
            <ButtonGroupItem key={item.id} item={item} onItemClick={onItemClick} />
          ))}
        </div>
      </TooltipProvider>
    );
  }
);
ButtonGroup.displayName = "ButtonGroup";

export { ButtonGroup, ButtonGroupItem };
export default ButtonGroup;
