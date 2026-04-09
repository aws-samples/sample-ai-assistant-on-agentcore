import { useState, useEffect } from "react";
import {
  SidebarHeader as ShadcnSidebarHeader,
  SidebarMenu,
  SidebarMenuItem,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

/**
 * Sparky Logo SVG component
 */
const SparkyLogo = ({ className, style }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="none"
    className={className}
    style={style}
  >
    <defs>
      <radialGradient
        id="sparkleGradient"
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
      fill="url(#sparkleGradient)"
    />
  </svg>
);

/**
 * SidebarHeader component displays the Sparky logo and collapse/expand trigger
 * in the header section of the sidebar.
 *
 */
export function SidebarHeader() {
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  // Delayed state to sync with sidebar animation (500ms)
  const [delayedCollapsed, setDelayedCollapsed] = useState(isCollapsed);
  const [isTransitioning, setIsTransitioning] = useState(false);

  useEffect(() => {
    // Start transition immediately when state changes
    if (isCollapsed !== delayedCollapsed) {
      setIsTransitioning(true);
    }

    const timer = setTimeout(
      () => {
        setDelayedCollapsed(isCollapsed);
        setIsTransitioning(false);
      },
      isCollapsed ? 500 : 0
    ); // Delay only when collapsing

    return () => clearTimeout(timer);
  }, [isCollapsed, delayedCollapsed]);

  return (
    <ShadcnSidebarHeader className="p-0 pb-2">
      <SidebarMenu>
        <SidebarMenuItem>
          <div className="flex items-center w-full h-12 px-2 mt-1 group/header relative">
            {/* Logo container - always present */}
            <div className="relative flex items-center justify-center w-8 h-8 ml-1">
              <SparkyLogo
                className={`sidebar-logo transition-opacity duration-200 pointer-events-none ${
                  delayedCollapsed ? "group-hover/header:opacity-0" : ""
                }`}
              />
              {/* Expand button overlay - always rendered, visibility controlled by CSS */}
              <div
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
                  delayedCollapsed
                    ? "opacity-0 group-hover/header:opacity-100"
                    : "opacity-0 pointer-events-none"
                }`}
              >
                <SidebarTrigger />
              </div>
            </div>

            {/* Collapse button when expanded - on the right */}
            <div
              className={`absolute right-2 top-1/2 -translate-y-1/2 transition-opacity duration-200 ${
                delayedCollapsed || isTransitioning
                  ? "opacity-0 pointer-events-none"
                  : "opacity-100"
              }`}
            >
              <SidebarTrigger />
            </div>
          </div>
        </SidebarMenuItem>
      </SidebarMenu>
    </ShadcnSidebarHeader>
  );
}

export default SidebarHeader;
