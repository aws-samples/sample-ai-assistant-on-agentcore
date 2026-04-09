import React, { useRef, useEffect, useState, useMemo, useCallback } from "react";
import { X, Loader2, Copy, Check, Download, Bookmark, BookmarkCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import TipTapEditor from "@/components/ui/tiptap-editor";
import CodeEditor from "@/components/ui/code-editor";
import { useCanvas } from "./context/CanvasContext";
import { useTheme } from "../ThemeContext";
import useZoomPan from "./hooks/useZoomPan";
import useCanvasAutoSave from "./hooks/useCanvasAutoSave";
import ViewToggle from "./canvas/ViewToggle";
import StreamingPlaceholder from "./canvas/StreamingPlaceholder";
import "./CanvasPanel.css";

// Canvas types that support a preview/code toggle
const PREVIEW_TYPES = new Set(["html", "diagram", "svg", "mermaid"]);
// Preview types rendered inside an iframe
const IFRAME_PREVIEW_TYPES = new Set(["html", "diagram"]);
// Preview types rendered as zoomable SVG
const SVG_PREVIEW_TYPES = new Set(["svg", "mermaid"]);

const CanvasPanel = React.memo(({ sessionId, agentIsStreaming, boundProject, onSaveCanvas }) => {
  const { effectiveTheme } = useTheme();
  const {
    canvases,
    activeCanvasId,
    selectedSnapshotIndex,
    isPanelOpen,
    isStreaming,
    streamingCanvasId,
    streamingCanvasTitle,
    closePanel,
    userEditCanvas,
    getDisplayContent,
  } = useCanvas();

  const editorRef = useRef(null);
  const [viewMode, setViewMode] = useState("preview");

  const activeCanvas = activeCanvasId ? canvases.get(activeCanvasId) : null;
  const canvasType = activeCanvas?.type ?? "document";
  const canvasTitle = activeCanvas?.title ?? "";
  const latestContent = activeCanvas?.latestContent ?? "";
  const displayContent = getDisplayContent(activeCanvasId);

  const canvasIsStreaming = isStreaming && streamingCanvasId === activeCanvasId;
  const isEditable = selectedSnapshotIndex === null && !isStreaming && !agentIsStreaming;
  const hasPreview = PREVIEW_TYPES.has(canvasType);

  // --- Auto-save hook ---
  const { handleContentChange, userEditingRef, programmaticUpdateRef } = useCanvasAutoSave({
    sessionId,
    canvasId: activeCanvasId,
    canvasTitle,
    canvasType,
    userEditCanvas,
    isEditable,
    canvasIsStreaming,
    selectedSnapshotIndex,
    latestContent,
  });

  // --- Diagram bidirectional sync ---
  // Tracks whether the next displayContent change originated from draw.io (to skip iframe reload)
  const fromDiagramRef = useRef(false);
  // Holds the XML that was last loaded into draw.io (decoupled from displayContent)
  const diagramXmlRef = useRef(displayContent);
  // Incremented to force diagramSrcdoc recompute only when we actually want a reload
  const [diagramLoadTrigger, setDiagramLoadTrigger] = useState(0);

  // --- Zoom & pan for SVG / Mermaid ---
  const zoomPan = useZoomPan([activeCanvasId, displayContent]);

  // --- HTML iframe management ---
  const iframeRef = useRef(null);
  const [iframeReady, setIframeReady] = useState(false);
  const prevCanvasIdRef = useRef(activeCanvasId);

  useEffect(() => {
    if (prevCanvasIdRef.current !== activeCanvasId) {
      prevCanvasIdRef.current = activeCanvasId;
      setIframeReady(false);
    }
  }, [activeCanvasId]);

  useEffect(() => {
    if (viewMode === "preview") setIframeReady(false);
  }, [viewMode]);

  const themeVarNames = useMemo(
    () => [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "primary",
      "primary-foreground",
      "secondary",
      "secondary-foreground",
      "muted",
      "muted-foreground",
      "accent",
      "accent-foreground",
      "destructive",
      "destructive-foreground",
      "border",
      "input",
      "ring",
      "chart-1",
      "chart-2",
      "chart-3",
      "chart-4",
      "chart-5",
    ],
    []
  );

  const cachedThemeVars = useMemo(() => {
    const root = document.documentElement;
    const style = getComputedStyle(root);
    const vars = {};
    for (const v of themeVarNames) {
      const val = style.getPropertyValue(`--${v}`).trim();
      if (val) vars[v] = val;
    }
    return vars;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveTheme]);

  const themedHtmlContent = useMemo(() => {
    if (canvasType !== "html" || !displayContent) return displayContent;
    const vars = cachedThemeVars;
    const cssVars = Object.entries(vars)
      .map(([k, v]) => `  --${k}: ${v};`)
      .join("\n");
    const themeBlock = `<style data-theme="app">
:root {
${cssVars}
  color-scheme: ${effectiveTheme === "dark" ? "dark" : "light"};
}
body {
  background-color: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  margin: 0;
  padding: 16px;
}
* { scrollbar-width: thin; scrollbar-color: rgba(128,128,128,0.25) transparent; }
*::-webkit-scrollbar { width: 6px; height: 6px; }
*::-webkit-scrollbar-track { background: transparent; }
*::-webkit-scrollbar-thumb { background: rgba(128,128,128,0.25); border-radius: 3px; }
*::-webkit-scrollbar-corner { background: transparent; }
</style>
<script>
window.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'theme-update') {
    var root = document.documentElement;
    var vars = e.data.vars;
    for (var k in vars) root.style.setProperty('--' + k, vars[k]);
    root.style.setProperty('color-scheme', e.data.colorScheme);
  }
});
<\/script>`;
    if (displayContent.includes("</head>")) {
      return displayContent.replace("</head>", themeBlock + "</head>");
    }
    return themeBlock + displayContent;
    // Only rebuild srcdoc when content changes, not on theme change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasType, displayContent]);

  // Send theme updates to iframe via postMessage (avoids full reload)
  useEffect(() => {
    if (!iframeRef.current || canvasType !== "html" || viewMode !== "preview") return;
    iframeRef.current.contentWindow?.postMessage(
      {
        type: "theme-update",
        vars: cachedThemeVars,
        colorScheme: effectiveTheme === "dark" ? "dark" : "light",
      },
      "*"
    );
  }, [effectiveTheme, canvasType, viewMode, cachedThemeVars]);

  // Debounced preview during streaming — only update iframe after 500ms of no new content
  const debouncedHtmlRef = useRef(null);
  const [debouncedHtml, setDebouncedHtml] = useState(themedHtmlContent);

  useEffect(() => {
    if (canvasIsStreaming) {
      clearTimeout(debouncedHtmlRef.current);
      debouncedHtmlRef.current = setTimeout(() => setDebouncedHtml(themedHtmlContent), 500);
      return () => clearTimeout(debouncedHtmlRef.current);
    } else {
      clearTimeout(debouncedHtmlRef.current);
      setDebouncedHtml(themedHtmlContent);
    }
  }, [themedHtmlContent, canvasIsStreaming]);

  useEffect(() => {
    if (iframeRef.current && canvasType === "html" && viewMode === "preview" && debouncedHtml) {
      iframeRef.current.srcdoc = debouncedHtml;
    }
  }, [debouncedHtml, canvasType, viewMode]);

  const onIframeLoad = useCallback(() => setIframeReady(true), []);

  // --- Save to project ---
  const [saving, setSaving] = useState(false);
  const savedCanvases = boundProject?.saved_canvases ?? [];
  const isSaved = activeCanvasId
    ? savedCanvases.some((c) => c.canvas_id === activeCanvasId)
    : false;

  const handleSaveToProject = useCallback(async () => {
    if (!activeCanvasId || !onSaveCanvas) return;
    setSaving(true);
    try {
      await onSaveCanvas(activeCanvasId);
    } finally {
      setSaving(false);
    }
  }, [activeCanvasId, onSaveCanvas]);

  // --- Copy to clipboard ---
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    if (!displayContent) return;
    const text = displayContent;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [displayContent, canvasType]);

  // Reset view mode to preview for visual canvas types
  useEffect(() => {
    if (hasPreview) setViewMode("preview");
  }, [activeCanvasId, hasPreview]);

  // --- Draw.io diagram embed ---
  const diagramSrcdoc = useMemo(() => {
    if (canvasType !== "diagram") return "";
    const xmlContent0 = diagramXmlRef.current;
    if (!xmlContent0) return "";
    let xmlContent = xmlContent0;
    if (xmlContent.includes("<mxGraphModel")) {
      xmlContent = xmlContent
        .replace(/\bpage="[^"]*"/g, 'page="0"')
        .replace(/\bpageVisible="[^"]*"/g, "")
        .replace(/\bgrid="[^"]*"/g, 'grid="0"');
      if (!xmlContent.includes('page="0"')) {
        xmlContent = xmlContent.replace("<mxGraphModel", '<mxGraphModel page="0"');
      }
      if (!xmlContent.includes('grid="0"')) {
        xmlContent = xmlContent.replace("<mxGraphModel", '<mxGraphModel grid="0"');
      }
    }
    const escapedXml = xmlContent
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\r/g, "\\r")
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      .replace(/</g, "\\x3C")
      .replace(/>/g, "\\x3E")
      .replace(/"/g, "\\x22")
      .replace(/&/g, "\\x26");
    const isDark = effectiveTheme === "dark";
    return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>html,body,iframe{margin:0;padding:0;width:100%;height:100%;border:none;overflow:hidden;background:${isDark ? "#171717" : "#ffffff"}}</style>
</head><body>
<iframe id="drawio" src="https://embed.diagrams.net/?embed=1&proto=json&spin=1&libraries=0&noSaveBtn=1&noExitBtn=1&saveAndExit=0&ui=min&pages=0&configure=1${isDark ? "&dark=1" : ""}"></iframe>
<script>
var DRAWIO_ORIGIN='https://embed.diagrams.net';
var iframe=document.getElementById('drawio');
window.addEventListener('message',function(evt){
  if(evt.origin!==DRAWIO_ORIGIN)return;
  var msg;
  try{msg=JSON.parse(evt.data);}catch(e){return;}
  if(!msg||typeof msg.event!=='string')return;
  if(msg.event==='configure'){
    iframe.contentWindow.postMessage(JSON.stringify({
      action:'configure',
      config:{
        defaultPageVisible:false,
        defaultGridEnabled:false,
        darkColor:'#171717',
        css:'.geFooterContainer,.geTabContainer,.geStatusBar,.mxWindow,.geMenubarContainer,.geToolbarContainer,.geSidebarContainer,.geFormatContainer,.geNorthPanel,.geHsplit,.geVsplit{display:none !important}.geEditor .geTabContainer+div{bottom:0 !important}.geEditor{margin-top:0 !important}.geDiagramBackdrop{background:${isDark ? "#171717" : "#ffffff"} !important}.mxCellEditor{display:none !important}.mxPopupMenu,.mxPopupMenuBg{display:none !important}'
      }
    }),DRAWIO_ORIGIN);
  }
  if(msg.event==='init'){
    iframe.contentWindow.postMessage(JSON.stringify({
      action:'load',
      xml:'${escapedXml}',
      autosave:1
    }),DRAWIO_ORIGIN);
  }
  if(msg.event==='load'){
    window.parent.postMessage('drawio-ready','*');
  }
  if(msg.event==='autosave'&&msg.xml){
    window.parent.postMessage({type:'drawio-autosave',xml:msg.xml},'*');
  }
});
<\/script>
</body></html>`;
  }, [canvasType, diagramLoadTrigger, effectiveTheme]);

  const [diagramReady, setDiagramReady] = useState(false);
  const prevDiagramId = useRef(activeCanvasId);
  useEffect(() => {
    if (prevDiagramId.current !== activeCanvasId) {
      prevDiagramId.current = activeCanvasId;
      setDiagramReady(false);
    }
  }, [activeCanvasId]);
  useEffect(() => {
    if (canvasType !== "diagram") return;
    setDiagramReady(false);
    const handler = (evt) => {
      if (evt.data === "drawio-ready") setDiagramReady(true);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [canvasType, diagramLoadTrigger, effectiveTheme, viewMode]);

  // Reload draw.io when content changes externally (agent update / snapshot switch),
  // but skip reload when the change originated from the diagram itself (autosave).
  useEffect(() => {
    if (canvasType !== "diagram") return;
    if (fromDiagramRef.current) {
      fromDiagramRef.current = false;
      return;
    }
    diagramXmlRef.current = displayContent;
    setDiagramLoadTrigger((n) => n + 1);
  }, [canvasType, displayContent, activeCanvasId]);

  // Forward draw.io autosave events → canvas state (without re-loading the iframe)
  useEffect(() => {
    if (canvasType !== "diagram") return;
    const handler = (evt) => {
      if (!evt.data || typeof evt.data !== "object" || evt.data.type !== "drawio-autosave") return;
      fromDiagramRef.current = true;
      diagramXmlRef.current = evt.data.xml; // keep ref current so view-switch reload uses latest
      handleContentChange(evt.data.xml);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [canvasType, handleContentChange]);

  // When switching back to preview mode, reload draw.io with the latest xml
  // (diagramXmlRef is kept current by both the content watcher and autosave handler)
  useEffect(() => {
    if (canvasType !== "diagram" || viewMode !== "preview") return;
    setDiagramLoadTrigger((n) => n + 1);
  }, [canvasType, viewMode]);

  // --- Mermaid rendering ---
  const [mermaidSvg, setMermaidSvg] = useState("");
  useEffect(() => {
    if (canvasType !== "mermaid" || !displayContent || canvasIsStreaming) {
      setMermaidSvg("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: effectiveTheme === "dark" ? "dark" : "default",
          securityLevel: "loose",
          suppressErrorRendering: true,
        });
        const renderId = "mermaid-" + Date.now();
        const { svg } = await mermaid.render(renderId, displayContent.trim());
        if (!cancelled) setMermaidSvg(svg);
      } catch {
        document.querySelectorAll('[id^="dmermaid-"]').forEach((el) => el.remove());
        if (!cancelled) setMermaidSvg("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canvasType, displayContent, canvasIsStreaming, effectiveTheme]);

  // --- SVG export ---
  const handleExportSvg = useCallback(() => {
    let svgContent = "";
    if (canvasType === "svg") svgContent = displayContent;
    else if (canvasType === "mermaid" && mermaidSvg) svgContent = mermaidSvg;
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${canvasTitle || "diagram"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [canvasType, displayContent, mermaidSvg, canvasTitle]);

  // Sync TipTap editor for document type, skip user-originated changes
  useEffect(() => {
    if (canvasType === "document" && editorRef.current && !userEditingRef.current) {
      programmaticUpdateRef.current = true;
      editorRef.current.setContent(displayContent || "");
      programmaticUpdateRef.current = false;
    }
  }, [displayContent, canvasType, userEditingRef, programmaticUpdateRef]);

  // --- Derived body className ---
  const bodyClass = useMemo(() => {
    const classes = ["canvas-panel-body"];
    if (IFRAME_PREVIEW_TYPES.has(canvasType) && viewMode === "preview") {
      classes.push("canvas-panel-body--iframe");
    }
    if (SVG_PREVIEW_TYPES.has(canvasType) && viewMode === "preview") {
      classes.push("canvas-panel-body--svg");
    }
    if (canvasType === "code" || (hasPreview && viewMode === "code")) {
      classes.push("canvas-panel-body--code");
    }
    return classes.join(" ");
  }, [canvasType, viewMode, hasPreview]);

  // --- Early returns ---
  if (!isPanelOpen) return null;

  // Streaming placeholder when canvas metadata hasn't arrived yet
  if (!activeCanvas && isStreaming) {
    return (
      <div className={`canvas-panel ${effectiveTheme}`}>
        <div className="canvas-panel-header">
          <div className="canvas-panel-header-left">
            <span className="canvas-panel-title">{streamingCanvasTitle || "Canvas"}</span>
          </div>
          <div className="canvas-panel-header-right">
            <Loader2
              size={16}
              className="canvas-panel-spinner"
              aria-label="Loading canvas content"
            />
            <Button
              variant="ghost"
              size="icon"
              className="canvas-panel-icon-btn"
              onClick={closePanel}
              aria-label="Close canvas panel"
              title="Close"
            >
              <X size={14} />
            </Button>
          </div>
        </div>
        <div className="canvas-panel-body">
          <StreamingPlaceholder label="Creating canvas..." />
        </div>
      </div>
    );
  }

  if (!activeCanvas) return null;

  // --- Render body content based on canvas type ---
  const renderBody = () => {
    switch (canvasType) {
      case "diagram":
        if (viewMode !== "preview") return <CodeEditor value={displayContent} readOnly />;
        if (canvasIsStreaming) return <StreamingPlaceholder label="Generating diagram..." />;
        return (
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {!diagramReady && (
              <StreamingPlaceholder
                label="Loading diagram..."
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 5,
                  background: effectiveTheme === "dark" ? "#171717" : "#ffffff",
                }}
              />
            )}
            <iframe
              className="canvas-panel-iframe loaded"
              sandbox="allow-scripts allow-same-origin"
              srcDoc={diagramSrcdoc}
              title={activeCanvas.title}
              style={{
                background: effectiveTheme === "dark" ? "#171717" : "#ffffff",
                width: "100%",
                height: "100%",
                opacity: diagramReady ? 1 : 0,
                transition: "opacity 0.3s ease",
              }}
            />
          </div>
        );

      case "svg":
        if (viewMode !== "preview") {
          return (
            <CodeEditor
              value={displayContent}
              readOnly={!isEditable}
              onChange={handleContentChange}
            />
          );
        }
        if (canvasIsStreaming) return <StreamingPlaceholder label="Generating SVG..." />;
        return (
          <div
            className="canvas-panel-svg-container"
            ref={zoomPan.containerRef}
            onMouseDown={zoomPan.handleMouseDown}
            style={{ cursor: zoomPan.cursor }}
          >
            <img
              key={`${activeCanvasId}-${displayContent.length}`}
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(displayContent)}`}
              alt={activeCanvas.title}
              draggable={false}
              style={{ maxWidth: "100%", height: "auto", ...zoomPan.transformStyle }}
            />
          </div>
        );

      case "mermaid":
        if (viewMode !== "preview") {
          return (
            <CodeEditor
              value={displayContent}
              readOnly={!isEditable}
              onChange={handleContentChange}
            />
          );
        }
        if (canvasIsStreaming) return <StreamingPlaceholder label="Generating diagram..." />;
        if (!mermaidSvg) return <StreamingPlaceholder label="Rendering diagram..." />;
        return (
          <div
            ref={zoomPan.containerRef}
            onMouseDown={zoomPan.handleMouseDown}
            className="canvas-panel-svg-container"
            style={{ cursor: zoomPan.cursor }}
          >
            <div style={zoomPan.transformStyle} dangerouslySetInnerHTML={{ __html: mermaidSvg }} />
          </div>
        );

      case "html":
        if (viewMode !== "preview") {
          return (
            <CodeEditor
              value={displayContent}
              readOnly={!isEditable}
              onChange={handleContentChange}
            />
          );
        }
        return (
          <div style={{ position: "relative", width: "100%", height: "100%" }}>
            {canvasIsStreaming && (
              <StreamingPlaceholder
                label="Generating HTML..."
                style={{
                  position: "absolute",
                  inset: 0,
                  zIndex: 5,
                  background: "hsl(var(--background))",
                }}
              />
            )}
            <iframe
              ref={iframeRef}
              className={`canvas-panel-iframe ${iframeReady ? "loaded" : ""}`}
              sandbox="allow-scripts"
              title={activeCanvas.title}
              onLoad={onIframeLoad}
            />
          </div>
        );

      case "code":
        return (
          <CodeEditor
            value={displayContent}
            readOnly={!isEditable}
            onChange={handleContentChange}
            language={activeCanvas.language}
          />
        );

      default:
        return (
          <TipTapEditor
            ref={editorRef}
            content={displayContent}
            editable={isEditable}
            onUpdate={handleContentChange}
          />
        );
    }
  };

  return (
    <div className={`canvas-panel ${effectiveTheme}`}>
      <div className="canvas-panel-header">
        <div className="canvas-panel-header-left">
          <span className="canvas-panel-title">{activeCanvas.title}</span>
        </div>
        <div className="canvas-panel-header-right">
          {hasPreview && <ViewToggle viewMode={viewMode} setViewMode={setViewMode} />}
          {hasPreview && <div className="canvas-panel-header-sep" />}
          {(canvasType === "svg" || canvasType === "mermaid") && (
            <button
              className="canvas-panel-icon-btn"
              onClick={handleExportSvg}
              aria-label="Export as SVG"
              title="Export SVG"
            >
              <Download size={14} />
            </button>
          )}
          {canvasIsStreaming && (
            <Loader2
              size={16}
              className="canvas-panel-spinner"
              aria-label="Loading canvas content"
            />
          )}
          {boundProject && (
            <Button
              variant="ghost"
              size="icon"
              className="canvas-panel-icon-btn"
              onClick={handleSaveToProject}
              disabled={saving || canvasIsStreaming}
              aria-label={isSaved ? "Saved to project" : "Save to project"}
              title={isSaved ? "Saved ✓ — click to update" : "Save to project"}
            >
              {saving ? (
                <Loader2 size={14} className="canvas-panel-spinner" />
              ) : isSaved ? (
                <BookmarkCheck size={14} />
              ) : (
                <Bookmark size={14} />
              )}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="canvas-panel-icon-btn"
            onClick={handleCopy}
            aria-label="Copy content"
            title={copied ? "Copied" : "Copy"}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="canvas-panel-icon-btn"
            onClick={closePanel}
            aria-label="Close canvas panel"
            title="Close"
          >
            <X size={14} />
          </Button>
        </div>
      </div>
      <div className={bodyClass} style={{ background: "hsl(var(--background))" }}>
        {renderBody()}
      </div>
    </div>
  );
});

export default CanvasPanel;
