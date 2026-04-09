/**
 * Shared URL utility functions.
 * Used by TextContent, WebSearchIndicator, and UnifiedThinkingBlock.
 */

/**
 * Extract domain name from URL, stripping 'www.' prefix.
 * @param {string} url
 * @returns {string} Domain name or original string on failure
 */
export const extractDomain = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
};

/**
 * Get a Google favicon URL for a given page URL.
 * @param {string} url
 * @returns {string|null} Favicon URL or null on failure
 */
export const getFaviconUrl = (url) => {
  if (!url) return null;
  try {
    const domain = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
  } catch {
    return null;
  }
};
