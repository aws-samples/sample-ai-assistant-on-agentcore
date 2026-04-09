# Color System

The color system provides 9 neutral families and 17 chromatic families, each with 11 shades (50–950). All colors live in `ppt_colors.py`, accessed via `c(family, shade)`.

**Neutral families:** neutral, stone, zinc, slate, gray, mauve, olive, mist, taupe
**Chromatic families:** red, orange, amber, yellow, lime, green, emerald, teal, cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose

## Shade Scale Usage (Dark-First)

| Range   | Role                          | Example            |
| ------- | ----------------------------- | ------------------ |
| 950     | Deepest backgrounds           | `c('slate', 950)`  |
| 800–900 | Card fills, containers        | `c('slate', 900)`  |
| 600–700 | Borders                       | `c('slate', 700)`  |
| 400–500 | Accent colors, bright on dark | `c('indigo', 400)` |
| 300–400 | Muted text                    | `c('slate', 400)`  |
| 100–200 | Body text                     | `c('slate', 200)`  |
| 50      | Headings, primary text        | `c('slate', 50)`   |

## Shade Scale Usage (Light-First)

| Range   | Role                | Example           |
| ------- | ------------------- | ----------------- |
| 50–100  | Backgrounds         | `c('slate', 50)`  |
| 100–200 | Card fills          | `c('zinc', 100)`  |
| 200–300 | Borders             | `c('gray', 200)`  |
| 400–500 | Muted text          | `c('slate', 500)` |
| 600–700 | Accents             | `c('blue', 700)`  |
| 800–900 | Headings, dark text | `c('slate', 900)` |

## Multi-Accent Colors

Use 2–3 complementary accent colors. Primary accent for slide titles and key metrics. Secondary for supporting elements and alternating card accents. Tertiary for occasional highlights and chart series.

Rotate accents across slides to prevent monotony. In card grids, alternate accent colors. In KPI slides, give each metric its own accent.

### Recommended Triads

| Triad     | Primary     | Secondary   | Tertiary   | Best For               |
| --------- | ----------- | ----------- | ---------- | ---------------------- |
| Deep Tech | indigo-400  | violet-400  | cyan-400   | AI, SaaS, deep tech    |
| Nature    | emerald-400 | teal-400    | lime-400   | Sustainability, health |
| Warm      | orange-400  | rose-400    | amber-400  | Consumer, lifestyle    |
| Corporate | blue-400    | sky-400     | indigo-400 | Finance, enterprise    |
| Bold      | red-400     | orange-400  | yellow-400 | Startups, events       |
| Creative  | violet-400  | fuchsia-400 | pink-400   | Design, arts           |
| Calm      | teal-400    | cyan-400    | sky-400    | Wellness, education    |

## Pre-Composed Themes

Use `theme_palette(name)` or `compose_palette(neutral, accent)`:

| Theme           | Neutral + Accent | Best For               |
| --------------- | ---------------- | ---------------------- |
| corporate_blue  | slate + blue     | Finance, enterprise    |
| deep_indigo     | slate + indigo   | SaaS, AI, deep tech    |
| emerald_growth  | stone + emerald  | Sustainability, health |
| warm_rose       | gray + rose      | Consumer, lifestyle    |
| bold_orange     | neutral + orange | Startups, marketing    |
| creative_violet | zinc + violet    | Design, education      |
| calm_teal       | mist + teal      | Wellness, consulting   |
| earthy_amber    | taupe + amber    | Food, architecture     |
| fresh_cyan      | zinc + cyan      | Engineering, data      |
| nature_green    | olive + green    | Agriculture, eco       |
| luxe_purple     | mauve + purple   | Premium, beauty        |
| urgent_red      | zinc + red       | Alerts, impact         |
| sky_open        | slate + sky      | Education, non-profit  |
| lime_energy     | neutral + lime   | Fitness, youth         |

All themes support `dark_mode=True`. Default to dark mode for tech, science, data, and product topics.

## Palette Setup

```python
palette = theme_palette('deep_indigo', dark_mode=True)
set_palette(palette)
validate_palette_contrast()
init_chart_style(primary=c('indigo', 400),
                 series=chart_series_multi('indigo', 'violet', 'cyan', 'emerald'))
```
