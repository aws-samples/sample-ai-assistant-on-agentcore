import React from "react";

const MAX_COL_WIDTH = 300;

/**
 * Shared inner table renderer used by both MarkdownTable and DataFrameTable.
 * Renders a scrollable table with sticky headers, zebra striping, and optional border.
 *
 * @param {Object} props
 * @param {string[]} props.headers - Column headers
 * @param {string[][]} props.rows - Row data (each row is an array of cell strings)
 * @param {number|string} [props.maxHeight] - Max height for scroll container
 * @param {boolean} [props.standalone=true] - Whether to render with outer border/radius
 * @param {boolean} [props.isDark=false] - Dark theme flag
 * @param {Function} [props.formatCell] - Optional cell formatter (receives raw value, returns display string)
 */
function TableContent({ headers, rows, maxHeight, standalone = true, isDark = false, formatCell }) {
  const cellStyle = {
    maxWidth: MAX_COL_WIDTH,
    overflow: "hidden",
    textOverflow: "ellipsis",
    wordBreak: "break-word",
    whiteSpace: "normal",
  };

  return (
    <div
      className="overflow-auto"
      style={{
        ...(maxHeight ? { maxHeight } : {}),
        padding: 0,
        margin: 0,
        ...(standalone ? { borderRadius: "8px", border: "1px solid var(--color-border)" } : {}),
      }}
    >
      <table
        className="min-w-full text-sm"
        style={{ borderCollapse: "separate", borderSpacing: 0, margin: 0 }}
      >
        {headers.length > 0 && (
          <thead>
            <tr>
              {headers.map((header, i) => (
                <th
                  key={i}
                  className="px-3 py-2 text-left align-middle font-semibold text-xs"
                  style={{
                    ...cellStyle,
                    whiteSpace: "nowrap",
                    minWidth: 120,
                    position: "sticky",
                    top: 0,
                    zIndex: 2,
                    backgroundColor: isDark ? "hsl(0 0% 8%)" : "hsl(0 0% 83.1%)",
                    color: "var(--color-foreground)",
                    borderBottom: "1px solid var(--color-border)",
                    ...(i < headers.length - 1
                      ? { borderRight: "1px solid var(--color-border)" }
                      : {}),
                  }}
                  title={header}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, rowIdx) => (
            <tr
              key={rowIdx}
              className="transition-colors hover:bg-muted/50"
              style={{
                ...(rowIdx < rows.length - 1
                  ? { borderBottom: "1px solid var(--color-border)" }
                  : {}),
                backgroundColor:
                  rowIdx % 2 === 1
                    ? isDark
                      ? "hsl(0 0% 15%)"
                      : "hsl(0 0% 89.8%)"
                    : isDark
                      ? "hsl(0 0% 10%)"
                      : "hsl(0 0% 96.1%)",
              }}
            >
              {row.map((cell, cellIdx) => {
                const display = formatCell ? formatCell(cell) : cell;
                return (
                  <td
                    key={cellIdx}
                    className="px-3 py-2 align-middle"
                    style={{
                      ...cellStyle,
                      ...(cellIdx < row.length - 1
                        ? { borderRight: "1px solid var(--color-border)" }
                        : {}),
                    }}
                    title={display}
                  >
                    {display}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default TableContent;
