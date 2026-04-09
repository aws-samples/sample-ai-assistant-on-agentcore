import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Download, Maximize2 } from "lucide-react";
import { useTheme } from "../ThemeContext";
import { escapeCSVCell, downloadCSV } from "./MarkdownTable";
import TableContent from "./utils/TableContent";

const MAX_TABLE_HEIGHT = 400;

/**
 * Format a cell value for display.
 * Shows "NaN" for null/undefined/NaN/empty-string values.
 */
function formatCell(v) {
  if (v == null) return "NaN";
  if (v === "") return "";
  const s = String(v);
  if (s === "nan" || s === "NaN" || s === "None" || s === "null") return "NaN";
  return s;
}

/**
 * Parse an HTML table string (from pandas .to_html()) into {headers, rows}.
 */
function parseHtmlTable(html) {
  if (!html) return { headers: [], rows: [] };
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const table = doc.querySelector("table");
    if (!table) return { headers: [], rows: [] };
    const headers = [];
    table.querySelectorAll("thead th").forEach((th) => headers.push(th.textContent?.trim() || ""));
    const rows = [];
    table.querySelectorAll("tbody tr").forEach((tr) => {
      const row = [];
      tr.querySelectorAll("th, td").forEach((cell) => row.push(cell.textContent?.trim() || ""));
      rows.push(row);
    });
    if (headers.length === 0 && rows.length > 0) {
      const firstRow = table.querySelector("tr");
      if (firstRow)
        firstRow
          .querySelectorAll("th, td")
          .forEach((cell) => headers.push(cell.textContent?.trim() || ""));
    }
    return { headers, rows };
  } catch {
    return { headers: [], rows: [] };
  }
}

/**
 * Renders a DataFrame table with max-height scrolling, CSV export, expand modal,
 * and NaN display for null values.
 */
const DataFrameTable = React.memo(({ html, data, name }) => {
  const { effectiveTheme, isDark } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const { headers, rows, totalRows, truncated, tableName } = useMemo(() => {
    if (data) {
      return {
        headers: data.columns || [],
        rows: (data.rows || []).map((r) => r.map((v) => v)),
        totalRows: data.total_rows || (data.rows || []).length,
        truncated: data.truncated || false,
        tableName: name || data.name || null,
      };
    }
    const parsed = parseHtmlTable(html);
    return {
      headers: parsed.headers,
      rows: parsed.rows,
      totalRows: parsed.rows.length,
      truncated: false,
      tableName: name || null,
    };
  }, [html, data, name]);

  if (headers.length === 0 && rows.length === 0) return null;

  // For CSV export, format cells as strings
  const csvRows = useMemo(() => rows.map((r) => r.map((v) => formatCell(v))), [rows]);

  const rowLabel = truncated
    ? `Showing ${rows.length} of ${totalRows} rows`
    : `${totalRows} row${totalRows !== 1 ? "s" : ""} · ${headers.length} col${headers.length !== 1 ? "s" : ""}`;

  return (
    <div className={`my-4 ${effectiveTheme}`}>
      <div
        style={{
          borderRadius: "10px",
          overflow: "hidden",
          border: "1px solid var(--color-border)",
        }}
      >
        <div
          className="flex items-center justify-between px-3 py-1.5"
          style={{
            backgroundColor: isDark ? "hsl(0 0% 8%)" : "hsl(0 0% 83.1%)",
          }}
        >
          <span className="text-xs text-muted-foreground font-medium">
            {tableName ? `${tableName} · ` : ""}
            {rowLabel}
          </span>
          <div className="flex items-center gap-0.5">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setExpanded(true)}
                    aria-label="Expand table"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Expand
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => downloadCSV(headers, csvRows)}
                    aria-label="Download CSV"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-xs">
                  Download CSV
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        <TableContent
          headers={headers}
          rows={rows}
          maxHeight={MAX_TABLE_HEIGHT}
          standalone={false}
          isDark={isDark}
          formatCell={formatCell}
        />
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>{tableName || "DataFrame"}</DialogTitle>
            <DialogDescription>{rowLabel}</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <TableContent
              headers={headers}
              rows={rows}
              maxHeight="calc(90vh - 160px)"
              isDark={isDark}
              formatCell={formatCell}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => downloadCSV(headers, csvRows)}>
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
});

export default DataFrameTable;
