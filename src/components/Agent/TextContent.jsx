import React, { useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";

// Allow our custom elements and data attributes through the sanitizer.
// hast-util-sanitize uses camelCase hast property names (e.g. dataUrls for data-urls).
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames || []),
    "cite",
    "chart",
    "math",
    "semantics",
    "annotation",
    "mrow",
    "mi",
    "mo",
    "mn",
    "msup",
    "msub",
    "mfrac",
    "msqrt",
    "mtext",
    "mspace",
    "mover",
    "munder",
    "mtable",
    "mtr",
    "mtd",
  ],
  attributes: {
    ...defaultSchema.attributes,
    cite: ["dataUrls", "dataDoc", "dataPages", "dataText"],
    chart: ["dataConfig"],
    "*": [...(defaultSchema.attributes?.["*"] || []), "className"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
  },
};
import "katex/dist/katex.min.css";
import { CodeRenderer, LinkRenderer } from "./MarkdownRenderers";
import { MarkdownTable } from "./MarkdownTable";
import { FileText, Globe, ExternalLink } from "lucide-react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Label } from "@/components/ui/label";
import ChartTagRenderer from "./ChartTagRenderer";
import ChartPlaceholder from "./ChartPlaceholder";
import { extractDomain } from "./utils/urlUtils";
import { preprocessMarkdown } from "./utils/preprocessMarkdown";

/**
 * Truncate text to a max length with ellipsis
 */
const truncateText = (text, maxLength = 10) => {
  if (!text || text.length <= maxLength) return text;
  return text.slice(0, maxLength).trim() + "…";
};

/**
 * Format page string from backend (pp.X-Y or p.X) to readable format
 */
const formatPages = (pages) => {
  if (!pages) return "";
  // Convert "pp.7-8" to "Pages 7-8" and "p.7" to "Page 7"
  return pages.replace(/^pp\./, "Pages ").replace(/^p\./, "Page ");
};

/**
 * Web Search Citation component for URLs
 * Format: <cite data-urls="url1,url2,urln"></cite>
 */
const WebSearchCitation = ({ urls }) => {
  if (!urls || urls.length === 0) return null;

  const firstDomain = extractDomain(urls[0]);
  const truncatedDomain = truncateText(firstDomain, 8);
  const extraCount = urls.length - 1;

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Label className="citation-label web-citation-label">
          <Globe size={12} className="citation-label-icon" />
          <span className="citation-label-text">
            {truncatedDomain}
            {extraCount > 0 && <span className="citation-extra-count">+{extraCount}</span>}
          </span>
        </Label>
      </HoverCardTrigger>
      <HoverCardContent className="citation-hover-card web-citation-hover" side="top" align="start">
        <div className="citation-hover-content">
          <div className="web-citation-header">Sources · {urls.length}</div>
          <div className="web-citation-list">
            {urls.map((url, index) => {
              const domain = extractDomain(url);
              return (
                <a
                  key={index}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="web-citation-item"
                >
                  <Globe size={14} className="web-citation-item-icon" />
                  <span className="web-citation-item-title" title={url}>
                    {truncateText(domain, 25)}
                  </span>
                  <span className="web-citation-item-domain">{domain}</span>
                  <ExternalLink size={12} className="web-citation-external-icon" />
                </a>
              );
            })}
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

/**
 * Document Citation component for document references
 * Format: <cite data-doc="..." data-pages="..." data-text="...">...</cite>
 */
const DocumentCitation = ({ doc, pages, sourceText }) => {
  const previewText = truncateText(sourceText || doc, 10);

  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Label className="citation-label">
          <FileText size={12} className="citation-label-icon" />
          <span className="citation-label-text">{previewText}</span>
        </Label>
      </HoverCardTrigger>
      <HoverCardContent className="citation-hover-card" side="top" align="start">
        <div className="citation-hover-content">
          <div className="citation-hover-header">
            <FileText size={14} className="citation-hover-icon" />
            <span className="citation-hover-doc">{doc}</span>
          </div>
          {pages && <div className="citation-hover-page">{pages}</div>}
          {sourceText && <blockquote className="citation-hover-quote">"{sourceText}"</blockquote>}
        </div>
      </HoverCardContent>
    </HoverCard>
  );
};

/**
 * Citation component rendered inline via markdown
 * Handles two formats:
 * 1. Web search: <cite data-urls="url1,url2,urln"></cite>
 * 2. Document: <cite data-doc="..." data-pages="..." data-text="...">...</cite>
 */
const CitationRenderer = ({ node, children, ...props }) => {
  // Check if this is a web search citation (has data-urls attribute)
  const urlsAttr = props["data-urls"];
  if (urlsAttr) {
    // Split by comma to get individual URLs
    const urls = urlsAttr
      .split(",")
      .map((url) => url.trim())
      .filter(Boolean);
    return <WebSearchCitation urls={urls} />;
  }

  // Otherwise, treat as document citation
  const doc = props["data-doc"] || "Document";
  const pages = formatPages(props["data-pages"] || "");
  const sourceText = props["data-text"] || "";

  return <DocumentCitation doc={doc} pages={pages} sourceText={sourceText} />;
};

const TextContent = ({ content, compact = false, webSearchResults = [], isStreaming = false }) => {
  // Memoize the preprocessing pipeline to avoid redundant regex passes on re-renders
  const { content: finalContent, hasIncompleteChart } = useMemo(() => {
    return preprocessMarkdown(content, { isStreaming, webSearchResults });
  }, [content, webSearchResults, isStreaming]);

  return (
    <div style={{ lineHeight: 1.5 }} className={compact ? "compact-text" : undefined}>
      <Markdown
        children={finalContent}
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema], rehypeKatex]}
        components={{
          code: CodeRenderer,
          table: MarkdownTable,
          cite: CitationRenderer,
          chart: ChartTagRenderer,
          a: LinkRenderer,
        }}
      />
      {hasIncompleteChart && <ChartPlaceholder />}
    </div>
  );
};

export default TextContent;
