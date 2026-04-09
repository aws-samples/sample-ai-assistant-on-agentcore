# QA Workflow

Assume there are problems. The first render is almost never correct.

## Automated Audit

```python
issues = full_audit('/tmp/output.pptx')
```

Fix all ERRORs. Review WARNINGs. Safe to ignore: caption/label FONT_TOO_SMALL (10–13pt for muted text is intentional), OVERLAP on full-bleed image backgrounds, OVERLAP when chart is inside a card, FONT_NOT_ALLOWED for Inter.

## Visual Inspection

```python
paths = render_slides('/tmp/output.pptx', dpi=150)
grid = render_thumbnail_grid('/tmp/output.pptx', '/tmp/grid.png', cols=3)
```

Look for: overlapping elements, text overflow, margins < 0.5", misaligned columns, low-contrast text, chart bleeding, legend overlap, monotonous layouts, white-on-white cards, cards without visible rounded corners, chart slides missing takeaway text, slides that feel sparse or under-populated.

## Verification Loop

Generate → Render → Inspect → Fix → Re-render → Verify. Complete at least one fix-and-verify cycle before finishing.

## Content Check

```python
from ppt_analyzer import read_all_text
entries = read_all_text('/tmp/output.pptx')
for e in entries:
    print(f"Slide {e['slide']}: {e['text'][:80]}")
```
