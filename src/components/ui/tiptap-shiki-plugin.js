/**
 * TipTap syntax highlighting plugin using Lezer parsers.
 *
 * Parses code blocks with the same Lezer grammars used by CodeMirror,
 * then applies inline color decorations using GitHub theme colors.
 * Uses HighlightStyle.style() to resolve the exact same colors as CodeMirror.
 */
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { highlightTree } from "@lezer/highlight";
import { HighlightStyle } from "@codemirror/language";
import { githubDarkStyle, githubLightStyle } from "./codemirror-shared.js";

import { pythonLanguage } from "@codemirror/lang-python";
import {
  javascriptLanguage,
  jsxLanguage,
  tsxLanguage,
  typescriptLanguage,
} from "@codemirror/lang-javascript";
import { htmlLanguage } from "@codemirror/lang-html";
import { xmlLanguage } from "@codemirror/lang-xml";
import { cssLanguage } from "@codemirror/lang-css";
import { jsonLanguage } from "@codemirror/lang-json";
import { yamlLanguage } from "@codemirror/lang-yaml";
import { markdownLanguage } from "@codemirror/lang-markdown";
import { rustLanguage } from "@codemirror/lang-rust";
import { cppLanguage } from "@codemirror/lang-cpp";
import { javaLanguage } from "@codemirror/lang-java";
import { goLanguage } from "@codemirror/lang-go";

// Build HighlightStyle instances — same class CodeMirror uses internally
const darkHL = HighlightStyle.define(githubDarkStyle);
const lightHL = HighlightStyle.define(githubLightStyle);

const langMap = {
  javascript: javascriptLanguage,
  js: javascriptLanguage,
  jsx: jsxLanguage,
  tsx: tsxLanguage,
  typescript: typescriptLanguage,
  ts: typescriptLanguage,
  python: pythonLanguage,
  py: pythonLanguage,
  html: htmlLanguage,
  xml: xmlLanguage,
  css: cssLanguage,
  json: jsonLanguage,
  yaml: yamlLanguage,
  yml: yamlLanguage,
  markdown: markdownLanguage,
  md: markdownLanguage,
  rust: rustLanguage,
  rs: rustLanguage,
  cpp: cppLanguage,
  "c++": cppLanguage,
  c: cppLanguage,
  java: javaLanguage,
  go: goLanguage,
  golang: goLanguage,
};

function resolveLanguage(lang) {
  if (!lang) return null;
  return langMap[lang.toLowerCase().trim()] || null;
}

function isDarkMode() {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark");
}

const pluginKey = new PluginKey("cmHighlight");

function buildDecorations(doc) {
  const decorations = [];
  const hl = isDarkMode() ? darkHL : lightHL;

  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return;

    const language = resolveLanguage(node.attrs.language);
    if (!language) return;

    const code = node.textContent;
    if (!code) return;

    const tree = language.parser.parse(code);

    // highlightTree with a HighlightStyle returns CSS class names.
    // We look up the actual style rule from the HighlightStyle to extract
    // the color and apply it as an inline style on the ProseMirror decoration.
    highlightTree(tree, hl, (from, to, classes) => {
      if (!classes) return;
      // The classes string contains CodeMirror-generated class names like "ͼ1a ͼ1b"
      // We need to find the matching style rule to get the color.
      // HighlightStyle stores rules in its .module property with class->style mappings.
      // Instead, we'll extract color from the stylesheet directly.
      decorations.push(Decoration.inline(pos + 1 + from, pos + 1 + to, { class: classes }));
    });
  });

  return DecorationSet.create(doc, decorations);
}

export function shikiHighlightPlugin() {
  // Inject the HighlightStyle's CSS rules into the document so the class names work
  const injectStyles = () => {
    const id = "cm-highlight-styles";
    if (document.getElementById(id)) return;

    const style = document.createElement("style");
    style.id = id;

    // Extract CSS rules from both highlight styles
    const rules = [];
    for (const hl of [darkHL, lightHL]) {
      if (hl.module) {
        const sheet = hl.module;
        // HighlightStyle uses @codemirror's StyleModule which has a getRules() method
        if (typeof sheet.getRules === "function") {
          rules.push(sheet.getRules());
        }
      }
    }

    if (rules.length > 0) {
      style.textContent = rules.join("\n");
      document.head.appendChild(style);
    }
  };

  return new Plugin({
    key: pluginKey,
    state: {
      init(_, { doc }) {
        return buildDecorations(doc);
      },
      apply(tr, oldDecorations) {
        // Only rebuild when the document actually changed
        if (!tr.docChanged && !tr.getMeta(pluginKey)) return oldDecorations;
        return buildDecorations(tr.doc);
      },
    },
    props: {
      decorations(state) {
        return this.getState(state);
      },
    },
    view(editorView) {
      // Inject highlight CSS into the document
      injectStyles();

      let lastDark = isDarkMode();
      const observer = new MutationObserver(() => {
        const nowDark = isDarkMode();
        if (nowDark === lastDark) return;
        lastDark = nowDark;
        // Signal a theme-triggered rebuild via plugin meta
        editorView.dispatch(editorView.state.tr.setMeta(pluginKey, true));
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
      return {
        destroy() {
          observer.disconnect();
        },
      };
    },
  });
}
