import { useState, useEffect, useRef, useCallback } from "react";
import { MessageSquare, AlertCircle } from "lucide-react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";

/**
 * Truncates content to a maximum length with ellipsis.
 *
 * @param {string} content - The content to truncate
 * @param {number} maxLength - Maximum length (default 100)
 * @returns {string} Truncated content with ellipsis if needed
 */
export const truncateContent = (content, maxLength = 100) => {
  if (!content || content.length <= maxLength) {
    return content || "";
  }
  return content.slice(0, maxLength) + "...";
};

/**
 * ChatSearchCommand - Command palette for searching chat conversations.
 *
 *
 * @param {Object} props
 * @param {boolean} props.open - Whether the command palette is open
 * @param {Function} props.onOpenChange - Callback when open state changes
 * @param {Function} props.onResultSelect - Callback when a result is selected (session_id, message_index)
 * @param {Function} props.searchFn - Search function that takes a query and returns results
 */
export function ChatSearchCommand({ open, onOpenChange, onResultSelect, searchFn }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Ref to track the current request for cancellation
  const abortControllerRef = useRef(null);
  // Ref to track the debounce timer
  const debounceTimerRef = useRef(null);

  /**
   * Perform the search API call.
   */
  const performSearch = useCallback(
    async (searchQuery) => {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      // Create new abort controller for this request
      abortControllerRef.current = new AbortController();

      setLoading(true);
      setError(null);

      try {
        const searchResults = await searchFn(searchQuery, abortControllerRef.current.signal);
        setResults(searchResults?.results || []);
        setLoading(false);
      } catch (err) {
        // Don't show error for aborted requests
        if (err.name === "AbortError") {
          // Don't clear loading — the next search will set it
          return;
        }
        console.error("Search failed:", err);
        setError("Search failed. Please try again.");
        setResults([]);
        setLoading(false);
      }
    },
    [searchFn]
  );

  /**
   * Debounced search effect.
   */
  useEffect(() => {
    // Clear any existing timer
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // If query is empty or whitespace, clear results immediately
    if (!query.trim()) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Set up debounce timer (300ms)
    debounceTimerRef.current = setTimeout(() => {
      performSearch(query.trim());
    }, 300);

    // Cleanup on unmount or query change
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [query, performSearch]);

  /**
   * Reset state when dialog closes.
   */
  useEffect(() => {
    if (!open) {
      // Cancel any pending request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      // Clear debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      // Reset state
      setQuery("");
      setResults([]);
      setError(null);
      setLoading(false);
    }
  }, [open]);

  /**
   * Handle result selection.
   */
  const handleResultSelect = (result) => {
    if (onResultSelect) {
      onResultSelect(result.session_id, result.message_index);
    }
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} shouldFilter={false}>
      <CommandInput placeholder="Search your chats..." value={query} onValueChange={setQuery} />
      <CommandList>
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Spinner size="sm" className="mr-2" />
            <span className="text-sm text-muted-foreground">Searching...</span>
          </div>
        )}

        {error && !loading && (
          <div className="flex items-center justify-center py-6 text-destructive">
            <AlertCircle className="h-4 w-4 mr-2" />
            <span className="text-sm">{error}</span>
          </div>
        )}

        {!loading && !error && query.trim() && results.length === 0 && (
          <CommandEmpty>No results found for "{query}"</CommandEmpty>
        )}

        {!loading && !error && results.length > 0 && (
          <CommandGroup heading="Search Results">
            {results.map((result, index) => (
              <CommandItem
                key={`${result.session_id}-${result.message_index}-${index}`}
                value={`${result.title} ${result.content}`}
                onSelect={() => handleResultSelect(result)}
                className="flex flex-col items-start gap-1 cursor-pointer"
              >
                <div className="flex items-center gap-2 w-full">
                  <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="font-medium truncate flex-1">
                    {result.title || "Untitled Chat"}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    Message #{result.message_index + 1}
                  </span>
                </div>
                <p className="text-sm text-muted-foreground pl-6 line-clamp-2">
                  {truncateContent(result.content)}
                </p>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {/* Initial state - no query yet */}
        {!loading && !error && !query.trim() && (
          <div className="py-6 text-center text-sm text-muted-foreground">
            Type to search your chat history
          </div>
        )}
      </CommandList>
    </CommandDialog>
  );
}

export default ChatSearchCommand;
