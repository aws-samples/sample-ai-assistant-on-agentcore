import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./button";

const CopyButton = React.forwardRef(
  (
    {
      text,
      variant = "default",
      onCopy,
      className,
      copyButtonAriaLabel = "Copy to clipboard",
      copySuccessText = "Copied",
      copyErrorText = "Failed to copy",
      ...props
    },
    ref
  ) => {
    const [copied, setCopied] = React.useState(false);
    const [error, setError] = React.useState(false);

    const handleCopy = React.useCallback(async () => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setError(false);
        onCopy?.();

        setTimeout(() => {
          setCopied(false);
        }, 2000);
      } catch (err) {
        setError(true);
        setTimeout(() => {
          setError(false);
        }, 2000);
      }
    }, [text, onCopy]);

    const isIconVariant = variant === "icon";

    return (
      <Button
        ref={ref}
        variant="ghost"
        size={isIconVariant ? "icon" : "sm"}
        className={cn(
          "transition-all duration-200",
          isIconVariant && "h-8 w-8",
          copied && "text-green-500",
          error && "text-red-500",
          className
        )}
        onClick={handleCopy}
        aria-label={copyButtonAriaLabel}
        title={copied ? copySuccessText : error ? copyErrorText : copyButtonAriaLabel}
        {...props}
      >
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
        {!isIconVariant && (
          <span className="ml-1">{copied ? copySuccessText : error ? copyErrorText : "Copy"}</span>
        )}
      </Button>
    );
  }
);

CopyButton.displayName = "CopyButton";

export { CopyButton };
