---
name: create-pdf
description: Guidelines for creating polished, themed PDF reports with the code execution tool
---

Guidelines for creating professional, visually distinctive PDF reports via python-pptx's `PDFReport` helper class and matplotlib.

The design language borrows from modern presentation aesthetics — clean, spacious, intentional — adapted for the long-form reading experience. Light body pages for readability, bold title treatment for impact, and strategic color throughout.

## Reference Files

Read these from `/tmp/skills/pdf/references/` when you need implementation details.

| File            | When to load                                    | Contents                                                                                          |
| --------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `components.md` | Before building the report                      | Helper method reference, code block implementation, custom component patterns, visual motif ideas |
| `charts.md`     | Before creating any chart                       | Matplotlib styling, palette integration, chart type selection, chart + context composition        |
| `technical.md`  | When troubleshooting or building custom layouts | Page-break safety, write/multi_cell pitfalls, FPDF encoding, common bugs                          |

---

## 1. Design Philosophy

Every element earns its place on the page. If it doesn't communicate, clarify, or guide the eye — remove it.

### 1.1 Core Principles

**Content is king.** Typography, spacing, and strategic color create hierarchy. Decoration is the enemy. A well-structured report with generous whitespace communicates more authority than one stuffed with borders and ornaments.

**Light body, bold accents.** Reports are read at length — light backgrounds with dark text for body content. Save bold, dark treatment for the title page and section openers. The title page sets the mood; body pages prioritize readability.

**60/30/10 color distribution.** 60% neutral (white page background, dark body text), 30% complementary (card/callout fills, section header colors, table header bands), 10% accent (KPI values, chart highlights, key stats, accent bars on callout boxes). If accent color covers more than ~10% of a page's visual area, pull back.

**Topic-driven palette.** The palette should feel designed for THIS report's subject. If swapping colors into a completely different report would still "work," the choices aren't specific enough. One color dominates (titles, section headers), 1–2 supporting tones for callout fills and tables, one accent for highlights.

**Generous whitespace.** Let content breathe. When a section feels cramped, split it across two pages rather than shrinking fonts. Space between sections signals confidence, not waste.

**Two font weights only.** Regular for body, Bold for headings and emphasis. Helvetica covers both. Reserve Italic for quotes and captions only — it's a third voice, use it sparingly.

**Flat and clean.** No heavy borders, drop shadows, 3D chart effects, or decorative clip art. Subtle background fills, minimal or no borders, and clean lines. Hierarchy comes from size, weight, color, and spatial position — in that order.

**Visual motif.** Commit to ONE distinctive element and carry it through every page: a colored left-margin bar on callout boxes, accent lines under headings, numbered circle badges for key items, or a consistent card styling. One motif, applied everywhere, creates more design coherence than multiple decorative ideas applied inconsistently.

**Layout variety.** No two consecutive sections should use the same visual format. Rotate through prose, callout boxes, charts, tables, KPI strips, quotes, and numbered/labeled items. Plan the visual treatment for each section before writing code.

### 1.2 What Looks Outdated

| Outdated                                   | Modern replacement                                                 |
| ------------------------------------------ | ------------------------------------------------------------------ |
| Heavy borders around every element         | Subtle background fills, minimal or no borders                     |
| Decorative clip art or icons               | Purposeful whitespace                                              |
| Underlined headings                        | Size + color contrast + spacing below                              |
| Multiple font families (3+)                | Max 2: Helvetica for everything, or pair with one serif for titles |
| Centered body text                         | Left-aligned body; center only title page and captions             |
| Dense walls of text with no breaks         | Whitespace between paragraphs, callout boxes, charts               |
| Rainbow color schemes                      | Topic-driven palette: 1 dominant + 1–2 supporting                  |
| 3D chart effects, gradient fills on charts | Flat, clean chart style with palette-harmonized colors             |
| Same layout pattern every section          | Rotate through the helper methods                                  |
| Drop shadows on boxes                      | Flat fill or very subtle border only                               |

### 1.3 Accessibility & Contrast

**WCAG minimums:** Body text (<18pt): 4.5:1 contrast ratio. Headings (≥18pt or ≥14pt bold): 3:1.

**Safe on white/light:** #000000, #333333, #1B2A4A, #4A4A4A. On dark backgrounds (title page): #FFFFFF, #E0E0E0.

Avoid: light gray text on white, pastel text on light backgrounds, red (#FF0000) on white (only 4:1 — fails for small text). Never use color as the sole information channel.

---

## 2. Theme & Color System

### 2.1 Built-In Themes

Each theme defines title/heading color, accent color, card/callout background, and body text. Apply via `pdf.set_theme('name')`.

| Theme      | Title   | Accent  | Card BG | Best for               |
| ---------- | ------- | ------- | ------- | ---------------------- |
| midnight   | #1E2761 | #CADCFC | #EDF1FA | Executive, strategy    |
| forest     | #2C5F2D | #97BC62 | #F0F5E8 | Sustainability, nature |
| coral      | #F96167 | #2F3C7E | #FFF5F0 | Creative, marketing    |
| terracotta | #B85042 | #A7BEAE | #F5F0ED | Architecture, culture  |
| ocean      | #065A82 | #1C7293 | #E8F2F7 | Technology, research   |
| charcoal   | #36454F | #212121 | #F2F2F2 | Minimal, professional  |
| teal       | #028090 | #02C39A | #E6F5F2 | Healthcare, fintech    |
| berry      | #6D2E46 | #A26769 | #F5EDE8 | Fashion, premium       |
| sage       | #84B59F | #50808E | #EDF3F0 | Wellness, consulting   |
| cherry     | #990011 | #2F3C7E | #FFF5F5 | Impact, bold analysis  |

### 2.2 Custom Palettes

For subjects that don't fit a built-in theme, set colors directly:

```python
pdf.COLORS['title'] = (30, 39, 97)
pdf.COLORS['accent'] = (100, 140, 200)
pdf.COLORS['card_bg'] = (240, 244, 248)
pdf.COLORS['body'] = (51, 51, 51)
pdf.COLORS['border'] = (200, 210, 220)
```

Derive card_bg from the title color at ~5–10% opacity over white. The accent should complement but not match the title color — a different hue or a lighter/brighter version of the same family.

### 2.3 Chart Palette Integration

Always harmonize charts with the report palette:

```python
pal = pdf.get_chart_palette()
# pal['primary']    — hex, main chart color
# pal['secondary']  — hex, accent chart color
# pal['series']     — list of 6 harmonized hex colors
# pal['title_hex']  — for chart titles
# pal['body_hex']   — for axis labels
# pal['card_bg_hex'] — for chart background fills
```

Pass `pal['series']` to bar colors, line colors, pie slices, etc. Charts that use default matplotlib colors instead of the report palette look disconnected.

---

## 3. Script Toolkit

### 3.1 Loading

```python
import sys, importlib
sys.path.insert(0, '/tmp/skills/pdf/scripts')
from pdf_helpers import PDFReport, THEMES, render_formula
```

### 3.2 Initialization

```python
pdf = PDFReport(orientation='P', unit='mm', format='A4')
pdf.set_auto_page_break(auto=True, margin=25)
pdf.set_margins(left=20, top=20, right=20)
pdf.set_theme('ocean')
pdf.alias_nb_pages()
```

### 3.3 Helper Method Overview

| Method                                                                 | Purpose                                    |
| ---------------------------------------------------------------------- | ------------------------------------------ |
| `set_theme(name)`                                                      | Apply a named palette                      |
| `get_chart_palette(n=6)`                                               | Theme-harmonized hex colors for matplotlib |
| `ensure_space(min_mm)`                                                 | Page break if not enough room              |
| `add_title_page(title, subtitle, author, date, org)`                   | Dark header-band title page                |
| `add_section(title)`                                                   | Section heading with accent underline      |
| `add_subsection(title)`                                                | Smaller sub-heading                        |
| `add_body(text)`                                                       | Standard body paragraph                    |
| `add_callout_box(text, fill_color, min_height)`                        | Tinted box with left accent bar            |
| `add_quote_strip(text, attribution)`                                   | Centered italic band                       |
| `add_kpi_strip(kpis, cols)`                                            | Row of stat cards                          |
| `add_indented_rich_text(indent_x, bold_text, regular_text, ...)`       | Bold + regular inline at indent            |
| `add_labeled_item(indent_x, indicator_color, label, description)`      | Color bar + label/description              |
| `add_numbered_item(indent_x, number, badge_color, label, description)` | Badge + label/description                  |
| `add_chart(img_path, caption, width)`                                  | Centered image + sequential caption        |
| `add_table(headers, rows, col_widths, row_height)`                     | Simple table (clips long text)             |
| `add_table_wrapped(headers, rows, col_widths, line_height, padding)`   | Table with multi-line wrapping             |
| `add_formula(img_path, max_w)`                                         | Formula image in tinted strip              |

For detailed signatures, usage notes, and the `add_code_block()` standalone function, see `references/components.md`.

### 3.4 Font Size Guide

| Element                   | Size                       | Weight                |
| ------------------------- | -------------------------- | --------------------- |
| Report title (title page) | 26–32pt                    | Bold                  |
| Section headings          | 16–20pt                    | Bold                  |
| Sub-headings              | 13–15pt                    | Bold                  |
| Body text                 | 10–12pt (11pt recommended) | Regular               |
| Captions                  | 8–10pt                     | Italic                |
| Table text                | 9–11pt                     | Regular               |
| KPI values                | 24–30pt                    | Bold, in accent color |
| KPI labels                | 9–10pt                     | Regular, muted        |

Use Helvetica (built into fpdf2). One font family is enough — hierarchy comes from size and weight.

---

## 4. Report Planning & Structure

### 4.1 Before Writing Code

Clarify purpose (informational, analytical, persuasive, status update) and audience (executives want brevity and conclusions first, technical readers want methodology and detail). Outline the sections, decide which visual treatment each gets (prose, callout, chart, table, KPI strip, badges), and plan a target page count.

### 4.2 Recommended Section Order

1. **Title Page** — `add_title_page()` with dark header band, subtitle, author, date
2. **Executive Summary** — Purpose, key findings, conclusions, recommendations. Write LAST, place FIRST.
3. **Introduction / Background** — Context, scope, objectives
4. **Methodology** (if applicable) — Data gathering approach, kept brief
5. **Findings / Analysis** — Core content with charts, organized by theme/chronology/priority
6. **Discussion** (if applicable) — Interpret findings, address limitations
7. **Conclusions** — Main takeaways
8. **Recommendations** (if applicable) — Specific, actionable next steps
9. **Appendix / References** (if applicable)

Lead with conclusions (inverted pyramid). One idea per section. Executive summary should stand alone at ~10–15% of total text content.

### 4.3 Special Report Types

**Executive / Status:** 3–5 sections, lead with KPI strip, outcomes and next steps. Keep it short.

**Analytical / Research:** Detailed, includes methodology and discussion, line charts and tables, addresses limitations.

**Comparison / Benchmark:** Structured around dimensions, uses grouped bar/radar charts, ends with clear recommendation.

**Incident / Post-Mortem:** Chronological, factual, blameless tone.

---

## 5. Writing Style

Clear, direct language. Sentences under 25 words, paragraphs under 75 words. Active voice preferred.

Be specific: "Revenue increased 18% YoY to $4.2M" communicates more than "Revenue increased significantly."

Professional, objective tone — confident but measured. Consistent formatting for numbers, currencies, and percentages. Always provide context for numbers: comparisons, benchmarks, or trends.

---

## 6. Chart Sections — Tell the Story, Not Just the Data

<chart_section_composition>
A chart without interpretation is a missed opportunity. Every chart section in a report pairs the visualization with a clear takeaway — the chart is evidence for an insight, and the insight should be stated explicitly.

Every chart section includes:

1. **An insight-driven heading** — frames what the data reveals. "Revenue Grew 18% as Enterprise Segment Doubled" communicates far more than "Revenue Overview."

2. **Brief context** — 1–2 sentences before the chart that set up what the reader should look for.

3. **The chart itself** — styled to match the report palette, saved at dpi=150+, with descriptive axis labels.

4. **A "Figure N:" caption** — sequentially numbered, placed via `add_chart(img_path, caption)`.

5. **A takeaway paragraph after the chart** — what the data means, why it matters, what action it implies. This is where the analysis lives.

The pattern is: heading → context sentence → chart → caption → analysis paragraph. A section with just a heading and a chart leaves the reader to draw their own conclusions, which defeats the purpose of the report.
</chart_section_composition>

For chart type selection, matplotlib styling, and palette integration details, see `references/charts.md`.

---

## 7. Layout & Pagination

### 7.1 Content Density

One key idea per section. Prefer a single clear chart over three small ones. Generous whitespace between sections. When a section feels cramped, split across two pages.

### 7.2 Page-Break Safety

Composite elements (callout boxes, KPI strips, charts, tables) that draw background fills at absolute Y positions produce rendering artifacts when `multi_cell()` triggers an auto page break mid-element. All built-in helpers handle this via `ensure_space()`. When building custom composite elements, call `pdf.ensure_space(estimated_height)` before drawing.

For detailed technical rules on page breaks, the write/multi_cell overflow problem, code blocks, and FPDF encoding limitations, see `references/technical.md`.

### 7.3 Layout Variety

Plan the visual treatment for each section before writing code. Use this as a rotation guide:

| Section type                     | Good visual treatment                          |
| -------------------------------- | ---------------------------------------------- |
| Key findings / executive summary | KPI strip + callout boxes                      |
| Narrative context                | Body prose, maybe a callout for the main point |
| Data analysis                    | Chart + takeaway paragraph                     |
| Comparisons                      | Table or side-by-side chart                    |
| Steps / process                  | Numbered items with badges                     |
| Pros/cons / categories           | Labeled items with colored indicators          |
| Key quotes / takeaways           | Quote strip                                    |
| Code / technical detail          | Code block                                     |

No two consecutive sections should use the same format. If the last section was a chart, make the next one a callout box or table.

---

## 8. QA Checklist

1.  Theme chosen — topic-driven palette applied via `set_theme()` or custom COLORS
2.  Chart palette used — `get_chart_palette()` colors passed to all matplotlib charts
3.  Visual motif consistent — same accent treatment on every page
4.  Layout variety — no two consecutive sections use the same visual format
5.  Title page present with dark header band, title, author, date
6.  Executive summary stands alone
7.  Logical section flow with coherent narrative arc
8.  All data/numbers verified for accuracy
9.  Each chart has dpi=150+, palette-harmonized colors, and sequential "Figure N:" caption
10. Every chart section includes context before and takeaway after the chart
11. Consistent fonts, colors, and spacing throughout
12. Tables have themed headers and alternating row shading
13. Page numbers via `alias_nb_pages()`
14. `set_auto_page_break` enabled
15. `matplotlib.use('Agg')` set before pyplot import
16. `plt.close()` called after each chart save
17. No write() + multi_cell(fixed_width) patterns (use `add_indented_rich_text`)
18. No manual rect + multi_cell combos without ensure_space() (use built-in helpers)
19. Code/preformatted text uses `add_code_block()` — never `add_body()` for multiline code
20. WCAG contrast met — body text ≥4.5:1, headings ≥3:1
21. No outdated patterns — no heavy borders, 3D charts, clip art, rainbow colors
22. File saved to `/tmp/` and `generate_download_link` called
