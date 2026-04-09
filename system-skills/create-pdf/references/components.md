## Component Reference & Visual Patterns

This reference covers the `PDFReport` helper methods in detail, the standalone `add_code_block()` function, and custom component patterns for building modern, visually distinctive reports.

---

### 1. Content Methods — Detailed Reference

#### add_title_page(title, subtitle="", author="", date="", org="")

Dark header-band title page with white text. The band covers the top ~130mm. Subtitle, author, org, and date are optional — meta fields appear below the band.

```python
pdf.add_title_page(
    'Q4 2024 Performance Report',
    subtitle='Enterprise Division Analysis',
    author='Strategy Team',
    date='January 2025'
)
```

#### add_section(title) / add_subsection(title)

Section: 18pt bold in title color, accent underline from x=20 to x=80. Subsection: 14pt bold, no underline. Both reset text color to body afterward.

Use `add_section()` for major report divisions. `add_subsection()` for topics within a section.

#### add_body(text)

Standard body paragraph, 11pt regular, body color. Uses `multi_cell(0, 6, text)` — safe for single-block prose. Do NOT use for multiline code (FPDF drops `\n` in multi_cell).

#### add_callout_box(text, fill_color=None, min_height=30)

Tinted background box with a 2.5mm accent-colored bar on the left edge. Page-break safe via `ensure_space()`. Default fill is the theme's `card_bg` color.

Good for: key findings, important notes, summary takeaways, warnings.

```python
pdf.add_callout_box("Key finding: Customer retention improved 12% after implementing the new onboarding flow.")
```

For a custom fill color (e.g. a warning box):

```python
pdf.add_callout_box("Warning: Data for Q3 is preliminary.", fill_color=(255, 245, 238))
```

#### add_quote_strip(text, attribution="")

Centered italic text in a full-width tinted band. Optional attribution line in smaller muted text. Good for key quotes, executive summaries, or section-closing takeaways.

```python
pdf.add_quote_strip(
    "The best time to plant a tree was twenty years ago. The second best time is now.",
    attribution="— Chinese Proverb"
)
```

#### add_kpi_strip(kpis, cols=None)

Row of stat callout cards. Each card shows a large bold value in title color and a small muted label. `cols` defaults to the number of KPIs.

```python
pdf.add_kpi_strip([
    {'label': 'Revenue', 'value': '$4.2M'},
    {'label': 'Growth', 'value': '+18%'},
    {'label': 'NPS Score', 'value': '72'},
])
```

Best at the top of a section or right after the executive summary heading. 3–4 KPIs per strip works best; more gets cramped.

#### add_indented_rich_text(indent_x, bold_text, regular_text, ...)

Bold + regular text inline at an indented position. Uses `write()` for both parts with a temporary left-margin shift. This is the safe pattern for mixing font weights at an indent — see `references/technical.md` for why `write() + multi_cell()` doesn't work.

```python
pdf.add_indented_rich_text(28, "Key Insight: ", "The enterprise segment drove 73% of total growth.")
```

#### add_labeled_item(indent_x, indicator_color, label, description, ...)

Colored indicator bar (2mm × 6mm) + bold label + regular description. Good for pros/cons, categorized points, or feature lists.

```python
pdf.add_labeled_item(28, (44, 95, 45), "Strength", "Market-leading retention rates in the 25-34 demographic.")
pdf.add_labeled_item(28, (200, 60, 60), "Risk", "Supply chain dependency on a single vendor.")
```

#### add_numbered_item(indent_x, number, badge_color, label, description, ...)

Numbered badge (8mm × 7mm rectangle with white number) + bold label + description. Good for step-by-step processes, ranked items, or numbered recommendations.

```python
pdf.add_numbered_item(32, 1, (6, 90, 130), "Audit Existing Infrastructure",
    "Map all current services and their dependencies before migration planning.")
```

#### add_chart(img_path, caption="", width=160)

Centers a chart image with optional "Figure N:" caption below. Estimates image height and calls `ensure_space()`. Default width 160mm (centered on A4).

```python
pdf.add_chart('/tmp/revenue_chart.png', caption='Figure 1: Revenue by segment, Q1-Q4 2024')
```

#### add_table(headers, rows, col_widths=None, row_height=7)

Themed table with header band in title color, alternating row shading. Uses `cell()` — long text is clipped, not wrapped. For wrapping, use `add_table_wrapped()`.

```python
pdf.add_table(
    headers=['Metric', 'Q3', 'Q4', 'Change'],
    rows=[['Revenue', '$3.6M', '$4.2M', '+18%'], ['Users', '12.4K', '14.1K', '+14%']],
    col_widths=[50, 35, 35, 30]
)
```

#### add_table_wrapped(headers, rows, col_widths=None, line_height=5.5, padding=1.5)

Table with automatic multi-line cell wrapping. Row height adjusts to the tallest cell. Use this when any cell might contain more than a few words.

#### add_formula(img_path, max_w=90)

Embeds a rendered formula image (from `render_formula()`) in a tinted strip, centered.

---

### 2. Code Block Implementation

`add_code_block()` is a standalone function — not built into `PDFReport`. Paste this into your script and call it on the `pdf` instance for any code, shell commands, JSON, config files, or preformatted text.

```python
def add_code_block(pdf, code_text: str, font_size: int = 8, line_height: float = 4.5):
    """
    Render monospace code with a dark background, preserving all line breaks.
    FPDF2 does not respect \\n in multi_cell/write — this function splits on \\n
    and renders each line individually with cell(), which is the only safe approach.
    """
    lines = code_text.strip('\n').split('\n')
    estimated_h = len(lines) * line_height + 6
    pdf.ensure_space(estimated_h)

    pdf.set_fill_color(30, 41, 59)      # dark slate background
    pdf.set_text_color(226, 232, 240)    # light text
    pdf.set_font('Courier', '', font_size)

    pdf.ln(1)
    for line in lines:
        display = line.replace(' ', '\u00a0')  # preserve indentation
        pdf.cell(0, line_height, display, ln=True, fill=True)
    pdf.ln(3)

    # Restore body font and color
    pdf.set_font('Helvetica', '', 11)
    pdf.set_text_color(51, 51, 51)
```

**Usage:**

```python
add_code_block(pdf, """
def review_router(state):
    if state["review_report"].status == "PASS":
        return "finalize"
    return "builder_agent"
""")
```

**Rules:**

Do not pass multiline strings to `add_body()`, `write()`, or `multi_cell()` — FPDF2 silently drops all `\n` characters, collapsing the block into one continuous line. Always use `add_code_block()` for preformatted content. If a code block exceeds ~40 lines, split into labeled parts rather than letting it run across pages.

---

### 3. Visual Motif Ideas

Pick ONE motif and apply it consistently across every page. Mixing motifs looks scattered.

**Accent-bar callouts (default):** The `add_callout_box()` left-bar pattern. Extend this by using the same left-bar treatment on other custom elements — e.g., adding a 2.5mm accent bar beside important paragraphs or beside chart annotations.

**Numbered badges:** Use `add_numbered_item()` for key points, recommendations, or steps. The badge color should match the theme's title color. Creates a strong visual rhythm when 3–5 items appear in sequence.

**Indicator-bar categorization:** Use `add_labeled_item()` with consistent color coding (green for strengths, amber for opportunities, red for risks). Apply the same colors in charts and tables.

**Accent-underlined sections:** The default `add_section()` draws an accent line under the heading. Carry a similar short accent line under subsections or key terms for consistency.

**Full-width tinted bands:** Use `add_quote_strip()` for section-closing takeaways, not just quotes. A tinted band with centered text creates visual punctuation between major sections.

---

### 4. Custom Component Patterns

When the built-in helpers don't cover what you need, build custom elements using FPDF primitives. Key rules: always call `ensure_space()` first, always reset font/color after, and keep the styling consistent with the theme.

**Custom two-column layout:**

```python
pdf.ensure_space(50)
col_w = 80
gap = 10
y0 = pdf.get_y()

# Left column
pdf.set_xy(20, y0)
pdf.set_font('Helvetica', 'B', 14)
pdf.set_text_color(*pdf.COLORS['title'])
pdf.cell(col_w, 8, 'Before', ln=True)
pdf.set_x(20)
pdf.set_font('Helvetica', '', 10)
pdf.set_text_color(*pdf.COLORS['body'])
old_l = pdf.l_margin
pdf.set_left_margin(20)
pdf.multi_cell(col_w, 5.5, 'Description of the before state...')
pdf.set_left_margin(old_l)

# Right column
pdf.set_xy(20 + col_w + gap, y0)
pdf.set_font('Helvetica', 'B', 14)
pdf.set_text_color(*pdf.COLORS['title'])
pdf.cell(col_w, 8, 'After', ln=True)
pdf.set_x(20 + col_w + gap)
pdf.set_font('Helvetica', '', 10)
pdf.set_text_color(*pdf.COLORS['body'])
pdf.set_left_margin(20 + col_w + gap)
pdf.multi_cell(col_w, 5.5, 'Description of the after state...')
pdf.set_left_margin(old_l)

pdf.set_y(max(pdf.get_y(), y0 + 40))
```

**Section divider page (for long reports):**

```python
pdf.add_page()
pdf.set_fill_color(*pdf.COLORS['title'])
pdf.rect(0, 0, 210, 297, 'F')
pdf.set_y(120)
pdf.set_text_color(255, 255, 255)
pdf.set_font('Helvetica', 'B', 28)
pdf.cell(0, 14, 'Part II', align='C', ln=True)
pdf.set_font('Helvetica', '', 16)
pdf.set_text_color(210, 225, 240)
pdf.cell(0, 10, 'Market Analysis', align='C', ln=True)
```

**Highlight stat inline (accent-colored number in body text):**

```python
pdf.set_font('Helvetica', '', 11)
pdf.set_text_color(*pdf.COLORS['body'])
pdf.write(6, 'Customer retention improved by ')
pdf.set_font('Helvetica', 'B', 13)
pdf.set_text_color(*pdf.COLORS['title'])
pdf.write(6, '12%')
pdf.set_font('Helvetica', '', 11)
pdf.set_text_color(*pdf.COLORS['body'])
pdf.write(6, ' in the first quarter after deployment.')
pdf.ln(8)
```
