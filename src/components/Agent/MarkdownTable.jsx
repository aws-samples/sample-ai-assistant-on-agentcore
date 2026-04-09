import React, { useState } from "react";
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
import TableContent from "./utils/TableContent";

const MAX_TABLE_HEIGHT = 400;

/**
 * Recursively extracts plain text from a HAST node and its children.
 */
export function getTextContent(node) {
  if (!node) return "";
  if (node.type === "text") return node.value || "";
  if (node.children) return node.children.map(getTextContent).join("");
  return "";
}

/**
 * Traverses a HAST table node to extract structured header and row data.
 */
export function extractTableData(node) {
  const empty = { headers: [], rows: [] };
  if (!node || node.type !== "element" || !node.children) return empty;

  let headers = [];
  let rows = [];

  for (const child of node.children) {
    if (child.type !== "element") continue;

    if (child.tagName === "thead") {
      const tr = child.children?.find((c) => c.type === "element" && c.tagName === "tr");
      if (tr?.children) {
        headers = tr.children
          .filter((c) => c.type === "element" && c.tagName === "th")
          .map(getTextContent);
      }
    }

    if (child.tagName === "tbody") {
      rows = (child.children || [])
        .filter((c) => c.type === "element" && c.tagName === "tr")
        .map((tr) =>
          (tr.children || [])
            .filter((c) => c.type === "element" && c.tagName === "td")
            .map(getTextContent)
        );
    }
  }

  return { headers, rows };
}

/**
 * Escapes a CSV cell value per RFC 4180.
 */
export function escapeCSVCell(value) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds a CSV string from headers and rows, then triggers a browser download.
 */
export function downloadCSV(headers, rows) {
  const headerLine = headers.map(escapeCSVCell).join(",");
  const rowLines = rows.map((row) => row.map(escapeCSVCell).join(","));
  const csv = [headerLine, ...rowLines].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "table-export.csv";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Markdown table renderer with sticky headers, max-height scrolling,
 * CSV export, and expand modal — matching DataFrameTable behavior.
 */
export const MarkdownTable = ({ node, ...props }) => {
  const { effectiveTheme, isDark } = useTheme();
  const { headers, rows } = extractTableData(node);
  const [expanded, setExpanded] = useState(false);

  if (headers.length === 0 && rows.length === 0) return null;

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
            {rows.length} row{rows.length !== 1 ? "s" : ""} · {headers.length} col
            {headers.length !== 1 ? "s" : ""}
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
                    onClick={() => downloadCSV(headers, rows)}
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
        />
      </div>

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-[90vw] max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Table</DialogTitle>
            <DialogDescription>
              {rows.length} row{rows.length !== 1 ? "s" : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0">
            <TableContent
              headers={headers}
              rows={rows}
              maxHeight="calc(90vh - 160px)"
              isDark={isDark}
            />
          </div>
          <div className="flex justify-end pt-2">
            <Button variant="outline" size="sm" onClick={() => downloadCSV(headers, rows)}>
              <Download className="h-4 w-4 mr-2" />
              Download CSV
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
