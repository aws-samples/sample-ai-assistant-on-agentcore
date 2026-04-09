/**
 * CodeEditor — editable code editor using CodeMirror.
 * Uses VS Code Dark/Light themes via codemirror-shared.
 */

import React, { useRef, useEffect, useState } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { defaultKeymap, indentWithTab, history, historyKeymap } from "@codemirror/commands";
import { indentOnInput, bracketMatching } from "@codemirror/language";
import { getLangExtension, getEditorTheme } from "./codemirror-shared";
import { cn } from "@/lib/utils";

// Simple language detection from content when no language prop is provided
function detectLanguage(code) {
  if (!code) return "javascript";
  const first500 = code.slice(0, 500);
  if (/^(import |from |def |class .*:)/.test(first500) || /\bself\b/.test(first500))
    return "python";
  if (/^<(!DOCTYPE|html|div|span|p |a )/im.test(first500)) return "html";
  if (/^<\?xml/i.test(first500)) return "xml";
  if (/^\s*(resource|variable|output|provider|terraform|data)\s+"/m.test(first500)) return "hcl";
  if (/^\s*(apiVersion|kind):/m.test(first500) || /^---\n/m.test(first500)) return "yaml";
  if (/^#!/.test(first500) || /\b(echo|export|fi|done)\b/.test(first500)) return "bash";
  if (/^{[\s\n]/.test(first500) && /"[^"]+"\s*:/.test(first500)) return "json";
  if (/\b(func |package |import \()/.test(first500)) return "go";
  if (/\b(fn |let mut |impl |pub fn)/.test(first500)) return "rust";
  if (/\b(#include|int main|void |std::)/.test(first500)) return "cpp";
  return "javascript";
}

function CodeEditor({ value = "", onChange, readOnly = false, language, className }) {
  const resolvedLang = language || detectLanguage(value);
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  const themeCompartment = useRef(new Compartment());

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const [isDark, setIsDark] = useState(() =>
    typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false
  );

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setIsDark(document.documentElement.classList.contains("dark"));
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged && onChangeRef.current) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      indentOnInput(),
      bracketMatching(),
      getLangExtension(resolvedLang),
      themeCompartment.current.of(getEditorTheme(isDark)),
      EditorView.lineWrapping,
      keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
      history(),
      updateListener,
    ];

    if (readOnly) {
      extensions.push(EditorState.readOnly.of(true));
      extensions.push(EditorView.editable.of(false));
    }

    const state = EditorState.create({ doc: value, extensions });
    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, resolvedLang]);

  // Swap theme without recreating the editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(getEditorTheme(isDark)),
    });
  }, [isDark]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (currentDoc !== value) {
      const scrollPos = view.scrollDOM.scrollTop;
      view.dispatch({ changes: { from: 0, to: currentDoc.length, insert: value } });
      view.scrollDOM.scrollTop = scrollPos;
    }
  }, [value]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "overflow-hidden border border-border flex-1 flex flex-col",
        "[&_.cm-editor]:flex-1 [&_.cm-editor]:overflow-auto",
        className
      )}
    />
  );
}

export default CodeEditor;
