import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export function SortableHeader({ column, children }) {
  const sorted = column.getIsSorted();
  const icons = {
    asc: <ArrowUp className="ml-1 h-3 w-3" strokeWidth={1.5} />,
    desc: <ArrowDown className="ml-1 h-3 w-3" strokeWidth={1.5} />,
  };
  return (
    <Button
      variant="ghost"
      size="sm"
      className="ml-0 h-8"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {children}
      {icons[sorted] || <ArrowUpDown className="ml-1 h-3 w-3 opacity-50" />}
    </Button>
  );
}

export function DataTable({
  columns,
  data,
  onRowClick,
  hoverRows = true,
  emptyMessage = "No results.",
}) {
  const [sorting, setSorting] = useState([]);

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    onSortingChange: setSorting,
    state: { sorting },
  });

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow
                key={row.id}
                className={`${onRowClick ? "cursor-pointer" : ""} ${!hoverRows ? "hover:bg-transparent" : ""}`}
                onClick={() => onRowClick?.(row.original)}
              >
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
