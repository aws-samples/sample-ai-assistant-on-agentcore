/**
 * TipTapEditor Component
 *
 * Rich text editor wrapping TipTap with markdown serialization.
 * Provides inline WYSIWYG markdown formatting via StarterKit + tiptap-markdown.
 * Exposes a ref-based API for programmatic content access.
 */

import React, { useEffect, useImperativeHandle, forwardRef, useRef } from "react";
import { useEditor, EditorContent, Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Placeholder from "@tiptap/extension-placeholder";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import { Plugin } from "@tiptap/pm/state";
import { shikiHighlightPlugin } from "./tiptap-shiki-plugin";
import TipTapToolbar from "./tiptap-toolbar";
import MathExtension from "./tiptap-math-extension";
import "katex/dist/katex.min.css";
import "./tiptap-editor.css";

const ShikiHighlight = Extension.create({
  name: "shikiHighlight",
  addProseMirrorPlugins() {
    return [shikiHighlightPlugin()];
  },
});

const TabHandler = Extension.create({
  name: "tabHandler",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleKeyDown(view, event) {
            if (event.key !== "Tab") return false;

            event.preventDefault();
            const { state } = view;

            if (event.shiftKey) {
              // Shift-Tab: remove up to 2 leading spaces before cursor
              const { from } = state.selection;
              const textBefore = state.doc.textBetween(Math.max(0, from - 2), from);
              const spacesToRemove = textBefore.endsWith("  ")
                ? 2
                : textBefore.endsWith(" ")
                  ? 1
                  : 0;
              if (spacesToRemove > 0) {
                view.dispatch(state.tr.delete(from - spacesToRemove, from));
              }
              return true;
            }

            // Tab: insert 2 spaces
            view.dispatch(state.tr.insertText("  "));
            return true;
          },
        },
      }),
    ];
  },
});

const TrailingParagraph = Extension.create({
  name: "trailingParagraph",
  addProseMirrorPlugins() {
    const plugin = new Plugin({
      appendTransaction(transactions, oldState, newState) {
        const lastNode = newState.doc.lastChild;
        if (!lastNode) return null;
        // If the last node isn't a paragraph, append one so the cursor can escape
        if (lastNode.type.name !== "paragraph") {
          const { tr } = newState;
          const paragraph = newState.schema.nodes.paragraph.create();
          tr.insert(newState.doc.content.size, paragraph);
          return tr;
        }
        return null;
      },
    });
    return [plugin];
  },
});

const TipTapEditor = forwardRef(function TipTapEditor(
  { content = "", editable = true, placeholder = "", onUpdate },
  ref
) {
  const suppressUpdateRef = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      ShikiHighlight,
      TabHandler,
      TrailingParagraph,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Markdown.configure({
        html: false,
        breaks: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
      MathExtension,
    ],
    content,
    editable,
    onUpdate: ({ editor: ed }) => {
      if (suppressUpdateRef.current) return;
      if (onUpdate) {
        onUpdate(ed.storage.markdown.getMarkdown());
      }
    },
  });

  // Expose ref API
  useImperativeHandle(
    ref,
    () => ({
      getMarkdown() {
        if (!editor) return "";
        return editor.storage.markdown.getMarkdown();
      },
      setContent(md) {
        if (!editor) return;
        editor.commands.setContent(md);
      },
      insertContent(content) {
        if (!editor) return;
        editor.commands.insertContent(content);
      },
      getEditor() {
        if (!editor) return null;
        return editor;
      },
    }),
    [editor]
  );

  // Re-initialize content when the content prop changes
  useEffect(() => {
    if (!editor) return;
    const currentMarkdown = editor.storage.markdown.getMarkdown();
    if (content !== currentMarkdown) {
      suppressUpdateRef.current = true;
      editor.commands.setContent(content);
      suppressUpdateRef.current = false;
    }
  }, [content, editor]);

  // Update editable state when the editable prop changes
  useEffect(() => {
    if (!editor) return;
    editor.setEditable(editable);
  }, [editable, editor]);

  return (
    <div className="tiptap-editor">
      <TipTapToolbar editor={editor} disabled={!editable} />
      <EditorContent editor={editor} />
    </div>
  );
});

export default TipTapEditor;
