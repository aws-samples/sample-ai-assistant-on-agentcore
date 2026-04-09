import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useSidebar } from "@/components/ui/sidebar";
import Main from "../../Main";
import ModelSelector from "../Agent/ModelSelector";
import "./AppLayoutMFE.css";

function AppLayoutMFE({ user }) {
  const location = useLocation();
  const { state, setOpen } = useSidebar();
  const isSidebarOpen = state === "expanded";

  // Track canvas open state via document attribute
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsCanvasOpen(document.documentElement.hasAttribute("data-canvas-open"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-canvas-open"],
    });
    return () => observer.disconnect();
  }, []);

  const showOverlay = isCanvasOpen && isSidebarOpen;

  // Only show model selector on chat/home pages
  const showModelSelector = location.pathname === "/" || location.pathname.startsWith("/chat");

  // In overlay mode (canvas open), model selector always lives in sidebar
  const showHeaderModelSelector = showModelSelector && !isSidebarOpen && !isCanvasOpen;

  return (
    <div className="app-layout-container">
      {showHeaderModelSelector && (
        <div className="app-header">
          <ModelSelector />
        </div>
      )}
      {showOverlay && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      {user && <Main user={user} />}
    </div>
  );
}

export default AppLayoutMFE;
