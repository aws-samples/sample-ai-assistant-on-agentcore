# Workflows and Patterns

## Workflow Pattern

Break complex operations into clear, sequential steps. For particularly complex workflows, provide a checklist Claude can copy and track progress against.

### Example: Research synthesis (no code)

````markdown
## Research synthesis workflow

Copy this checklist and track your progress:

```
Research Progress:
- [ ] Step 1: Read all source documents
- [ ] Step 2: Identify key themes
- [ ] Step 3: Cross-reference claims
- [ ] Step 4: Create structured summary
- [ ] Step 5: Verify citations
```

**Step 1: Read all source documents**
Review each document in the `sources/` directory. Note main arguments and evidence.

**Step 2: Identify key themes**
Look for patterns across sources. Where do sources agree or disagree?

**Step 3: Cross-reference claims**
For each major claim, verify it appears in source material.

**Step 4: Create structured summary**
Organize by theme: main claim, supporting evidence, conflicting viewpoints.

**Step 5: Verify citations**
Check every claim references the correct source. If incomplete, return to Step 3.
````

### Example: PDF form filling (with code)

````markdown
## PDF form filling workflow

Copy this checklist:

```
Task Progress:
- [ ] Step 1: Analyze the form (run analyze_form.py)
- [ ] Step 2: Create field mapping (edit fields.json)
- [ ] Step 3: Validate mapping (run validate_fields.py)
- [ ] Step 4: Fill the form (run fill_form.py)
- [ ] Step 5: Verify output (run verify_output.py)
```

If verification fails, return to Step 2.
````

## Feedback Loop Pattern

Run validator → fix errors → repeat. This pattern greatly improves output quality.

### Without code (style guide compliance):

```markdown
1. Draft content following STYLE_GUIDE.md
2. Review against checklist: terminology, format, required sections
3. If issues found: note each issue, revise, review again
4. Only proceed when all requirements are met
```

### With code (document editing):

```markdown
1. Make edits to word/document.xml
2. Validate immediately: python scripts/validate.py unpacked_dir/
3. If validation fails: review error, fix, validate again
4. Only proceed when validation passes
5. Rebuild: python scripts/pack.py unpacked_dir/ output.docx
```

## Template Pattern

Provide output format templates. Match strictness to your needs.

**Strict** (API responses, data formats):

````markdown
ALWAYS use this exact template:

```markdown
# [Analysis Title]

## Executive summary

[One-paragraph overview]

## Key findings

- Finding with supporting data

## Recommendations

1. Specific actionable recommendation
```
````

**Flexible** (when adaptation is useful):

````markdown
Sensible default format — use judgment based on the analysis:

```markdown
# [Analysis Title]

## Executive summary

[Overview]

## Key findings

[Adapt sections based on what you discover]
```

Adjust sections as needed.
````

## Examples Pattern

For quality-sensitive output, provide input/output pairs:

````markdown
## Commit message format

**Example 1:**
Input: Added user authentication with JWT tokens
Output:

```
feat(auth): implement JWT-based authentication
Add login endpoint and token validation middleware
```

**Example 2:**
Input: Fixed bug where dates displayed incorrectly
Output:

```
fix(reports): correct date formatting in timezone conversion
Use UTC timestamps consistently across report generation
```
````

Examples communicate desired style more clearly than descriptions alone.

## Conditional Workflow Pattern

Guide Claude through decision points:

```markdown
## Document modification workflow

1. Determine the modification type:
   **Creating new content?** → Follow "Creation workflow" below
   **Editing existing content?** → Follow "Editing workflow" below

2. Creation workflow:
   - Use docx-js library
   - Build document from scratch
   - Export to .docx format

3. Editing workflow:
   - Unpack existing document
   - Modify XML directly
   - Validate after each change
   - Repack when complete
```

If workflows become large, push them into separate reference files and tell Claude to read the appropriate file based on the task.
