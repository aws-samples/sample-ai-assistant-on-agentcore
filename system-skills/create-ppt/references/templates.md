## Template Workflow (User-Provided Templates)

Load this reference when the user provides a PPTX template file to build on.

---

### 1. Template Loading & Slide Cleanup

```python
from ppt_templates import clear_template_slides, populate_placeholder, add_picture_constrained, promote_template_visuals
from pptx import Presentation

prs = Presentation('/tmp/ppt_templates/<name>/<file>.pptx')
clear_template_slides(prs)
TITLE_LAYOUT = prs.slide_layouts[0]
```

---

### 2. Adding Slides with Template Layouts

```python
slide = prs.slides.add_slide(TITLE_LAYOUT)
populate_placeholder(slide, idx=0, text="My Title", font_size=40)
populate_placeholder(slide, idx=1, text="Subtitle", font_size=20)
```

---

### 3. Background Promotion

Run **after all slides are built, before saving.** This ensures template backgrounds render correctly in exported previews and thumbnails.

```python
promote_template_visuals(prs)
prs.save('/tmp/output.pptx')
```

---

### 4. Image Placement for Templates

Use `add_picture_constrained()` instead of `safe_add_picture()`. The standard `safe_add_picture()` can produce corrupt coordinates with template-based presentations.

```python
add_picture_constrained(slide, img_path, left_in=1.0, top_in=1.7, max_w_in=10.0, max_h_in=5.0)
```

---

### 5. Template-Specific Notes

**Placeholder indices vary per layout.** Always check with `analyze_template()` before building to discover the correct indices for each layout.

**Font inheritance.** Text placed in placeholders inherits the template's font. Set `run.font.name` explicitly if you need a different font.

**Background promotion must run after all slides are built.** Calling it before all slides are added means later slides may miss the promotion.

**Analyzing a template:**

```python
from ppt_analyzer import analyze_template
report = analyze_template('/tmp/input.pptx')
# Shows: slide layouts, placeholder indices, fonts, dimensions, etc.
```
