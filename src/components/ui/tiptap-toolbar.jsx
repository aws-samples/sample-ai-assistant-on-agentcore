import React, { useEffect, useReducer } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Code2,
  Quote,
  Minus,
  Table,
  ChevronDown,
} from "lucide-react";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

function ToolbarToggle({ pressed, onClick, label, children, disabled }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={disabled ? undefined : onClick}
          disabled={disabled}
          aria-disabled={disabled}
          className={`inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium h-8 px-1.5 min-w-8 transition-colors hover:bg-muted hover:text-muted-foreground disabled:opacity-40 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 ${pressed && !disabled ? "bg-accent text-accent-foreground" : ""}`}
          aria-label={label}
          aria-pressed={pressed}
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

const CODE_LANGUAGES = [
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "cpp", label: "C++" },
  { value: "ruby", label: "Ruby" },
  { value: "bash", label: "Bash" },
  { value: "sql", label: "SQL" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "markdown", label: "Markdown" },
  { value: "hcl", label: "HCL / Terraform" },
];

function CodeBlockDropdown({ editor, disabled }) {
  const [openState, setOpenState] = React.useState({
    open: false,
    isInCodeBlock: false,
    currentLang: "",
    selectedText: "",
  });

  const handleOpenChange = (open) => {
    if (open) {
      const isIn = editor.isActive("codeBlock");
      const lang = isIn ? editor.getAttributes("codeBlock").language || "" : "";
      const { from, to } = editor.state.selection;
      const text = from !== to ? editor.state.doc.textBetween(from, to, "\n") : "";
      setOpenState({ open: true, isInCodeBlock: isIn, currentLang: lang, selectedText: text });
    } else {
      setOpenState((prev) => ({ ...prev, open: false }));
    }
  };

  const { isInCodeBlock, currentLang, selectedText } = openState;

  const handleSelectLanguage = (lang) => {
    if (isInCodeBlock) {
      editor.chain().focus().updateAttributes("codeBlock", { language: lang }).run();
    } else {
      // Use setCodeBlock to wrap the current selection, preserving multi-line content
      editor.chain().focus().setCodeBlock({ language: lang }).run();
    }
  };

  return (
    <DropdownMenu modal={false} open={openState.open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-md text-sm font-medium h-8 px-1.5 min-w-8 transition-colors hover:bg-muted hover:text-muted-foreground disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Code block"
              disabled={disabled}
            >
              <Code2 className="h-4 w-4" strokeWidth={2.5} />
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Insert code block
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" className="max-h-64 overflow-y-auto">
        {isInCodeBlock && (
          <DropdownMenuItem
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            className="text-xs text-destructive"
          >
            Remove code block
          </DropdownMenuItem>
        )}
        {CODE_LANGUAGES.map(({ value, label }) => (
          <DropdownMenuItem
            key={value}
            onClick={() => handleSelectLanguage(value)}
            className={`text-xs ${currentLang === value ? "font-semibold" : ""}`}
          >
            {isInCodeBlock && currentLang === value ? `✓ ${label}` : label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TableDropdown({ editor, disabled }) {
  const [openState, setOpenState] = React.useState({ open: false, isInTable: false });

  const handleOpenChange = (open) => {
    if (open) {
      setOpenState({ open: true, isInTable: editor.isActive("table") });
    } else {
      setOpenState((prev) => ({ ...prev, open: false }));
    }
  };

  const { isInTable } = openState;

  return (
    <DropdownMenu modal={false} open={openState.open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center justify-center gap-1 rounded-md text-sm font-medium h-8 px-1.5 min-w-8 transition-colors hover:bg-muted hover:text-muted-foreground disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Table"
              disabled={disabled}
            >
              <Table className="h-4 w-4" strokeWidth={2.5} />
              <ChevronDown className="h-3 w-3" strokeWidth={2} />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          Table
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start">
        {!isInTable && (
          <DropdownMenuItem
            onClick={() =>
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
            }
            className="text-xs"
          >
            Insert table
          </DropdownMenuItem>
        )}
        {isInTable && (
          <>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addRowAfter().run()}
              className="text-xs"
            >
              Add row below
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addRowBefore().run()}
              className="text-xs"
            >
              Add row above
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              className="text-xs"
            >
              Add column right
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().addColumnBefore().run()}
              className="text-xs"
            >
              Add column left
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteRow().run()}
              className="text-xs"
            >
              Delete row
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteColumn().run()}
              className="text-xs"
            >
              Delete column
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => editor.chain().focus().deleteTable().run()}
              className="text-xs text-destructive"
            >
              Delete table
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TipTapToolbar({ editor, disabled }) {
  // Re-render only when selection or formatting state changes
  const [, forceUpdate] = useReducer((x) => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    editor.on("selectionUpdate", forceUpdate);
    editor.on("update", forceUpdate);
    return () => {
      editor.off("selectionUpdate", forceUpdate);
      editor.off("update", forceUpdate);
    };
  }, [editor]);

  if (!editor) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className={`tiptap-toolbar${disabled ? " tiptap-toolbar--disabled" : ""}`}>
        <ToolbarToggle
          pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
          label="Bold"
          disabled={disabled}
        >
          <Bold className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>
        <ToolbarToggle
          pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
          label="Italic"
          disabled={disabled}
        >
          <Italic className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>
        <ToolbarToggle
          pressed={editor.isActive("strike")}
          onClick={() => editor.chain().focus().toggleStrike().run()}
          label="Strikethrough"
          disabled={disabled}
        >
          <Strikethrough className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarToggle
          pressed={editor.isActive("heading", { level: 1 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
          label="Heading 1"
          disabled={disabled}
        >
          <Heading1 className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>
        <ToolbarToggle
          pressed={editor.isActive("heading", { level: 2 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
          label="Heading 2"
          disabled={disabled}
        >
          <Heading2 className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>
        <ToolbarToggle
          pressed={editor.isActive("heading", { level: 3 })}
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
          label="Heading 3"
          disabled={disabled}
        >
          <Heading3 className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <ToolbarToggle
          pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          label="Bullet list"
          disabled={disabled}
        >
          <List className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>
        <ToolbarToggle
          pressed={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          label="Ordered list"
          disabled={disabled}
        >
          <ListOrdered className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>

        <Separator orientation="vertical" className="mx-1 h-6" />

        <CodeBlockDropdown editor={editor} disabled={disabled} />
        <ToolbarToggle
          pressed={editor.isActive("blockquote")}
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          label="Blockquote"
          disabled={disabled}
        >
          <Quote className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>
        <ToolbarToggle
          pressed={false}
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          label="Horizontal rule"
          disabled={disabled}
        >
          <Minus className="h-4 w-4" strokeWidth={2.5} />
        </ToolbarToggle>
        <TableDropdown editor={editor} disabled={disabled} />
      </div>
    </TooltipProvider>
  );
}

export default TipTapToolbar;
