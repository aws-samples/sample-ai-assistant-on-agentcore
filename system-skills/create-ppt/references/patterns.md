## Slide Design Patterns & Layout Ideas

Load this when planning slide variety — especially for custom-built slides.

---

### 1. The Goal

Every deck should feel intentional and varied. No two consecutive slides share the same layout. Each presentation has its own personality shaped by its topic.

---

### 2. Layout Ideas

Build these from scratch using `blank_slide()` + `add_text()`, `card()`, `rect()`, `safe_add_picture()`:

**Full-bleed image + text overlay:** Dark photo, title + 2–3 lines in white. Editorial magazine feel.

**Big number slide:** One stat (48–64pt bold) centered on pure dark bg. Single-line label beneath in muted color. No card, no container. Pure impact.

**Asymmetric layout:** Content in left two-thirds, stat callout or card on the right. Breathing room.

**Centered minimal:** Single statement centered (24–32pt). No card. For transitions or key insights.

**Left accent bar:** 0.3" vertical bar in accent color on far-left edge, content to the right.

**Data story slide:** Chart ~70% of slide, callout annotation or stat card beside the key data point.

**Card grid:** 3–6 dark cards, each with meaningful content — title, description or value, and context text. Cards defined by subtle borders and flat fills.

**Stat + context:** Large number on one side (48–60pt, accent color), explanatory text on the other (15–16pt, muted). No card needed.

**Table + callout:** Data table with a summary stat card or key insight alongside.

**Split layout with cards:** Narrative text on one side, visual content (chart, image, card group) on the other.

**Chart + narrative:** Chart with takeaway text — never a bare chart. Compose with a caption, callout stat, or context paragraph.

**Gradient background:** `create_gradient_background()` with two shades of the same family for subtle depth. Mix with flat-dark slides for variety.

**Multi-metric dashboard:** 2–3 KPI stat elements above or beside a chart, giving numbers context alongside the trend.

---

### 3. Presentation Personality

Before building, decide on a personality. Let the topic guide the choice.

| Personality      | Characteristics                                               | Default for                 |
| ---------------- | ------------------------------------------------------------- | --------------------------- |
| **Data-driven**  | Charts, tables, big numbers, clean layouts                    | Analytics, finance, reports |
| **Bold/Punchy**  | Dark backgrounds, high contrast, large type, short statements | Most topics (safe default)  |
| **Clean Modern** | Dark cards with subtle borders, structured layouts            | Professional, enterprise    |
| **Editorial**    | Full-bleed photos, minimal text, magazine-like                | Lifestyle, brand, narrative |
| **Storytelling** | Narrative flow, emotive images, quotes, progressive reveal    | Pitches, keynotes           |
| **Minimal**      | Maximum space, very few elements, understated elegance        | Design, architecture        |

Default to **Bold/Punchy** or **Clean Modern** when the topic doesn't suggest a clear personality.

---

### 4. Data Display Variety

Alternate between these patterns across a deck — don't repeat the same one consecutively.

**Large stat callouts:** 42–60pt bold numbers on dark bg, accent color. No container needed.

**KPI cards:** Dark cards with bold number + label beneath. Each KPI gets a different accent color.

**Tables:** Styled data tables with dark headers and alternating row fills. See `tables.md`.

**Comparison cards:** Two or three cards side by side. One with tinted fill (e.g. indigo-950) for the "featured" side.

**Charts:** Vary composition — freestanding, in card, with callout, on gradient, with narrative. See `charts.md`.

**Horizontal timeline:** Rail with circular nodes (see section 5).

---

### 5. Timeline Design

Use the horizontal rail pattern. Vertical list timelines waste space and resemble document formatting.

**Components:**

- Thin connecting line (0.02" height, slate-700)
- Small nodes (0.12" circles) in alternating accent colors
- Year/date above the rail (20–22pt bold, white)
- Optional sublabel (11pt, muted)
- Description below the rail (12pt, slate-400)
- Items evenly spaced across full slide width

**Implementation:**

```python
s = blank_slide(prs)
slide_background(s, DARK_BG)

add_text(s, x=0.8, y=0.7, w=11.7, h=0.7,
         text="Key Milestones", size=32, bold=True,
         color=ACCENT_1, font_name=FONT)

milestones = [
    {"year": "2020", "description": "Founded with seed funding"},
    {"year": "2021", "description": "Product-market fit achieved"},
    {"year": "2022", "description": "Series A, 50K users"},
    {"year": "2023", "description": "International expansion"},
]

n = len(milestones)
total_w = 11.7
item_w = total_w / n
rail_y = 3.8

# Horizontal rail
rect(s, 0.8 + 0.3, rail_y, total_w - 0.6, 0.02, fill_color=c('slate', 700))

from pptx.enum.shapes import MSO_SHAPE

for i, m in enumerate(milestones):
    cx = 0.8 + i * item_w + item_w / 2
    dot_color = ACCENT_1 if i % 2 == 0 else ACCENT_2

    # Circular node
    shape = s.shapes.add_shape(MSO_SHAPE.OVAL,
        Inches(cx - 0.06), Inches(rail_y - 0.04), Inches(0.12), Inches(0.12))
    shape.fill.solid()
    shape.fill.fore_color.rgb = hex_to_rgb(dot_color)
    shape.line.fill.background()

    # Year above
    add_text(s, x=cx - 0.8, y=rail_y - 1.0, w=1.6, h=0.5,
             text=m['year'], size=22, bold=True,
             color=c('slate', 50), font_name=FONT, align='center')

    # Description below
    add_text(s, x=cx - 0.8, y=rail_y + 0.4, w=1.6, h=0.9,
             text=m['description'], size=12,
             color=c('slate', 400), font_name=FONT, align='center',
             line_spacing=1.2)
```

Maximum recommended items: 6–7 per rail. For more, split across two slides.

---

### 6. Card Styling

Cards are the primary container element. Defined by subtle borders and flat fills.

**Dark border card (default):**

```python
shape = card(slide, x, y, w, h, fill_color=c('slate', 900))
shape.line.color.rgb = RGBColor(*hex_to_rgb(c('slate', 700)))
shape.line.width = Pt(0.75)
```

**Tinted card (for emphasis):**

```python
shape = card(slide, x, y, w, h, fill_color=c('indigo', 950))
shape.line.color.rgb = RGBColor(*hex_to_rgb(c('indigo', 700)))
shape.line.width = Pt(0.75)
```

**Feature card (lighter):**

```python
shape = card(slide, x, y, w, h, fill_color=c('slate', 800))
shape.line.color.rgb = RGBColor(*hex_to_rgb(c('slate', 600)))
shape.line.width = Pt(0.75)
```

**Light-mode cards:** neutral-100 or neutral-50 fills with neutral-200 borders. Ensure visible card/bg contrast.

---

### 7. What Looks Outdated vs Modern

| Outdated                                    | Modern                                               |
| ------------------------------------------- | ---------------------------------------------------- |
| Small colored indicator dots next to titles | Title stands alone — hierarchy via size/weight/color |
| Badges or tags above headings               | Let the heading speak for itself                     |
| White cards on white background             | Dark cards on dark bg; visible card/bg contrast      |
| Single accent color throughout              | 2–3 accent triad                                     |
| Light-mode everything                       | Dark-first for tech/science/data                     |
| Same layout repeated                        | Rotate through diverse patterns                      |
| Bullet-heavy text slides                    | Key phrases, visuals, tables, cards                  |
| Heavy colored card fills                    | Dark cards + subtle borders                          |
| Charts with nothing else on the slide       | Charts + takeaway text + callout stats               |
| Tiny text as the only content               | Substantive body text with clear hierarchy           |
| Never using tables                          | Tables for structured data comparisons               |
| Default blue on white                       | Topic-specific palette, dark-first                   |
| Multiple font families                      | One family, size + weight hierarchy                  |
