## Chart Creation for PDF Reports

### 1. Chart Section Composition

A chart in a report is evidence for a claim. Every chart section follows this pattern:

**Heading → Context → Chart → Caption → Analysis**

1. **Insight-driven heading:** "Revenue Grew 18% as Enterprise Deals Doubled" rather than "Revenue Chart"
2. **Context sentence(s):** 1–2 lines before the chart that set up what the reader should look for
3. **The chart:** matplotlib image, palette-harmonized, clean styling
4. **Figure caption:** sequential numbering via `add_chart(path, caption='Figure N: ...')`
5. **Analysis paragraph:** what the data means, why it matters, what action it implies

```python
pdf.add_section('Revenue Performance')
pdf.add_body('After restructuring the sales team in Q2, enterprise revenue began accelerating. '
             'The chart below shows quarterly performance by segment.')
pdf.add_chart('/tmp/revenue.png', caption='Figure 1: Revenue by segment, Q1–Q4 2024')
pdf.add_body('Enterprise revenue grew 18% YoY, driven primarily by expansion into the APAC region. '
             'SMB remained flat, suggesting the new pricing model has not yet gained traction in that segment.')
```

A section with just a heading and a chart image leaves the reader to draw their own conclusions, which undermines the report's analytical value.

---

### 2. Choosing the Right Chart Type

| Goal                         | Chart type          | Notes                         |
| ---------------------------- | ------------------- | ----------------------------- |
| Trends over time             | Line or Area        | ≤5 series for readability     |
| Comparing categories         | Bar (vertical)      | ≤7 categories                 |
| Proportions                  | Pie / Donut         | ≤5 categories                 |
| Multi-dimensional comparison | Radar               | ≤8 axes                       |
| Stacked compositions         | Stacked bar or area | Parts contributing to totals  |
| Ranked values                | Horizontal bar      | Good for long category labels |
| Distribution                 | Histogram           | Continuous data               |
| Correlation                  | Scatter             | Two numeric variables         |

When in doubt, use a bar chart — it's the most universally understood.

---

### 3. Matplotlib Styling for PDF

#### 3.1 Palette Integration

Always use the report's theme colors for charts. Disconnect between chart colors and report colors looks unprofessional.

```python
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

pal = pdf.get_chart_palette()
# pal['primary']     — hex, title/heading color
# pal['secondary']   — hex, accent color
# pal['series']      — list of 6 hex colors, harmonized with theme
# pal['title_hex']   — for chart title text
# pal['body_hex']    — for axis labels and tick text
# pal['card_bg_hex'] — for chart background fill
```

#### 3.2 Clean Chart Template

```python
fig, ax = plt.subplots(figsize=(7, 4))

# Style
ax.set_facecolor('#FFFFFF')
fig.patch.set_facecolor('#FFFFFF')

# Remove unnecessary spines
for sp in ['top', 'right']:
    ax.spines[sp].set_visible(False)
for sp in ['left', 'bottom']:
    ax.spines[sp].set_color('#CCCCCC')

# Light grid
ax.grid(axis='y', alpha=0.3, color='#CCCCCC')
ax.set_axisbelow(True)

# Tick styling
ax.tick_params(colors='#555555', labelsize=9)

# Title and labels
ax.set_title('Insight-Driven Title', fontsize=13, fontweight='bold',
             color=pal['title_hex'], pad=12)
ax.set_ylabel('Y Label', fontsize=10, color='#666666')

# ... plot data using pal['series'] colors ...

plt.tight_layout()
plt.savefig('/tmp/chart.png', dpi=150, bbox_inches='tight', facecolor='#FFFFFF')
plt.close()
```

#### 3.3 Rules

Always call `matplotlib.use('Agg')` BEFORE importing pyplot. Always `plt.close()` after saving. Save at `dpi=150` or higher. Use `figsize=(7, 4)` for good A4 fit. Always `tight_layout()`. No 3D effects.

Descriptive, insight-driven titles on charts. Label axes clearly. Abbreviate long labels ("Jan" not "January", "$4.2M" not "$4,200,000").

#### 3.4 Chart Type Notes

**Bar charts:** Space bars with `width=0.6` or less. Add value labels on top of bars for key values. Use `zorder=3` on bars, `zorder=0` on grid.

**Line charts:** Use markers (`marker='o'`, `markersize=5`) for data points. 2–3 series max for clarity. Add `fill_between` at low alpha for area emphasis.

**Pie/Donut:** `startangle=90`, `counterclock=False` for consistent orientation. ≤5 slices. For donut: `wedgeprops=dict(width=0.4)`. Use `autopct='%1.0f%%'`.

**Horizontal bar:** `ax.invert_yaxis()` so highest value is at top. Add inline value labels with `ax.text()`.

**Stacked bar:** Use `bottom` parameter to stack. Include a clear legend — `ax.legend(loc='upper left', frameon=False)`.

---

### 4. Legend Placement

Place legends where they don't overlap data.

Preferred (below chart): `ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.12), ncol=3, frameon=False, fontsize=9)`

Alternative (right): `ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False)`

Always `frameon=False` for clean look.

---

### 5. Mathematical Formula Rendering

```python
from pdf_helpers import render_formula

render_formula(r'\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}', '/tmp/formula.png')
pdf.add_formula('/tmp/formula.png')
```

Uses Computer Modern font, 15pt, 250 DPI, transparent background by default. Override with `fontsize` and `dpi` params. Note: matplotlib's mathtext does NOT support `\begin{pmatrix}`, `\begin{align}`, or other LaTeX environments — only inline math expressions.
