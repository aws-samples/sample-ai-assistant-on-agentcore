---
name: create-ppt
description: Creates polished PowerPoint presentations with dark-first design, custom palettes, charts, and tables. Use when creating, designing, or generating PPTX slide decks or presentations.
---

Guidelines for creating professional, visually distinctive presentations via python-pptx. Modern, dark-first design with full creative freedom — build rich, substantive slides that communicate clearly.

## Reference Files

Read from `/tmp/skills/ppt/references/` when you need implementation details. Load them before the relevant work

| File               | When to load                           | Contents                                                                 |
| ------------------ | -------------------------------------- | ------------------------------------------------------------------------ |
| `colors.md`        | Before choosing palette or theme       | Full color system, shade scales, triads, pre-composed themes             |
| `charts.md`        | Before creating any chart              | Matplotlib styling, rounded corners, chart composition patterns, sizing  |
| `patterns.md`      | When planning slide variety and layout | Layout ideas, card styling, creative techniques, timeline code           |
| `tables.md`        | Before creating any table              | Table creation, dark-theme styling, border control, composition patterns |
| `spatial-rules.md` | When positioning elements on slides    | Content zones, column rules, spacing, text box rules, chart placement    |
| `qa-workflow.md`   | Before final save and delivery         | Automated audit, visual inspection, verification loop, content check     |
| `templates.md`     | When the user provides a PPTX template | Template loading, cleanup, placeholder mapping, background promotion     |

---

## 0. Interactive Design Brief — Ask Before You Build

**This step is mandatory.** Before creating any slides, gather the user's design preferences through a short, focused set of questions. This ensures every deck feels tailored rather than generic.

### 0.1 When to Ask

Ask the design brief questions **immediately after understanding what the presentation is about** — i.e., once you know the topic, audience, and rough scope, pause and ask design questions before writing any code.

**Skip the brief only if:** the user explicitly says something like "just pick whatever looks good", "surprise me", "use defaults", or "I don't care about styling." In that case, choose a theme that fits the topic (see the mapping in 0.4) and proceed.

### 0.2 The Questions

Present these as a single, friendly message. Do NOT ask them one at a time — group them so the user can answer in one shot. Frame them as quick choices, not open-ended essays.

---

**Here's the message template (adapt the tone naturally, don't copy verbatim):**

Before I start building, a few quick design questions so this feels like _yours_:

**1. Color vibe** — Any specific brand colors (hex codes welcome) I should use? Or pick a direction:

- Cool & techy (blues, indigos, cyans)
- Warm & energetic (oranges, ambers, roses)
- Nature & growth (greens, teals, emeralds)
- Bold & creative (violets, fuchsias, pinks)
- Corporate & neutral (slate blues, grays)
- Or name any colors you like — "dark teal and gold", "red and black", etc.

**2. Light or dark?** — Dark backgrounds feel modern and immersive. Light backgrounds feel clean and corporate. Which do you prefer? (Default: dark)

**3. Personality** — What should this deck _feel_ like?

- Data-driven & analytical
- Bold & punchy (high contrast, big statements)
- Clean & modern (structured, professional)
- Editorial (image-heavy, magazine-like)
- Storytelling (narrative flow, emotive)
- Minimal & elegant (lots of whitespace)

**4. Content style** — Should it lean heavier on charts/data, imagery, or text-driven narrative?

**5. Anything else?** — Specific font you love? A particular style you've seen and want to emulate? Company branding guidelines? Anything goes here.

---

### 0.3 Handling Answers

Users will give answers ranging from very specific ("use #1A2B3C and #FF6B35, dark mode, data-heavy") to very vague ("something professional"). Here's how to handle the spectrum:

**Specific brand colors provided →** Build a custom palette around them. Use the provided colors as accents. Pick a complementary neutral family. Validate contrast.

```python
# Example: user gives brand colors #2563EB and #F59E0B
# Map to closest families or use directly
BRAND_PRIMARY = '#2563EB'   # close to blue-600
BRAND_SECONDARY = '#F59E0B' # close to amber-400
palette = compose_palette('slate', 'blue', dark_mode=True)
set_palette(palette)
# Override accents with exact brand colors
ACCENT_1 = BRAND_PRIMARY
ACCENT_2 = BRAND_SECONDARY
```

**Color direction chosen (e.g., "warm & energetic") →** Select a matching pre-composed theme and triad from the color system.

**Vague or partial answers →** Fill gaps with smart defaults based on the topic (see 0.4), but honor whatever the user _did_ specify.

**User says "surprise me" →** Pick something that fits the topic but isn't `deep_indigo` every time. Rotate through the full theme catalog. Favor less common themes like `earthy_amber`, `luxe_purple`, `lime_energy`, `calm_teal` when the topic fits.

### 0.4 Topic → Default Theme Mapping

When the user doesn't specify colors, use the topic to pick a theme. **Do not always default to `deep_indigo`.** Use this mapping as a starting point, then vary within the category:

| Topic Area                        | Recommended Themes               | Triads               |
| --------------------------------- | -------------------------------- | -------------------- |
| AI, SaaS, developer tools         | `deep_indigo`, `fresh_cyan`      | Deep Tech            |
| Finance, enterprise, consulting   | `corporate_blue`, `sky_open`     | Corporate            |
| Sustainability, health, wellness  | `emerald_growth`, `calm_teal`    | Nature, Calm         |
| Consumer, lifestyle, marketing    | `warm_rose`, `bold_orange`       | Warm                 |
| Startups, events, launches        | `bold_orange`, `lime_energy`     | Bold                 |
| Design, arts, education           | `creative_violet`, `sky_open`    | Creative             |
| Food, architecture, craftsmanship | `earthy_amber`, `nature_green`   | Warm, Nature         |
| Premium, beauty, luxury           | `luxe_purple`, `creative_violet` | Creative             |
| Data, engineering, analytics      | `fresh_cyan`, `corporate_blue`   | Deep Tech, Corporate |
| Fitness, youth, energy            | `lime_energy`, `bold_orange`     | Bold                 |
| Non-profit, social impact         | `sky_open`, `calm_teal`          | Calm, Corporate      |

**Variety rule:** If you've used a theme recently in the conversation, pick a different one from the same category. If the category has only one option that fits, vary the accent triad instead.

### 0.5 Typography Selection

Default is still Inter, but use the user's answers to inform font choice:

| Personality             | Best Font Choices          |
| ----------------------- | -------------------------- |
| Data-driven, corporate  | IBM Plex Sans, Inter       |
| Bold, punchy, startup   | DM Sans, Plus Jakarta Sans |
| Clean, modern           | Inter, Segoe UI            |
| Editorial, storytelling | Plus Jakarta Sans, DM Sans |
| Minimal, elegant        | Inter, IBM Plex Sans       |
| Creative, playful       | DM Sans, Plus Jakarta Sans |

### 0.6 Confirming the Brief

After the user answers, briefly confirm the design direction in one sentence before you start building. This lets them course-correct early:

> _"Got it — I'll go with a dark theme using teal and cyan accents, clean modern feel, data-heavy with charts. Building it now."_

Then proceed to Section 1 onward.

---

## 1. Design Philosophy

### 1.1 Core Rules

Every slide should be rich and substantive — clean does not mean sparse. A slide with just a chart and nothing else, or a few words of tiny text, is an incomplete slide.

**Dark-first by default.** Dark backgrounds (slate-950, indigo-950) with light text and bright accents. Default for tech, science, data, product, and creative topics. Reserve light themes for corporate finance, healthcare, education, or when the user explicitly requests it.

**60/30/10 color distribution.** 60% neutral (backgrounds, body text), 30% complementary (card fills, borders, muted text), 10% accent (key numbers, highlights). If accent color covers more than ~10% of a slide, you've over-saturated.

**Typographic hierarchy only.** Size > Weight > Color > Space — these four tools create all visual hierarchy. No decorative indicators, badges, or embellishments.

**Rounded shape language.** Cards use visibly rounded corners. Sharp-cornered small elements look dated.

**Borders over shadows.** Separate elements with subtle 0.75pt borders (slate-700 on dark, neutral-200 on light) rather than heavy fills or drop shadows.

**Two font weights only.** Regular for body, Bold for headings and emphasis. No light, no extra-bold.

**Flat and subtle.** Cards defined by thin borders or very subtle background shifts, not heavy colored fills or gradients.

**One typeface per deck.** Differentiate through size and weight, not by switching font families.

**Gradient depth.** Use gradient background washes on 30–50% of slides for subtle depth variation.

### 1.2 Banned Decorative Elements

Do NOT use any of these — they clutter the design without adding information:

- Small colored circle/dot indicators next to card titles or list items
- Badge/tag labels above headings (the `badge()` function, pill shapes for categories)
- Accent bars on cards or accent underlines on titles
- Divider lines between sections — use white space instead
- Heavy colored card fills or gradient fills on cards
- Multiple font families in one deck

The only acceptable `rect()` uses: full-height accent bar on a slide edge (structural), background zone fills, timeline rail line, and cards via `card()`.

### 1.3 Slide Richness

Each slide should deliver substantive content:

- **Chart slides** always include: an insight-driven title, the chart itself, AND a takeaway sentence or callout stat. A bare chart alone is never a finished slide.
- **Data slides** combine key metrics with supporting context — numbers tell what happened, text tells why it matters.
- **Content slides** have meaningful body text with clear visual hierarchy, not just a few words in tiny font.
- **Use tables** when presenting comparisons, specifications, feature matrices, pricing tiers, or any structured data. Read `references/tables.md`.
- **Multi-element compositions** — combine charts + callout cards, tables + narrative text, metrics + explanatory context. Single-element slides are often too sparse.

### 1.4 Visual Variety

No two consecutive slides should share the same layout structure. Vary your approach: full-width compositions, split layouts, card grids, full-bleed images, hero numbers, tables, charts with callouts.

Build 1–2 "surprise" slides per deck that break the pattern — a big number on pure dark, a full-bleed image, or a single provocative statement in large type.

---

## 2. Color System

The color system provides 9 neutral and 17 chromatic families, each with 11 shades (50–950). All colors accessed via `c(family, shade)` from `ppt_colors.py`.

**Read `references/colors.md`** for full shade-usage scales, multi-accent triads, and pre-composed themes.

Quick setup:

```python
palette = theme_palette('deep_indigo', dark_mode=True)
set_palette(palette)
validate_palette_contrast()
init_chart_style(primary=c('indigo', 400),
                 series=chart_series_multi('indigo', 'violet', 'cyan', 'emerald'))
```

**Important:** The palette and accent choices must reflect the user's answers from the Design Brief (Section 0). Do not hardcode `deep_indigo` — use the theme selected during the brief.

---

## 3. Typography

Use a modern, geometric or neo-grotesque sans-serif. One font family per deck.

**Fonts (preference order):** Inter, DM Sans, Plus Jakarta Sans, IBM Plex Sans, Segoe UI (safe), Calibri (fallback). Use `ensure_fonts()` at session start. **Select based on the personality chosen in the Design Brief (Section 0.5).**

**Type scale — 4 sizes, 2 weights:**

| Role    | Size    | Weight  | On dark bg         | Use                         |
| ------- | ------- | ------- | ------------------ | --------------------------- |
| Display | 36–54pt | Bold    | slate-50 / white   | Title + closing slides only |
| Heading | 28–32pt | Bold    | accent or slate-50 | Content slide titles        |
| Body    | 14–16pt | Regular | slate-200          | Paragraphs, descriptions    |
| Caption | 10–13pt | Regular | slate-400/500      | Labels, footnotes           |

Left-align body text. Center only display titles and hero text. Line spacing 1.3–1.4 for body text. Muted text (slate-400 on dark, neutral-500 on light) is a key hierarchy tool.

---

## 4. Script Toolkit

### 4.1 Loading

```python
import sys
sys.path.insert(0, '/tmp/skills/ppt/scripts')
from ppt_fonts import ensure_fonts
ensure_fonts()

from ppt_core import *
from ppt_colors import c, compose_palette, theme_palette, chart_series, chart_series_multi, list_themes
from ppt_charts import init_chart_style, create_bar_chart, create_line_chart, create_pie_chart, create_donut_chart, create_horizontal_bar, create_stacked_bar
from ppt_images import download_image, prepare_background, add_full_bleed_bg, safe_add_picture, create_gradient_background
from ppt_qa import full_audit, render_slides, render_thumbnail_grid
```

### 4.2 Module Reference

| Module          | Purpose                  | Key Functions                                                                                                                                                                                      |
| --------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ppt_core`      | Constants, helpers       | `init_presentation()`, `blank_slide()`, `add_text()`, `add_multiline_text()`, `card()`, `rect()`, `set_palette()`, `validate_palette_contrast()`, `slide_background()`, `hex_to_rgb()`             |
| `ppt_colors`    | Color system             | `c()`, `compose_palette()`, `theme_palette()`, `chart_series()`, `chart_series_multi()`, `list_themes()`                                                                                           |
| `ppt_charts`    | Matplotlib charts        | `init_chart_style()`, `create_bar_chart()`, `create_line_chart()`, `create_pie_chart()`, `create_donut_chart()`, `create_horizontal_bar()`, `create_stacked_bar()` — all accept `pad_inches` param |
| `ppt_images`    | Image handling           | `download_image()`, `prepare_background()`, `create_gradient_background()`, `add_full_bleed_bg()`, `safe_add_picture()`, `create_placeholder_image()`, `composite_transparent_preview()`           |
| `ppt_qa`        | Validation + preview     | `validate_layout()`, `check_font_compliance()`, `check_min_font_size()`, `check_contrast_ratios()`, `check_content_zone()`, `full_audit()`, `render_slides()`, `render_thumbnail_grid()`           |
| `ppt_layouts`   | Optional slide shortcuts | `make_title_slide()`, `make_section_divider()`, `make_content_slide()`, `make_kpi_slide()`, `make_chart_slide()`, `make_closing_slide()`, etc. — use when convenient, not required                 |
| `ppt_analyzer`  | Read/inspect PPTX        | `read_metadata()`, `read_all_text()`, `read_slide_notes()`, `extract_images()`, `inspect_shapes()`, `analyze_template()`                                                                           |
| `ppt_modifier`  | Update PPTX              | `replace_text()`, `replace_image()`, `delete_slides()`, `reorder_slides()`, `duplicate_slide()`, `update_font_globally()`, `update_colors()`, `add_slide_numbers()`                                |
| `ppt_templates` | Template utilities       | `clear_template_slides()`, `populate_placeholder()`, `add_picture_constrained()`, `promote_template_visuals()`                                                                                     |
| `ppt_fonts`     | Font installation        | `ensure_fonts()`                                                                                                                                                                                   |

### 4.3 Building Approach

Build slides from scratch using `blank_slide()` + primitives (`add_text()`, `add_multiline_text()`, `card()`, `rect()`, `slide_background()`, `safe_add_picture()`). This gives full creative control over every element's position, size, and styling.

`ppt_layouts` functions are optional convenience shortcuts — `make_title_slide()` and `make_closing_slide()` can save time for bookend slides. For content slides, building custom layouts is the default.

### 4.4 New Deck Workflow

```python
# 0. Apply choices from the Design Brief
#    THEME_NAME, DARK_MODE, FONT, TRIAD, PERSONALITY — all set from user answers

# 1. Choose palette, validate, configure charts
palette = theme_palette(THEME_NAME, dark_mode=DARK_MODE)
set_palette(palette)
validate_palette_contrast()
init_chart_style(primary=c(TRIAD[0], 400),
                 series=chart_series_multi(*TRIAD))

# 2. Define constants from brief
ACCENT_1, ACCENT_2, ACCENT_3 = c(TRIAD[0], 400), c(TRIAD[1], 400), c(TRIAD[2], 400)
DARK_BG = c('slate', 950)
TEXT_WHITE = c('slate', 50)
TEXT_BODY = c('slate', 200)
TEXT_MUTED = c('slate', 400)

# 3. Create gradient backgrounds for variety
create_gradient_background('/tmp/grad1.png',
    hex_to_rgb(c('slate', 950)), hex_to_rgb(c(TRIAD[0], 950)))
create_gradient_background('/tmp/grad2.png',
    hex_to_rgb(c('slate', 950)), hex_to_rgb(c(TRIAD[1], 950)))

# 4. Build slides with creative freedom
prs = init_presentation()
# ... build slides ...

# 5. Save + QA — read references/qa-workflow.md for full process
prs.save('/tmp/output.pptx')
issues = full_audit('/tmp/output.pptx')
render_thumbnail_grid('/tmp/output.pptx', '/tmp/grid.png', cols=3)
```

### 4.5 Modifying Existing Deck

```python
from ppt_analyzer import analyze_template, read_all_text
from ppt_modifier import replace_text, update_font_globally, update_colors
report = analyze_template('/tmp/input.pptx')
replace_text('/tmp/input.pptx', '/tmp/v2.pptx', 'DRAFT', 'FINAL')
update_font_globally('/tmp/v2.pptx', '/tmp/v3.pptx', new_font='Inter')
full_audit('/tmp/v3.pptx')
```

### 4.6 API Quick Reference — Coordinate Convention

**CRITICAL: All helper functions accept raw float values in inches.** They call `Inches()` internally. Do NOT pass `Inches()` objects — this causes double-wrapping and element positions in the millions of inches, triggering overflow audit errors.

```python
# ✓ CORRECT — raw floats
add_text(slide, 0.8, 1.7, 11.0, 0.5, "Hello", size=28, bold=True, color='#FFFFFF')
card(slide, 0.8, 1.7, 5.0, 3.0, fill_color='#1e293b', border=True)
rect(slide, 0, 0, 13.333, 7.5, fill_color='#020617')
safe_add_picture(slide, '/tmp/img.png', 1.0, 1.7, 10.0, 5.0)

# ✗ WRONG — Inches() objects will be double-wrapped
add_text(slide, Inches(0.8), Inches(1.7), Inches(11.0), ...)
card(slide, Inches(0.8), Inches(1.7), ...)
```

**Function signatures (all positions are raw floats in inches):**

| Function             | Signature                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_text`           | `(slide, x, y, w, h, text, size=16, bold=False, italic=False, color=None, font_name='Calibri', align='left', valign='top', line_spacing=1.05)` |
| `add_multiline_text` | `(slide, x, y, w, h, lines, size=16, bold=False, color=None, font_name='Calibri', line_spacing=1.15, space_after_pt=6)`                        |
| `card`               | `(slide, x, y, w, h, fill_color=None, corner_radius=0.15, border=False, border_color=None, border_width=0.75)`                                 |
| `rect`               | `(slide, x, y, w, h, fill_color=None, border=False)`                                                                                           |
| `safe_add_picture`   | `(slide, img_path, left, top, max_w, max_h=None, footer_margin=0.5)`                                                                           |
| `slide_background`   | `(slide, color)`                                                                                                                               |
| `add_full_bleed_bg`  | `(slide, image_path)` — no position params, always fills slide                                                                                 |

**Parameter conventions:**

- **`size`** — plain number in points, not `Pt()`. E.g. `size=28`, not `size=Pt(28)`. Alias `font_size` also accepted.
- **`align`** — string: `'left'`, `'center'`, `'right'`. Also accepts `PP_ALIGN` enum values. Alias `alignment` also accepted.
- **`color` / `fill_color`** — hex string `'#RRGGBB'` or `RGBColor` object.
- **`border`** — must be `True` to show a border; defaults to `False` (invisible line).

**Chart function signatures:**

| Function                | Signature                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `create_line_chart`     | `(categories, series, title='', output_path=None, figsize=(10, 5.5), ylabel='', xlabel='', show_markers=True, show_values=False, value_fmt='{:.0f}', fill=False)`  |
| `create_bar_chart`      | `(categories, series, title='', output_path=None, figsize=(10, 5.5), ylabel='', xlabel='', show_values=True, value_fmt='{:.0f}', horizontal=False, stacked=False)` |
| `create_horizontal_bar` | `(categories, values, title='', output_path=None, figsize=(10, 5.5), xlabel='', show_values=True, value_fmt='{:.0f}', sort=True)`                                  |
| `create_donut_chart`    | `(labels, values, title='', output_path=None, figsize=(7, 5.5), center_text=None, center_subtext=None)`                                                            |
| `create_pie_chart`      | `(labels, values, title='', output_path=None, figsize=(7, 5.5), show_pct=True, pct_fmt='%.1f%%', explode_index=None)`                                              |
| `create_stacked_bar`    | `(categories, series, title='', output_path=None, figsize=(10, 5.5), ylabel='', show_values=False, value_fmt='{:.0f}')`                                            |

Note: `series` is a dict `{'label': [values]}` for multi-series charts. `create_horizontal_bar` takes a flat `values` list instead.

---

## 5. Spatial Awareness

Read `references/spatial-rules.md` for complete positioning rules. Key boundaries:

**Content zone:** Title at y≈0.7 (28–32pt bold). Content starts y≈1.7, ends y≈7.0 (5.30" usable height). Content slide titles must be 28–32pt — using 36pt+ pushes into the content zone.

**Margins:** Minimum 0.5" from all slide edges. 0.3–0.5" between content blocks.

**Text boxes:** One text box per content block — stacking separate boxes creates invisible overlaps. Use `\n\n` for paragraph breaks within a single box.

---

## 6. Charts

Read `references/charts.md` before creating any chart.

Every chart slide communicates an insight, not just data. Include: insight-driven title, the chart, and a takeaway sentence or callout stat.

**Charts use transparent backgrounds by default.** To use an opaque background instead, pass background='#FFFFFF' (or any hex color) to init_chart_style().

---

## 7. Tables

Read `references/tables.md` before creating any table. Tables are a first-class content element for structured data, comparisons, and specifications.

```python
from pptx.util import Inches, Pt
rows, cols = 5, 4
table_shape = slide.shapes.add_table(rows, cols,
    Inches(0.8), Inches(1.8), Inches(11.7), Inches(4.5))
table = table_shape.table
# See tables.md for dark-theme styling
```

---

## 8. Images

**Sourcing:** `tavily_search(query="high quality [topic] photo", include_images=True)`. Download with `download_image()`.

**Background prep:** `prepare_background(input, output, darkness=0.5-0.65, tint_color=(r,g,b), blur=1-2)` — crops to 16:9, darkens, tints, blurs. Place with `add_full_bleed_bg(slide, path)`.

**Content images:** Use `safe_add_picture()` for bounding-box constrained placement. For template-based presentations, use `add_picture_constrained()`.

**Gradient backgrounds:** `create_gradient_background(output, (r1,g1,b1), (r2,g2,b2))`. Use on 30–50% of slides.

---

## 9. Accessibility & Contrast

**WCAG minimums:** Normal text (<18pt): 4.5:1. Large text (≥18pt or ≥14pt bold): 3:1.

**Dark-first safe combos:** body (slate-200) on bg (slate-950), muted (slate-400) on bg for large text only (slate-300 for small), accents (indigo/violet/cyan-400) on bg, card text (slate-50) on card (slate-900).

**Light-mode safe combos:** body (neutral-700/800) on white, muted (neutral-500) on white, accents (chromatic 600+) on white.

Avoid chromatic shades 300 and below as text. Never use color as sole information channel. After `set_palette()`, call `validate_palette_contrast()` and fix flagged issues before building.

---

## 10. QA Workflow

Assume there are problems. Read `references/qa-workflow.md` for the full process.

**Minimum required:** Run `full_audit()` after saving. Render with `render_thumbnail_grid()`. Visually inspect. Fix issues and re-render at least once before finishing.

```python
prs.save('/tmp/output.pptx')
issues = full_audit('/tmp/output.pptx')
grid = render_thumbnail_grid('/tmp/output.pptx', '/tmp/grid.png', cols=3)
# Inspect → Fix → Re-render → Verify
```

---

## 11. Dependencies

Required packages (pre-installed in the standard environment):

```python
# Verify at session start if needed
import pptx           # python-pptx — slide generation
import matplotlib     # Chart rendering
from PIL import Image # Image processing
import requests       # Image downloading
```

---

## 12. Quick Reference

| Item                   | Value                                    |
| ---------------------- | ---------------------------------------- |
| Slide size             | 13.333 × 7.5 in                          |
| Title area             | y ≈ 0.7                                  |
| Content zone           | 1.70–7.00 (5.30" usable)                 |
| Display                | 36–54pt bold, centered                   |
| Heading                | 28–32pt bold                             |
| Body                   | 14–16pt regular, left-aligned            |
| Caption                | 10–13pt regular                          |
| Font weights           | 2 only: Bold + Regular                   |
| Color split            | 60% neutral / 30% comp / 10% accent      |
| Default theme          | Dark-first (unless brief says otherwise) |
| Card (dark)            | slate-900 + 0.75pt slate-700 border      |
| Card (light)           | neutral-100 + 1pt neutral-200 border     |
| Two-col gutter         | left ≤ 6.3, right ≥ 6.8                  |
| Margins                | ≥ 0.5" from edges                        |
| Accents                | 2–3 complementary triad                  |
| Gradients              | 30–50% of slides                         |
| Decorative dots/badges | Never use                                |
| Tables                 | Use for structured data                  |
| Coordinates            | Raw floats in inches — never Inches()    |
| Size params            | Plain numbers in points — never Pt()     |
| **Design Brief**       | **Mandatory before building**            |

---
