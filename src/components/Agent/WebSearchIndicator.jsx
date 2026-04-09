import React, { useState } from "react";
import { ExternalLink } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { extractDomain, getFaviconUrl } from "./utils/urlUtils";
import "./WebSearchIndicator.css";

/**
 * Get unique domain sources - filters sources to unique domains
 * Returns the first source encountered for each domain
 * @param {Array} sources - Array of source objects with url property
 * @returns {Array} - Array of sources with unique domains
 */
const getUniqueDomainSources = (sources) => {
  const seenDomains = new Set();
  const uniqueSources = [];

  for (const source of sources) {
    const domain = extractDomain(source.url);
    if (!seenDomains.has(domain)) {
      seenDomains.add(domain);
      uniqueSources.push(source);
    }
  }

  return uniqueSources;
};

/**
 * SourcesButton - Button showing stacked favicons and source count
 * Opens sheet with full source list when clicked
 * @param {Array} sources - Array of source objects with url, title, content
 */
export const SourcesButton = ({ sources = [] }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!sources || sources.length === 0) return null;

  // Handle both old format (array of URLs) and new format (array of objects)
  const normalizedSources = sources.map((s) =>
    typeof s === "string" ? { url: s, title: "", content: "" } : s
  );

  // Get unique domain sources for favicon display
  const uniqueDomainSources = getUniqueDomainSources(normalizedSources);
  const displaySources = uniqueDomainSources.slice(0, 5); // Show max 5 unique domain icons

  return (
    <>
      <button
        className="sources-button"
        onClick={() => setIsOpen(true)}
        aria-label={`View ${normalizedSources.length} sources`}
      >
        <div className="sources-favicons">
          {displaySources.map((source, index) => (
            <img
              key={index}
              src={getFaviconUrl(source.url)}
              alt=""
              className="source-favicon"
              style={{
                zIndex: displaySources.length - index,
                marginLeft: index > 0 ? "-8px" : "0",
              }}
              onError={(e) => {
                e.target.style.display = "none";
              }}
            />
          ))}
        </div>
        <span className="sources-count">{normalizedSources.length} sources</span>
      </button>

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="right" className="sources-sheet">
          <SheetHeader>
            <SheetTitle>Sources ({normalizedSources.length})</SheetTitle>
          </SheetHeader>
          <div className="sources-list">
            {normalizedSources.map((source, index) => {
              const domain = extractDomain(source.url);
              return (
                <a
                  key={index}
                  href={/^https?:\/\//i.test(source.url) ? source.url : "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="source-item"
                  style={{ animationDelay: `${index * 50}ms` }}
                >
                  <img
                    src={getFaviconUrl(source.url)}
                    alt=""
                    className="source-item-favicon"
                    onError={(e) => {
                      e.target.style.display = "none";
                    }}
                  />
                  <div className="source-item-info">
                    <span className="source-item-title">{source.title || domain}</span>
                    <span className="source-item-domain">{domain}</span>
                    {source.content && (
                      <p className="source-item-content">
                        {source.content.length > 200
                          ? source.content.slice(0, 200) + "..."
                          : source.content}
                      </p>
                    )}
                  </div>
                  <ExternalLink size={14} className="source-item-external" />
                </a>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
};
