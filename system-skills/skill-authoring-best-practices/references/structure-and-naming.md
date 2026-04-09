# Skill Structure and Naming Guide

## Naming Conventions

Use consistent naming to make Skills easy to reference and discover.

**Preferred: Gerund form (verb + -ing)**

- `processing-pdfs`
- `analyzing-spreadsheets`
- `managing-databases`
- `testing-code`
- `writing-documentation`

**Acceptable alternatives:**

- Noun phrases: `pdf-processing`, `spreadsheet-analysis`
- Action-oriented: `process-pdfs`, `analyze-spreadsheets`

**Rules:** Lowercase letters, numbers, and hyphens only. Max 50 characters.

## Writing Effective Descriptions

The description enables Skill discovery. Claude uses it to choose the right Skill from potentially 100+ available Skills.

**Critical: Always write in third person.** The description is injected into the system prompt — inconsistent point-of-view causes discovery problems.

**Effective examples:**

```
PDF Processing:
"Extract text and tables from PDF files, fill forms, merge documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction."

Excel Analysis:
"Analyze Excel spreadsheets, create pivot tables, generate charts. Use when analyzing Excel files, spreadsheets, tabular data, or .xlsx files."

Git Commit Helper:
"Generate descriptive commit messages by analyzing git diffs. Use when the user asks for help writing commit messages or reviewing staged changes."
```

## Progressive Disclosure Patterns

The main instruction serves as an overview that points Claude to detailed materials as needed, like a table of contents.

### Pattern 1: High-level guide with references

````markdown
# PDF Processing

## Quick start

Extract text with pdfplumber:

```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```

## Advanced features

**Form filling**: See [references/forms.md](references/forms.md)
**API reference**: See [references/api.md](references/api.md)
**Examples**: See [references/examples.md](references/examples.md)
````

Claude loads each reference file only when needed.

### Pattern 2: Domain-specific organization

For Skills with multiple domains, organize by domain to avoid loading irrelevant context:

```
bigquery-skill/
├── SKILL.md (overview and navigation)
└── references/
    ├── finance.md (revenue, billing metrics)
    ├── sales.md (opportunities, pipeline)
    ├── product.md (API usage, features)
    └── marketing.md (campaigns, attribution)
```

When a user asks about revenue, Claude reads only `references/finance.md`. The other files consume zero context tokens.

Include quick search hints in the main instruction:

````markdown
## Quick search

Find specific metrics using grep:

```bash
grep -i "revenue" references/finance.md
grep -i "pipeline" references/sales.md
```
````

### Pattern 3: Conditional details

```markdown
# DOCX Processing

## Creating documents

Use docx-js for new documents. See [references/docx-js.md](references/docx-js.md).

## Editing documents

For simple edits, modify the XML directly.
**For tracked changes**: See [references/redlining.md](references/redlining.md)
**For OOXML details**: See [references/ooxml.md](references/ooxml.md)
```

## Avoid Deeply Nested References

Keep all references one level deep from the main instruction. Claude may only partially read files referenced from other referenced files.

**Bad — too deep:**

```
SKILL.md → references/advanced.md → references/details.md → actual info
```

**Good — one level deep:**

```
SKILL.md → references/advanced.md (complete info)
SKILL.md → references/api.md (complete info)
SKILL.md → references/examples.md (complete info)
```

## Structure Longer Reference Files

For reference files over 100 lines, include a table of contents at the top:

```markdown
# API Reference

## Contents

- Authentication and setup
- Core methods (create, read, update, delete)
- Advanced features (batch operations, webhooks)
- Error handling patterns
- Code examples

## Authentication and setup

...
```

This ensures Claude can see the full scope even when previewing with partial reads.
