/**
 * Composable markdown preprocessing pipeline.
 *
 * Extracts and unifies the preprocessing steps previously inlined in TextContent.jsx:
 *   1. preprocessCurrencyDollars — escape currency $ before math parsing
 *   2. preprocessCitations — resolve index/link citations to data-urls, strip incomplete tags
 *   3. preprocessChartTags — hide incomplete chart tags during streaming
 *
 * Each preprocessor has the signature:
 *   (content: string, context: object) => string | { content: string, ...metadata }
 *
 * If a preprocessor returns a plain string, only content is updated.
 * If it returns an object, all keys are merged into the pipeline context.
 */

// ---------------------------------------------------------------------------
// Citation helpers (private)
// ---------------------------------------------------------------------------

/**
 * Resolve an index-based citation (X:Y) to a URL.
 */
function resolveIndexCitation(searchIndex, resultIndex, webSearchResults) {
  if (!webSearchResults || !Array.isArray(webSearchResults)) return null;
  const sIdx = searchIndex - 1;
  const rIdx = resultIndex - 1;
  if (sIdx < 0 || sIdx >= webSearchResults.length) return null;
  const searchResultUrls = webSearchResults[sIdx];
  if (!searchResultUrls || rIdx < 0 || rIdx >= searchResultUrls.length) return null;
  return searchResultUrls[rIdx];
}

/**
 * Parse multiple citation references and resolve them to URLs.
 */
function parseMultipleCitations(citationContent, webSearchResults) {
  const urls = [];
  const citationPattern = /(\d+):(\d+)/g;
  let match;
  while ((match = citationPattern.exec(citationContent)) !== null) {
    const searchIdx = parseInt(match[1], 10);
    const resultIdx = parseInt(match[2], 10);
    const url = resolveIndexCitation(searchIdx, resultIdx, webSearchResults);
    if (url && !urls.includes(url)) {
      urls.push(url);
    }
  }
  return urls;
}

/**
 * Check if citation content contains index-based references (X:Y pattern).
 */
function isIndexBasedCitation(content) {
  return /^\d+:\d+(?:,\d+:\d+)*$/.test(content.trim());
}

// ---------------------------------------------------------------------------
// Preprocessors
// ---------------------------------------------------------------------------

/**
 * Escape currency dollar signs before math parsing.
 * Converts $XXX patterns (currency) to escaped form to prevent LaTeX interpretation.
 *
 * @param {string} content
 * @param {object} _context - unused
 * @returns {string}
 */
export function preprocessCurrencyDollars(content, _context) {
  if (!content) return content;
  return content.replace(/\$(\d)/g, "&#36;$1");
}

/**
 * Resolve index-based and direct-link citations to data-urls format,
 * and strip incomplete citation tags during streaming.
 *
 * @param {string} content
 * @param {object} context - must include `webSearchResults`
 * @returns {string}
 */
export function preprocessCitations(content, context) {
  if (!content) return content;
  const webSearchResults = (context && context.webSearchResults) || [];

  let processed = content;

  // Convert direct links format <cite links=["url1","url2"]> to data-urls format
  processed = processed.replace(
    /<cite\s+links=\[((?:"[^"]*"|'[^']*'|,|\s)*)\]\s*>(?:<\/cite>)?/gi,
    (match, linksContent) => {
      const urlMatches = linksContent.match(/["']([^"']+)["']/g);
      if (!urlMatches) return "";
      const urls = urlMatches.map((u) => u.replace(/^["']|["']$/g, "")).filter(Boolean);
      if (urls.length > 0) {
        const encoded = urls.map((u) => u.replace(/"/g, "&quot;"));
        return `<cite data-urls="${encoded.join(",")}"></cite>`;
      }
      return "";
    }
  );

  // Convert index-based citations <cite urls=[X:Y,X:Y]> to resolved URLs
  processed = processed.replace(
    /<cite\s+urls=\[([^\]]*)\]\s*>(?:<\/cite>)?/gi,
    (match, urlsContent) => {
      if (isIndexBasedCitation(urlsContent)) {
        const urls = parseMultipleCitations(urlsContent, webSearchResults);
        if (urls.length > 0) {
          const encoded = urls.map((u) => u.replace(/"/g, "&quot;"));
          return `<cite data-urls="${encoded.join(",")}"></cite>`;
        }
        return "";
      } else {
        const urls = urlsContent
          .split(",")
          .map((u) => u.trim())
          .filter(Boolean);
        if (urls.length > 0) {
          const encoded = urls.map((u) => u.replace(/"/g, "&quot;"));
          return `<cite data-urls="${encoded.join(",")}"></cite>`;
        }
        return "";
      }
    }
  );

  // Hide incomplete citation patterns during streaming
  processed = processed.replace(
    /<cite(?:\s+(?:u(?:r(?:l(?:s)?)?)?|l(?:i(?:n(?:k(?:s)?)?)?)?)?)?(?:\s*=)?(?:\s*\[)?[^\]>]*$/gi,
    ""
  );
  processed = processed.replace(/<$/g, "");
  processed = processed.replace(/<cite\s+(?:urls|links)=\[[^\]]*(?:$|(?=[^>\]]))/gi, "");

  return processed;
}

/**
 * Hide incomplete chart tags during streaming.
 * Complete tags pass through unchanged for rendering by ChartTagRenderer.
 *
 * @param {string} content
 * @param {object} context - must include `isStreaming`
 * @returns {{ content: string, hasIncompleteChart: boolean }}
 */
export function preprocessChartTags(content, context) {
  if (!content) return { content, hasIncompleteChart: false };
  const isStreaming = context && context.isStreaming;
  if (!isStreaming) return { content, hasIncompleteChart: false };

  let processed = content;
  let hasIncompleteChart = false;

  // Find the last occurrence of <chart in the content
  const lastChartIndex = processed.toLowerCase().lastIndexOf("<chart");
  if (lastChartIndex !== -1) {
    const fromLastChart = processed.slice(lastChartIndex);
    const hasClosingTag = fromLastChart.toLowerCase().includes("</chart>");
    if (!hasClosingTag) {
      hasIncompleteChart = true;
      processed = processed.slice(0, lastChartIndex);
    }
  }

  // Catch partial <chart at the very end
  const partialTagMatch = processed.match(
    /<c(?:h(?:a(?:r(?:t(?:\s+(?:d(?:a(?:t(?:a(?:-(?:c(?:o(?:n(?:f(?:i(?:g(?:\s*=?\s*['"]?[^'"]*)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?)?$/i
  );
  if (partialTagMatch) {
    hasIncompleteChart = true;
    processed = processed.slice(0, processed.length - partialTagMatch[0].length);
  }

  // Check for incomplete closing tag at the end
  const partialClosingMatch = processed.match(/<\/(?:c(?:h(?:a(?:r(?:t)?)?)?)?)?$/i);
  if (partialClosingMatch) {
    hasIncompleteChart = true;
    processed = processed.slice(0, processed.length - partialClosingMatch[0].length);
  }

  return { content: processed, hasIncompleteChart };
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

/**
 * Create a preprocessing pipeline from an ordered array of preprocessor functions.
 *
 * Each step receives `(content, context)` and may return:
 *   - a string (only content is updated), or
 *   - an object `{ content, ...metadata }` (all keys merged into context).
 *
 * @param {Array<Function>} steps
 * @returns {Function} (content, context) => { content, ...metadata }
 */
export function createPipeline(steps) {
  return (content, context) => {
    let current = content;
    let ctx = { ...context };

    for (const step of steps) {
      const result = step(current, ctx);
      if (result !== null && typeof result === "object" && !Array.isArray(result)) {
        const { content: next, ...meta } = result;
        current = next;
        ctx = { ...ctx, ...meta };
      } else {
        current = result;
      }
    }

    return { ...ctx, content: current };
  };
}

/**
 * Default pipeline: currency → citations → chartTags.
 *
 * @param {string} content - Raw markdown content
 * @param {{ isStreaming: boolean, webSearchResults: Array<Array<string>> }} options
 * @returns {{ content: string, hasIncompleteChart: boolean }}
 */
export function preprocessMarkdown(content, { isStreaming = false, webSearchResults = [] } = {}) {
  return createPipeline([preprocessCurrencyDollars, preprocessCitations, preprocessChartTags])(
    content,
    { isStreaming, webSearchResults }
  );
}
