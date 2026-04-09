# Spatial Awareness & Collision Prevention

These rules prevent the most common visual bugs. Internalize them.

## Content Zone

Title area: y≈0.7, size 28–32pt bold. Content starts at y≈1.7. Content bottom: y≈7.0. This gives 5.30" of usable content height.

**Content slide titles: 28–32pt bold.** Title/closing: 36–54pt bold. Using 36pt+ on content slides pushes into the content zone — avoid it.

## Column Rules

Two-column: left x=0.8 to 6.3 (max width 5.5"), gutter 6.3–6.8 (empty), right x=6.8 to 12.5.
Three-column: 0.8–4.5, 4.9–8.6, 9.0–12.5.

Split-layout titles: constrain width to ≤5.0" so text doesn't collide with right-column elements.

## Spacing Rules

Minimum 0.5" margins from all slide edges. 0.3–0.5" between content blocks — pick one gap, use it consistently. Card content: 0.25–0.35" inset from card edges. Bottom elements end at y ≤ 7.0".

## Text Box Rules

One text box per content block — stacking separate boxes in python-pptx creates overlaps that are invisible until rendered. Use `\n\n` for paragraph breaks within a single text box. Height formula: `(lines × font_pt × line_spacing) / 72 + 0.2" padding`.

## Chart Placement

Chart inside card: `left = card_left+0.15, top = card_top+0.1, max_w = card_w-0.3, max_h = card_h-0.2`.
Chart directly on slide: use `safe_add_picture()` with generous margins.
