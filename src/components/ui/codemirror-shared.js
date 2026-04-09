/**
 * Shared CodeMirror configuration: VS Code Dark/Light themes and language resolver.
 * Used by both CodeEditor (editable) and CodeView (read-only).
 */

import { StreamLanguage } from "@codemirror/language";
import {
  githubDarkInit,
  githubDarkStyle,
  githubLightInit,
  githubLightStyle,
} from "@uiw/codemirror-theme-github";

import { python } from "@codemirror/lang-python";
import { javascript } from "@codemirror/lang-javascript";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { yaml } from "@codemirror/lang-yaml";
import { markdown } from "@codemirror/lang-markdown";
import { sql } from "@codemirror/lang-sql";
import { rust } from "@codemirror/lang-rust";
import { cpp } from "@codemirror/lang-cpp";
import { java } from "@codemirror/lang-java";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { hcl } from "codemirror-lang-hcl";
import { shell } from "@codemirror/legacy-modes/mode/shell";

// ── VS Code themes with custom backgrounds ──

// ── GitHub themes ──
// Use the same base theme for both editor and viewer to ensure identical highlighting.
// Background overrides are applied separately.

export function getEditorTheme(isDark) {
  return isDark
    ? githubDarkInit({ settings: { background: "#1C1C1C", gutterBackground: "#1C1C1C" } })
    : githubLightInit({ settings: { background: "#F5F5F5", gutterBackground: "#F5F5F5" } });
}

export function getViewerTheme(isDark) {
  // Use the same theme but override backgrounds to transparent
  return isDark
    ? githubDarkInit({
        settings: {
          background: "transparent",
          gutterBackground: "transparent",
          gutterForeground: "transparent",
        },
      })
    : githubLightInit({
        settings: {
          background: "transparent",
          gutterBackground: "transparent",
          gutterForeground: "transparent",
        },
      });
}

// ── Language resolver ──
const langMap = {
  python: () => python(),
  py: () => python(),
  javascript: () => javascript(),
  js: () => javascript(),
  jsx: () => javascript({ jsx: true }),
  typescript: () => javascript({ typescript: true }),
  ts: () => javascript({ typescript: true }),
  tsx: () => javascript({ jsx: true, typescript: true }),
  html: () => html(),
  xml: () => xml(),
  css: () => css(),
  json: () => json(),
  yaml: () => yaml(),
  yml: () => yaml(),
  markdown: () => markdown(),
  md: () => markdown(),
  sql: () => sql(),
  rust: () => rust(),
  rs: () => rust(),
  cpp: () => cpp(),
  "c++": () => cpp(),
  c: () => cpp(),
  java: () => java(),
  go: () => go(),
  golang: () => go(),
  php: () => php(),
  hcl: () => hcl(),
  tf: () => hcl(),
  terraform: () => hcl(),
  bash: () => StreamLanguage.define(shell),
  sh: () => StreamLanguage.define(shell),
  shell: () => StreamLanguage.define(shell),
  zsh: () => StreamLanguage.define(shell),
};

export function getLangExtension(lang) {
  if (!lang) return javascript();
  const factory = langMap[lang.toLowerCase().trim()];
  return factory ? factory() : javascript();
}

export { githubDarkStyle, githubLightStyle };

export const languageMap = Object.fromEntries(Object.keys(langMap).map((k) => [k, k]));
