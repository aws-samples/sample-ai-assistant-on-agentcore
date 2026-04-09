## Technical Reference — FPDF Pitfalls & Rules

This reference covers the technical gotchas that cause the most common bugs in PDF generation with fpdf2. Load this when building custom layouts or troubleshooting rendering issues.

---

### 1. Page-Break Safety

#### The Problem

Composite elements (callout boxes, KPI strips, charts, tables) draw background fills or accent bars at absolute Y positions. If `multi_cell()` triggers an auto page break mid-element, the Y reference captured before the break becomes invalid on the new page. This causes fills and bars to stretch incorrectly or appear in the wrong position.

#### The Fix

Call `pdf.ensure_space(estimated_height_mm)` before drawing any composite element. This checks remaining vertical space and forces a clean page break BEFORE the element starts, so no element ever straddles a page boundary.

```python
pdf.ensure_space(50)  # ensure 50mm of space before drawing
y0 = pdf.get_y()
# ... draw background rect, write text, etc. ...
```

All built-in helpers (`add_callout_box`, `add_kpi_strip`, `add_chart`, `add_table`, `add_table_wrapped`, `add_numbered_item`, `add_labeled_item`, `add_quote_strip`, `add_formula`) already call `ensure_space()` internally. You only need to call it manually when building custom composite elements.

#### Rules

Do not draw a background rect, then write text that may trigger a page break, then calculate rect height from Y positions — the Y delta is invalid across pages. Always `ensure_space()` first, or pre-calculate the element's total height and check against available space.

---

### 2. write() + multi_cell() Overflow

#### The Problem

When combining bold titles with regular descriptions at an indented position, a common pattern is:

```python
pdf.write(6, "Bold Title: ")           # advances cursor rightward
pdf.multi_cell(fixed_width, 6, "Long description text...")  # starts from cursor X
```

This overflows because `write()` advances the X cursor, and `multi_cell(fixed_width)` adds that fixed width starting from the new X position — extending past the right page margin. Text gets clipped.

#### The Fix

Use `add_indented_rich_text()`, which uses `write()` for BOTH the bold and regular parts with a temporary `set_left_margin()`:

```python
pdf.add_indented_rich_text(28, "Bold Title: ", "Long description text that wraps correctly.")
```

#### Rules

Do not follow `write()` with `multi_cell(fixed_width)` — it overflows the page. Use `write()` for both bold and regular parts when combining inline. Set a temporary `left_margin` to the indent position and restore it afterward. `multi_cell(0, h, text)` (width=0, meaning "fill to right margin") is safe for non-indented body text.

---

### 3. Code Block Line Breaks

#### The Problem

FPDF2's `multi_cell()` and `write()` silently drop all `\n` characters. Passing a multiline code string to `add_body()` or any `multi_cell()`-based method collapses the entire block into one continuous line of text.

#### The Fix

Use `add_code_block()` (standalone function — see `references/components.md` for the implementation). It splits on `\n` and renders each line individually with `cell()`, which is the only reliable approach.

#### Rules

Never pass multiline strings to `add_body()`, `write()`, or `multi_cell()` when line breaks matter. Always use `add_code_block()` for code samples, shell commands, JSON, config files, or any preformatted text. Call `ensure_space()` before rendering (the function does this internally). If a block exceeds ~40 lines, split it into labeled parts — `cell()` does not auto-paginate mid-block.

---

### 4. FPDF Encoding Limitations

FPDF2 with the default built-in fonts (Helvetica, Courier, Times) uses latin-1 encoding. This means:

**Safe:** Standard ASCII characters, Western European accented characters (é, ñ, ü, etc.)

**Unsafe:** Unicode characters beyond latin-1 — Greek letters (α, β), mathematical symbols (∞, ≤), CJK characters, emoji. These will raise errors or render as garbage.

**Workarounds:**

- Spell out Greek letters in descriptions: "alpha" instead of α
- Use `render_formula()` for mathematical expressions
- Use `\u00a0` (non-breaking space) to preserve indentation in `cell()` calls
- For Unicode-heavy content, consider using `pdf.add_font()` with a TTF that covers the needed glyphs, but this adds complexity

---

### 5. Other Common Pitfalls

**Forgetting `matplotlib.use('Agg')`:** Must be called before importing pyplot. Without it, matplotlib tries to use a GUI backend that doesn't exist in headless environments, causing crashes.

**Forgetting `plt.close()`:** Each unclosed figure consumes memory. With many charts, this causes memory issues.

**Forgetting `pdf.add_page()`:** Content written without a page call won't appear. Always add a page before writing content (the title page method handles this internally).

**Using `cell()` for long text:** `cell()` clips text that exceeds the cell width. Use `multi_cell()` or `add_table_wrapped()` when text may be long.

**Chart images too small or blurry:** Use `dpi=150` minimum and `figsize=(7, 4)`. Smaller images look pixelated in the PDF.

**Not resetting font/color:** FPDF carries font and color state forward. After any custom styling (bold, colored text), explicitly reset to body defaults:

```python
pdf.set_font('Helvetica', '', 11)
pdf.set_text_color(*pdf.COLORS['body'])
```

**Filenames with spaces:** Use underscores in `/tmp/` paths. Some environments have issues with spaces.

**Not calling `generate_download_link`:** The user can't download without it. Always call it after saving.
