## Chart Creation for PPT (Matplotlib + PIL)

### 1. Chart Slide Composition

A chart is evidence for an insight — every chart slide needs both. Before building the chart itself, decide what story it tells, then compose the slide to communicate that story.

**Required elements on every chart slide:**

| Element              | Purpose                | Implementation                       |
| -------------------- | ---------------------- | ------------------------------------ |
| Insight-driven title | Frames the takeaway    | Slide title, 28–32pt bold            |
| Chart visualization  | Shows the data         | Matplotlib PNG, transparent bg       |
| Takeaway text        | Explains the "so what" | Caption, callout card, or annotation |

**Composition patterns (pick one per chart slide, vary across the deck):**

**Pattern A — Chart + Caption (default):** Full-width chart with 1–2 sentence caption below. Good for straightforward data stories. Use `make_chart_slide()` with the `caption` parameter, or build custom with `add_text()` below the chart.

```python
# Using make_chart_slide
make_chart_slide(prs, "Enterprise Revenue Grew 40% YoY",
    chart_image_path='/tmp/revenue_chart.png',
    caption="Driven primarily by expansion in APAC markets, with average deal size increasing from $45K to $82K.")

# Custom build with more room for the takeaway
s = blank_slide(prs)
slide_background(s, DARK_BG)
add_text(s, 0.8, 0.7, 11.7, 0.6, "Enterprise Revenue Grew 40% YoY",
         size=28, bold=True, color=ACCENT_1, font_name=FONT)
safe_add_picture(s, '/tmp/revenue_chart.png', left=0.8, top=1.7, max_w=11.5, max_h=4.2)
add_text(s, 0.8, 6.1, 11.5, 0.6,
         "Driven primarily by expansion in APAC markets, with average deal size increasing from $45K to $82K.",
         size=13, color=TEXT_MUTED, font_name=FONT)
```

**Pattern B — Chart + Callout Stat:** Chart takes ~65% width on the left, a large stat + context sentence in a card on the right. Great for highlighting one number from the data.

```python
s = blank_slide(prs)
slide_background(s, DARK_BG)
add_text(s, 0.8, 0.7, 7.0, 0.6, "Customer Acquisition Accelerating",
         size=28, bold=True, color=ACCENT_1, font_name=FONT)
safe_add_picture(s, '/tmp/cac_chart.png', left=0.8, top=1.7, max_w=7.5, max_h=4.8)
# Callout card on the right
card(s, 8.8, 2.5, 3.8, 3.0, fill_color=c('slate', 900))
add_text(s, 9.1, 2.8, 3.2, 1.2, "2.4x",
         size=48, bold=True, color=ACCENT_2, font_name=FONT, align='center')
add_text(s, 9.1, 4.0, 3.2, 1.2,
         "improvement in\nacquisition efficiency\nover 12 months",
         size=14, color=TEXT_MUTED, font_name=FONT, align='center')
```

**Pattern C — Chart + Context Split:** Chart on one side, a narrative paragraph or bullet summary on the other. Best when the data needs more explanation than a single sentence.

**Pattern D — Chart on Gradient + Annotation:** Chart on a gradient-wash background with a small annotation callout near the most important data point. Editorial feel.

**Pattern E — Dual Chart:** Two half-width charts side by side, each with its own mini-caption. Use `left=0.5` and `left=6.8` to split. Good for comparisons.

With 2+ charts in a deck, use at least 2 different composition patterns.

---

### 2. Transparent Chart Backgrounds (Preferred)

Charts should use fully transparent backgrounds by default. The chart has no background at all — bars, lines, labels, and grid lines float directly on the slide surface. This creates the cleanest possible integration with gradient backgrounds, full-bleed images, and dark slide surfaces.

**Matplotlib settings:**

```python
fig, ax = plt.subplots(figsize=(10, 5.5))
fig.patch.set_alpha(0)
ax.patch.set_alpha(0)

# ... plot data ...

plt.savefig(path, dpi=200, bbox_inches='tight',
            pad_inches=0.3, transparent=True)
```

**No rounded corners needed** — there is no filled shape to clip. Skip `round_corners()` entirely.

**Place directly on slide** with `safe_add_picture()`. No card wrapper needed — the chart elements live on the slide surface natively.

**Preview limitation:** LibreOffice (used by `render_slides()`) renders transparent PNGs with a white fill. The transparency IS preserved in the PPTX and renders correctly in PowerPoint and Google Slides. To verify visually during development, use `composite_transparent_preview()` from `ppt_images.py`.

---

### 2B. Two-Tone Backgrounds (Fallback)

Use two-tone only when the slide background is too busy for transparent chart elements, or when you want an explicit card-like container.

Charts use a slightly lighter background than the slide so rounded corners are visible. This creates a natural card-like appearance without needing an actual card shape.

| Element          | Palette Reference                      | Purpose                               |
| ---------------- | -------------------------------------- | ------------------------------------- |
| Slide background | `palette['bg_dark']`                   | Darkest tone (slide surface)          |
| Chart background | `palette['card_fill']`                 | One step lighter (chart surface)      |
| Axis/spine lines | `palette['card_fill_alt']` border tone | Structural lines                      |
| Grid lines       | `c(neutral, 600)` at low alpha         | Background reference                  |
| Title text       | `palette['text_dark']`                 | Chart title (on dark = lightest text) |
| Body/label text  | `palette['text_muted']`                | Axis labels, descriptions             |
| Tick text        | `c(neutral, 500)`                      | Subdued tick marks                    |
| Legend fill      | `c(neutral, 900)`                      | Slightly darker than chart bg         |
| Legend border    | Same as spine color                    | Consistent structural tone            |
| Legend text      | `palette['text_light']`                | Readable on legend fill               |

These values derive from whatever palette is active via `set_palette()`. The neutral family comes from the palette's chosen neutral scale.

---

### 3. Rounded Corners Utility

Only needed for two-tone (opaque) charts. Skip entirely for transparent charts.

```python
from PIL import Image, ImageDraw

def round_corners(image_path, output_path, radius=60):
    """
    Clip a chart PNG to a rounded rectangle with transparent corners.
    Transparent corners let the darker slide bg show through,
    making the rounded shape visible.
    """
    img = Image.open(image_path).convert('RGBA')
    w, h = img.size
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (w - 1, h - 1)], radius=radius, fill=255)
    output = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    output.paste(img, mask=mask)
    output.save(output_path)
    return output_path
```

Rules: always use transparent corners (not solid fill). `radius=60` works well at `dpi=200` for `figsize=(10, 5.5)`. Scale proportionally for other sizes. Save as `.png` to preserve alpha.

---

### 4. Chart Constants (derive from active palette)

After `set_palette()`, derive chart constants from the same palette's neutral family. These constants are used for spine/grid/label colors regardless of whether the chart background is transparent or opaque.

```python
from ppt_colors import c

def chart_theme(neutral='slate'):
    """
    Derive all chart styling constants from the PPT palette's neutral scale.
    Call after set_palette(). Pass the same neutral family used in the palette.
    """
    return {
        'spine':     c(neutral, 700),   # axis lines
        'grid':      c(neutral, 600),   # grid lines (use with alpha)
        'title':     c(neutral, 50),    # chart title
        'label':     c(neutral, 400),   # axis labels
        'tick':      c(neutral, 500),   # tick labels
        'legend_text': c(neutral, 200), # legend label color
        'bg':        c(neutral, 900),   # only for two-tone fallback
        'legend_bg': c(neutral, 900),   # only for two-tone fallback
        'legend_edge': c(neutral, 700), # only for two-tone fallback
    }

CHART_DPI = 200
CHART_PAD = 0.4
```

---

### 5. Standard Chart Template (Transparent)

Every chart follows this skeleton by default. `ct` is the dict from `chart_theme()`.

```python
import matplotlib.pyplot as plt

fig, ax = plt.subplots(figsize=(10, 5.5))
fig.patch.set_alpha(0)
ax.patch.set_alpha(0)

# ... plot data here ...

# Title & labels
ax.set_title('Chart Title', fontsize=17, fontweight='bold',
             color=ct['title'], pad=14)
ax.set_ylabel('Y Label', fontsize=11, color=ct['label'])

# Spines
for sp in ['top', 'right']:
    ax.spines[sp].set_visible(False)
for sp in ['left', 'bottom']:
    ax.spines[sp].set_color(ct['spine'])

# Ticks & grid
ax.tick_params(colors=ct['tick'], labelsize=10)
ax.grid(axis='y', alpha=0.10, color=ct['grid'])
ax.set_axisbelow(True)

# Legend (when needed) — transparent legend bg
ax.legend(fontsize=11, facecolor='none', edgecolor='none',
          labelcolor=ct['legend_text'], loc='upper left')

# Save transparent
plt.tight_layout(pad=1.2)
plt.savefig('/tmp/chart.png', dpi=CHART_DPI,
            bbox_inches='tight', pad_inches=CHART_PAD, transparent=True)
plt.close()
```

**Fallback (two-tone) template** — use only when transparent does not work for a specific slide:

```python
fig, ax = plt.subplots(figsize=(10, 5.5), facecolor=ct['bg'])
ax.set_facecolor(ct['bg'])

# ... same plot code ...

plt.savefig('/tmp/raw.png', dpi=CHART_DPI, facecolor=ct['bg'],
            bbox_inches='tight', pad_inches=CHART_PAD)
plt.close()

round_corners('/tmp/raw.png', '/tmp/chart.png', radius=60)
```

---

### 6. Accent Colors for Data Series

Pull series colors from the deck's accent triad and `chart_series_multi()`. Match the deck's chromatic families.

```python
from ppt_colors import chart_series_multi

# Use same families as the deck's accent triad
series = chart_series_multi('indigo', 'violet', 'cyan', 'emerald', 'orange', 'pink')
# series[0] = indigo-400, series[1] = violet-400, etc.
```

For direct access in individual charts:

```python
color_primary   = c(accent_family, 400)      # matches ACCENT_1
color_secondary = c(accent_family_2, 400)    # matches ACCENT_2
color_tertiary  = c(accent_family_3, 400)    # matches ACCENT_3
```

---

### 7. Chart-Specific Notes

**Line charts:** For transparent bg, use `markeredgecolor='none'` or match marker edge to a known slide bg color. `fill_between` at `alpha=0.12` adds depth without clutter.

**Bar charts:** `zorder=3` on bars, `zorder=0` on grid so gridlines sit behind. `alpha=0.92` for subtle softness.

**Donut/Pie charts:** For transparent bg, use `wedgeprops=dict(width=0.45, edgecolor='none', linewidth=0)`. For two-tone fallback, use `edgecolor=ct['bg']` with `linewidth=3` to create visible segment gaps.

**Heatmaps (Seaborn):** `linewidths=2, linecolor=ct['bg']` for cell gaps. `sns.diverging_palette(250, 30, l=65, s=80, as_cmap=True)` for dark-friendly palette. Heatmaps generally work better with two-tone backgrounds.

**Horizontal bar charts:** Inline value labels with `ax.text()` after drawing. `ax.invert_yaxis()` so highest value appears at top.

**Stacked area charts:** Place `stackplot` first, then overlay a line for the total with markers.

---

### 8. Sizing Guide

| Placement                 | figsize     | Notes                             |
| ------------------------- | ----------- | --------------------------------- |
| Full-width on slide       | `(10, 5.5)` | Standard, fits content zone       |
| Half-width (side-by-side) | `(7, 5.5)`  | Dual-chart layouts                |
| Square (donut/pie)        | `(7, 5.5)`  | Pie/donut don't need full width   |
| Inside a card             | `(9, 5)`    | Slightly smaller for card padding |

Always `dpi=200`. Always `bbox_inches='tight'` with `pad_inches=0.4`.

---

### 9. Placement on Slides

**Transparent on slide (preferred):** Place directly with `safe_add_picture()`. No card wrapper, no rounded corners. Chart elements float on the slide surface. Works best with gradient backgrounds and dark solid backgrounds.

**Freestanding two-tone (fallback):** Place directly on slide with `safe_add_picture()`. The lighter chart bg creates an implicit card effect.

**Inside an explicit card:** Creates a double-border effect. Add 0.15–0.2" padding between card edges and chart.

**Chart + callout:** Chart ~65% width on left, stats/KPI card on right. Adds narrative to data.

**Dual chart:** Two half-width charts side by side. Use `left=0.5` and `left=6.8`.

---

### 10. Legend Placement

Place legends where they don't overlap data.

Preferred (below): `ax.legend(loc='upper center', bbox_to_anchor=(0.5, -0.12), ncol=2, frameon=False)`
Alternative (right): `ax.legend(bbox_to_anchor=(1.02, 1), loc='upper left', frameon=False)`
Always `frameon=False`.

---

### 11. Font Handling

Matplotlib may not have the deck's font installed. At session start:

```python
import matplotlib.font_manager as fm
import os

for root, dirs, files in os.walk('/tmp/inter_fonts'):
    for f in files:
        if f.endswith('.ttf') and 'Inter' in f:
            fm.fontManager.addfont(os.path.join(root, f))

fm._load_fontmanager(try_read_cache=False)
plt.rcParams['font.family'] = 'Inter'
```

If unavailable, fall back to `'DejaVu Sans'` or `'Carlito'` (installed by `ensure_fonts()`).

---

### 12. Workflow Checklist

1. `set_palette()` and define accent triad
2. `chart_theme(neutral)` with the same neutral family
3. Render each chart with `transparent=True` (preferred) or `facecolor=ct['bg']` (fallback)
4. Skip `round_corners()` for transparent charts; apply only for two-tone fallback
5. Compose the slide: insight title + chart + takeaway text
6. Place on slide with `safe_add_picture()`
7. Verify: takeaway text present and readable, chart elements have good contrast against slide bg
8. For transparent charts: use `composite_transparent_preview()` to verify if needed, or trust that PowerPoint/Google Slides will render correctly (LibreOffice previews show white fill)
