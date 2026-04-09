import React from "react";
import { CodeBlock } from "./CodeBlock";
import "./styles.css";
import { useTheme } from "../ThemeContext";

export const LinkRenderer = ({ href, children }) => {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="markdown-link">
      {children}
    </a>
  );
};

export const CodeRenderer = ({ children, className = "", node }) => {
  const match = /language-(\w+)/.exec(className);
  const codeString = String(children).replace(/\n$/, "");
  const language = match ? match[1] : null;

  // Check if this is inline code (no language class and single line without newlines)
  const isInline =
    !match &&
    !codeString.includes("\n") &&
    node?.position?.start?.line === node?.position?.end?.line;

  if (isInline) {
    return <InlineCode code={codeString} />;
  }

  return language ? (
    <CodeBlock code={codeString} language={language} />
  ) : (
    <CodeBlock code={codeString} language="default" />
  );
};

export const InlineCode = ({ code }) => {
  const { effectiveTheme } = useTheme();

  return <code className={`inline-code ${effectiveTheme}`}>{code}</code>;
};

export { MarkdownTable } from "./MarkdownTable";
