---
name: skill-authoring-best-practices
description: Best practices for writing effective Skills that are discoverable, concise, and reliable. Use when creating, reviewing, or improving Skills.
---

Guide for writing effective Skills that are discoverable, concise, and reliable.

## Core Principles

### Be Concise

Claude is already very smart. Only add context Claude doesn't already have. Challenge each piece of information: "Does Claude really need this explanation?" Default to minimal instructions that focus on what's unique to your domain.

**Good** (~50 tokens):

````markdown
## Extract PDF text

Use pdfplumber for text extraction:

```python
import pdfplumber
with pdfplumber.open("file.pdf") as pdf:
    text = pdf.pages[0].extract_text()
```
````

**Bad** (~150 tokens): Explains what PDFs are and how libraries work — Claude already knows this.

### Set Appropriate Degrees of Freedom

Match specificity to task fragility:

- **High freedom** (text instructions): Multiple valid approaches, context-dependent decisions. Example: code review guidelines.
- **Medium freedom** (pseudocode/parameterized scripts): Preferred pattern exists, some variation acceptable. Example: report generation with configurable format.
- **Low freedom** (exact scripts, no parameters): Fragile operations, consistency critical, exact sequence required. Example: database migrations.

Think of it as: narrow bridge with cliffs (low freedom) vs. open field (high freedom).

### Test With All Target Models

Skills act as additions to models. What works for Opus might need more detail for Haiku. Test across all models you plan to use.

## Skill Structure Quick Reference

### Name

Use gerund form (verb + -ing) with lowercase letters, numbers, hyphens only. Max 50 characters.

Good: `processing-pdfs`, `analyzing-spreadsheets`, `testing-code`
Acceptable: `pdf-processing`, `process-pdfs`
Avoid: `helper`, `utils`, `tools`, `documents`

### Description

Write in **third person** (the description is injected into the system prompt). Include what the Skill does AND when to use it. Be specific with key terms. Max 200 characters.

Good: "Extracts text and tables from PDF files, fills forms, merges documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction."
Bad: "Helps with documents" / "I can help you process files"

### Progressive Disclosure

Keep main instruction concise (under 500 lines). Put detailed content in `references/` files. All references should be **one level deep** from the main instruction — never nest references within references.

For detailed structure patterns, see [structure-and-naming.md](references/structure-and-naming.md).

## Key Patterns

- **Template pattern**: Provide output format templates with appropriate strictness level
- **Examples pattern**: Show input/output pairs for quality-sensitive output
- **Workflow pattern**: Break complex tasks into sequential steps with checklists
- **Feedback loop pattern**: Run validator → fix errors → repeat
- **Conditional workflow**: Guide through decision points to different paths

For detailed patterns and examples, see [workflows-and-patterns.md](references/workflows-and-patterns.md).

## Content Guidelines

- **No time-sensitive info**: Use "current method" / "old patterns" sections instead of dates
- **Consistent terminology**: Pick one term per concept and stick with it throughout
- **Avoid too many options**: Provide a sensible default with an escape hatch, not a menu of choices
- **Use forward slashes** in all file paths (never backslashes)
- **Name files descriptively**: `form_validation_rules.md` not `doc2.md`

## Skills With Executable Code

For skills that include scripts, see [advanced-code-skills.md](references/advanced-code-skills.md). Key principles:

- Scripts should handle errors explicitly, not punt to Claude
- Document all constants — no "voodoo constants"
- Prefer executing scripts over loading their contents into context
- List required packages and verify availability
- Use MCP fully qualified tool names: `ServerName:tool_name`

## Evaluation and Iteration

Build evaluations BEFORE writing extensive documentation. Use evaluation-driven development:

1. Identify gaps by running Claude without a Skill
2. Create evaluations testing those gaps
3. Write minimal instructions to pass evaluations
4. Iterate based on real usage with the Claude A (author) / Claude B (tester) pattern

For the complete development workflow and checklist, see [evaluation-and-iteration.md](references/evaluation-and-iteration.md).
