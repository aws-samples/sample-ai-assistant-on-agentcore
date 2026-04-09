import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = ({ className, variant = "default", ...props }) => (
  <TabsPrimitive.List
    className={cn(
      variant === "line"
        ? "inline-flex items-center bg-transparent rounded-none p-0 gap-0 text-muted-foreground"
        : "inline-flex items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
);

const TabsTrigger = ({ className, variant = "default", ...props }) => (
  <TabsPrimitive.Trigger
    className={cn(
      variant === "line"
        ? [
            "inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent bg-transparent",
            "px-3 pb-2 pt-0 text-sm font-medium text-muted-foreground transition-colors",
            "hover:text-foreground",
            "data-[state=active]:border-foreground data-[state=active]:text-foreground",
            "focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
          ]
        : [
            "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-offset-background transition-all",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            "disabled:pointer-events-none disabled:opacity-50",
            "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
          ],
      className
    )}
    {...props}
  />
);

const TabsContent = ({ className, ...props }) => (
  <TabsPrimitive.Content
    className={cn(
      "mt-3 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
);

export { Tabs, TabsList, TabsTrigger, TabsContent };
