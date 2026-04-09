import { getFaviconUrl } from "./urlUtils";

/**
 * Parse raw tool content into an array of web result source objects.
 *
 * Handles all supported input shapes:
 *   - Top-level array of result objects or URL strings
 *   - `{ results: [...] }` wrapper
 *   - Single `{ url }` object
 *   - `{ urls: [...] }` array of URL strings
 *
 * Returns [] for null/invalid input without throwing.
 *
 * @param {string|object|null} content - Raw tool result content
 * @returns {Array<{ url: string, title: string, content?: string, favicon?: string }>}
 */
export function parseWebResults(content) {
  if (!content) return [];
  try {
    const parsed = typeof content === "string" ? JSON.parse(content) : content;

    const extractResult = (item) => {
      if (typeof item === "string") {
        return { url: item, title: "", content: "", favicon: getFaviconUrl(item) };
      }
      const url = item.url || item.link || "";
      return {
        url,
        title: item.title || item.name || "",
        content: item.content || item.snippet || item.description || item.text || "",
        favicon: getFaviconUrl(url),
      };
    };

    if (Array.isArray(parsed)) {
      return parsed.map(extractResult).filter((r) => r.url);
    }
    if (parsed.results && Array.isArray(parsed.results)) {
      return parsed.results.map(extractResult).filter((r) => r.url);
    }
    if (parsed.url) {
      return [extractResult(parsed)];
    }
    if (parsed.urls && Array.isArray(parsed.urls)) {
      return parsed.urls
        .map((url) => ({ url, title: "", content: "", favicon: getFaviconUrl(url) }))
        .filter((r) => r.url);
    }
    return [];
  } catch {
    return [];
  }
}
