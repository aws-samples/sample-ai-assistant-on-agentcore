/**
 * CodeView — read-only code block using CodeMirror.
 * Uses VS Code Dark/Light themes via codemirror-shared,
 * identical highlighting to CodeEditor.
 */

import * as React from "react";
import { EditorView } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { getLangExtension, getViewerTheme, languageMap } from "./codemirror-shared";
import { cn } from "@/lib/utils";

const CodeView = React.forwardRef(({ content, language, actions, className, ...props }, ref) => {
  const containerRef = React.useRef(null);
  const viewRef = React.useRef(null);

  const [isDark, setIsDark] = React.useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false
  );

  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  // Create/recreate editor only when theme or language changes
  React.useEffect(() => {
    if (!containerRef.current) return;

    const extensions = [
      getLangExtension(language),
      getViewerTheme(isDark),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
    ];

    const state = EditorState.create({ doc: content || "", extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDark, language]);

  // Incrementally update content via transaction instead of recreating the editor
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    const next = content || "";
    if (current !== next) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: next },
      });
    }
  }, [content]);

  return (
    <div
      ref={ref}
      className={cn(
        "relative group rounded-xl overflow-clip cursor-default",
        "border border-border",
        "bg-[hsl(var(--card))]",
        className
      )}
      {...props}
    >
      {actions && (
        <div
          className="sticky top-0 z-10 flex justify-end pointer-events-none"
          style={{ height: 0 }}
        >
          <div className="pointer-events-auto pt-2 pr-2 cursor-pointer opacity-0 group-hover:opacity-100 transition-opacity">
            {actions}
          </div>
        </div>
      )}
      <div ref={containerRef} className="overflow-x-auto py-2" />
    </div>
  );
});

CodeView.displayName = "CodeView";

const getShikiLanguage = (lang) => lang;

export { CodeView, languageMap, getShikiLanguage };
