# Advanced: Skills With Executable Code

For Skills that include executable scripts.

## Solve, Don't Punt

Handle error conditions in scripts rather than letting them fail for Claude to figure out.

**Good — handle errors explicitly:**

```python
def process_file(path):
    """Process a file, creating it if it doesn't exist."""
    try:
        with open(path) as f:
            return f.read()
    except FileNotFoundError:
        print(f"File {path} not found, creating default")
        with open(path, "w") as f:
            f.write("")
        return ""
    except PermissionError:
        print(f"Cannot access {path}, using default")
        return ""
```

**Bad — punt to Claude:**

```python
def process_file(path):
    return open(path).read()  # Just fails
```

## No Voodoo Constants

Document all configuration values with justification.

**Good — self-documenting:**

```python
# HTTP requests typically complete within 30 seconds
REQUEST_TIMEOUT = 30

# Most intermittent failures resolve by the second retry
MAX_RETRIES = 3
```

**Bad — magic numbers:**

```python
TIMEOUT = 47   # Why 47?
RETRIES = 5    # Why 5?
```

## Utility Scripts

Pre-made scripts are more reliable than generated code, save tokens and time, and ensure consistency.

Make clear whether Claude should **execute** (most common) or **read** a script:

- Execute: "Run `analyze_form.py` to extract fields"
- Read as reference: "See `analyze_form.py` for the extraction algorithm"

Example documentation:

````markdown
## Utility scripts

**analyze_form.py**: Extract all form fields from PDF

```bash
python scripts/analyze_form.py input.pdf > fields.json
```

Output: `{"field_name": {"type": "text", "x": 100, "y": 200}}`

**validate_boxes.py**: Check for overlapping bounding boxes

```bash
python scripts/validate_boxes.py fields.json
# Returns: "OK" or lists conflicts
```
````

## Visual Analysis

When inputs can be rendered as images, have Claude analyze them visually:

````markdown
1. Convert PDF to images:
   ```bash
   python scripts/pdf_to_images.py form.pdf
   ```
2. Analyze each page image to identify form fields
````

## Verifiable Intermediate Outputs

For complex tasks, use the "plan-validate-execute" pattern to catch errors early.

Instead of directly applying changes, create an intermediate plan file (e.g., `changes.json`) that gets validated before execution:

analyze → **create plan file** → **validate plan** → execute → verify

Make validation scripts verbose: `"Field 'signature_date' not found. Available fields: customer_name, order_total, signature_date_signed"`

Use when: batch operations, destructive changes, complex validation rules, high-stakes operations.

## Package Dependencies

Platform-specific limitations:

- **claude.ai**: Can install from npm, PyPI, and pull from GitHub
- **Claude API**: No network access, no runtime installation

Always list required packages in instructions and verify availability.

**Bad:** "Use the pdf library to process the file."
**Good:** "Install required package: `pip install pypdf`"

## Runtime Environment

How Claude accesses Skills at runtime:

1. **Metadata pre-loaded**: Name and description loaded into system prompt at startup
2. **Files read on-demand**: Claude uses bash to read files from the filesystem when needed
3. **Scripts executed efficiently**: Only script output consumes tokens, not source code
4. **No context penalty for large files**: Reference files don't consume tokens until read

Practical implications:

- File paths matter — always use forward slashes
- Name files descriptively
- Organize directories by domain or feature
- Bundle comprehensive resources freely (no penalty until accessed)
- Prefer scripts for deterministic operations
- Test file access patterns with real requests

## MCP Tool References

Always use fully qualified tool names to avoid "tool not found" errors.

**Format:** `ServerName:tool_name`

```markdown
Use the BigQuery:bigquery_schema tool to retrieve table schemas.
Use the GitHub:create_issue tool to create issues.
```

Without the server prefix, Claude may fail to locate the tool when multiple MCP servers are available.
