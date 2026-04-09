## Table Creation for PPT (python-pptx)

Tables are a first-class content element. Use them for comparisons, specifications, feature matrices, pricing, status dashboards, or any data with natural row-column structure.

---

### 1. Basic Table Creation

```python
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN, MSO_ANCHOR

# Add table to slide
rows, cols = 5, 4
x, y, w, h = Inches(0.8), Inches(1.8), Inches(11.7), Inches(4.5)
table_shape = slide.shapes.add_table(rows, cols, x, y, w, h)
table = table_shape.table
```

---

### 2. Populating Table Data

```python
headers = ['Feature', 'Basic', 'Pro', 'Enterprise']
data = [
    ['Storage', '10 GB', '100 GB', 'Unlimited'],
    ['Users', '5', '25', 'Unlimited'],
    ['Support', 'Email', 'Priority', '24/7 Dedicated'],
    ['API Access', '—', '✓', '✓'],
]

# Set header row
for col_idx, header in enumerate(headers):
    table.cell(0, col_idx).text = header

# Set data rows
for row_idx, row_data in enumerate(data):
    for col_idx, value in enumerate(row_data):
        table.cell(row_idx + 1, col_idx).text = value
```

---

### 3. Dark Theme Table Styling

Style tables to match the deck's dark aesthetic. Define a helper function and reuse it:

```python
def style_table_dark(table, font_name='Inter',
                     header_bg='#1e293b', row_bg='#0f172a', alt_row_bg='#151f32',
                     header_text='#f8fafc', body_text='#e2e8f0',
                     accent='#818cf8', border_color='#334155'):
    """Style a table for dark presentation themes."""

    def _hex_rgb(h):
        h = h.lstrip('#')
        return RGBColor(int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))

    for row_idx in range(len(table.rows)):
        for col_idx in range(len(table.columns)):
            cell = table.cell(row_idx, col_idx)

            # Background
            cell.fill.solid()
            if row_idx == 0:
                cell.fill.fore_color.rgb = _hex_rgb(header_bg)
            else:
                bg = alt_row_bg if row_idx % 2 == 0 else row_bg
                cell.fill.fore_color.rgb = _hex_rgb(bg)

            # Text formatting
            for paragraph in cell.text_frame.paragraphs:
                paragraph.alignment = PP_ALIGN.LEFT
                for run in paragraph.runs:
                    run.font.name = font_name
                    run.font.size = Pt(12 if row_idx > 0 else 13)
                    run.font.bold = (row_idx == 0)
                    color = header_text if row_idx == 0 else body_text
                    run.font.color.rgb = _hex_rgb(color)

            # Vertical alignment + internal margins
            cell.vertical_anchor = MSO_ANCHOR.MIDDLE
            cell.margin_left = Inches(0.15)
            cell.margin_right = Inches(0.15)
            cell.margin_top = Inches(0.08)
            cell.margin_bottom = Inches(0.08)
```

**Light theme variant:** Use neutral-50 for background, neutral-100 for alternating rows, neutral-200 for header, neutral-800/900 for text.

---

### 4. Border Control

python-pptx tables have default borders that often clash with dark themes. Control them precisely:

```python
from pptx.oxml.ns import qn

def set_cell_border(cell, color='#334155', width_pt=0.5):
    """Set uniform thin borders on a cell."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for border_name in ['a:lnL', 'a:lnR', 'a:lnT', 'a:lnB']:
        ln = tcPr.find(qn(border_name))
        if ln is None:
            ln = tcPr.makeelement(qn(border_name), {})
            tcPr.append(ln)
        ln.set('w', str(int(width_pt * 12700)))  # points to EMU
        # Set solid fill color
        solidFill = ln.find(qn('a:solidFill'))
        if solidFill is None:
            solidFill = ln.makeelement(qn('a:solidFill'), {})
            ln.insert(0, solidFill)
        srgbClr = solidFill.find(qn('a:srgbClr'))
        if srgbClr is None:
            srgbClr = solidFill.makeelement(qn('a:srgbClr'), {})
            solidFill.append(srgbClr)
        srgbClr.set('val', color.lstrip('#'))


def remove_cell_borders(cell):
    """Remove all borders from a cell for a clean, borderless look."""
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    for border_name in ['a:lnL', 'a:lnR', 'a:lnT', 'a:lnB']:
        ln = tcPr.find(qn(border_name))
        if ln is None:
            ln = tcPr.makeelement(qn(border_name), {})
            tcPr.append(ln)
        ln.set('w', '0')
        ln.set('cap', 'flat')
        for child in list(ln):
            ln.remove(child)
        noFill = ln.makeelement(qn('a:noFill'), {})
        ln.append(noFill)


def disable_table_banding(table_shape):
    """Disable the default banding/style that PowerPoint applies to tables."""
    tbl = table_shape._element.graphic.graphicData.tbl
    tblPr = tbl.tblPr
    tblPr.set('bandRow', '0')
    tblPr.set('bandCol', '0')
    tblPr.set('firstRow', '0')
    tblPr.set('lastRow', '0')
    tblPr.set('firstCol', '0')
    tblPr.set('lastCol', '0')
    # Remove any built-in style
    tblStyle = tblPr.find(qn('a:tblStyle'))
    if tblStyle is not None:
        tblPr.remove(tblStyle)
    tblStyleId = tblPr.find(qn('a:tblStyleId'))
    if tblStyleId is not None:
        tblPr.remove(tblStyleId)
```

**Recommended approach for dark themes:** Call `disable_table_banding()` first, then apply `remove_cell_borders()` to all cells, then selectively add borders where you want them (e.g. only horizontal lines between rows, or a bottom border on the header row).

---

### 5. Row Heights and Column Widths

```python
# Set column widths
table.columns[0].width = Inches(3.0)
table.columns[1].width = Inches(2.9)
table.columns[2].width = Inches(2.9)
table.columns[3].width = Inches(2.9)

# Set row heights
table.rows[0].height = Inches(0.55)  # Header — slightly taller
for i in range(1, len(table.rows)):
    table.rows[i].height = Inches(0.65)
```

**Sizing formula:** Total width should not exceed `SLIDE_W - 2 × margin` (typically 11.7"). Row height depends on content — single-line rows at 12–13pt need ~0.5–0.65".

---

### 6. Table Composition Patterns

**Pattern A — Full-Width Table + Title:**
Table fills most of the content zone with an insight-driven title above. Best for detailed data.

```
Title (28pt bold)
┌──────────────────────────────────────────┐
│  Header │  Header │  Header │  Header    │
├──────────────────────────────────────────┤
│  Data   │  Data   │  Data   │  Data      │
│  ...    │  ...    │  ...    │  ...       │
└──────────────────────────────────────────┘
Optional caption text below
```

**Pattern B — Table + Callout Card:**
Table on the left (~65% width), key insight or summary stat card on the right. Great when one metric stands out.

**Pattern C — Table + Chart:**
Table showing detailed data on one slide, chart showing the trend/pattern on the next. Or side-by-side in a split layout if both fit.

**Pattern D — Compact Table in Split Layout:**
Smaller table as one element alongside narrative text, keeping the slide multi-dimensional.

---

### 7. Sizing Guide

| Placement  | Width | x position | Notes                            |
| ---------- | ----- | ---------- | -------------------------------- |
| Full-width | 11.7" | 0.8        | Standard, most common            |
| Two-thirds | 7.5"  | 0.8        | Left side of split layout        |
| Half-width | 5.5"  | 0.8 or 6.8 | Side-by-side with other elements |

Keep tables within the content zone (y: 1.8 to 7.0). Leave breathing room after the title.

---

### 8. Complete Example: Dark-Themed Table Slide

```python
s = blank_slide(prs)
slide_background(s, DARK_BG)

# Title
add_text(s, 0.8, 0.7, 11.7, 0.6,
         "Feature Comparison Across Tiers",
         size=28, bold=True, color=ACCENT_1, font_name=FONT)

# Create table
headers = ['Feature', 'Starter', 'Professional', 'Enterprise']
data = [
    ['Storage', '10 GB', '100 GB', 'Unlimited'],
    ['Team Members', '5', '25', 'Unlimited'],
    ['Support', 'Email (48h)', 'Priority (4h)', 'Dedicated CSM'],
    ['API Rate Limit', '1K/day', '50K/day', 'Custom'],
    ['SSO / SAML', '—', '✓', '✓'],
]

rows, cols = len(data) + 1, len(headers)
ts = slide.shapes.add_table(rows, cols,
    Inches(0.8), Inches(1.8), Inches(11.7), Inches(4.5))
table = ts.table

# Populate
for ci, h in enumerate(headers):
    table.cell(0, ci).text = h
for ri, row in enumerate(data):
    for ci, val in enumerate(row):
        table.cell(ri + 1, ci).text = val

# Style
disable_table_banding(ts)
style_table_dark(table, font_name=FONT,
    header_bg=c('slate', 800), row_bg=c('slate', 950),
    alt_row_bg=c('slate', 900), header_text=c('slate', 50),
    body_text=c('slate', 200), border_color=c('slate', 700))

# Apply borders
for ri in range(rows):
    for ci in range(cols):
        cell = table.cell(ri, ci)
        if ri == 0:
            set_cell_border(cell, c('slate', 700), 0.75)
        else:
            remove_cell_borders(cell)
            # Only bottom border for subtle row separation
            set_cell_border_side(cell, 'bottom', c('slate', 800), 0.5)

# Caption
add_text(s, 0.8, 6.5, 11.7, 0.4,
         "All plans include core platform features. Enterprise pricing available on request.",
         size=12, color=TEXT_MUTED, font_name=FONT)
```
