import sys as _sys, os as _os

_SCRIPT_DIR = (
    _os.path.dirname(_os.path.abspath(__file__))
    if "__file__" in dir()
    else next(
        (p for p in _sys.path if _os.path.isfile(_os.path.join(p, "ppt_core.py"))),
        "/tmp/skills/ppt/scripts",
    )
)
if _SCRIPT_DIR not in _sys.path:
    _sys.path.insert(0, _SCRIPT_DIR)

"""
ppt_layouts.py — Pre-built slide layout factories.

Each function creates a fully positioned slide following the header system,
collision rules, and modern design standards.

Usage:
    from ppt_core import *
    from ppt_layouts import *

    prs = init_presentation()
    make_title_slide(prs, "Q4 Review", "Performance Summary", bg_color=PALETTE['primary'])
    make_kpi_slide(prs, "Key Metrics", [
        {"label": "Revenue", "value": "$4.2M", "delta": "+12%"},
        {"label": "Users",   "value": "128K",  "delta": "+23%"},
    ])
    prs.save('/tmp/output.pptx')
"""

from ppt_core import *


# ─── Helpers ─────────────────────────────────────────────


def _luminance(hex_color):
    """Relative luminance of a hex color (0.0 = black, 1.0 = white)."""
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16) / 255, int(h[2:4], 16) / 255, int(h[4:6], 16) / 255

    def lin(c):
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)


def _is_dark_bg(hex_color):
    """Return True if the background is dark (luminance < 0.25)."""
    return _luminance(hex_color) < 0.25


def _safe_accent_on(bg_hex, fallback="#15803D"):
    """Return PALETTE['accent'] if it has ≥3.0:1 contrast on bg_hex, else fallback."""
    accent = PALETTE.get("accent", fallback)
    try:
        ratio = _contrast_ratio(accent, bg_hex)
        if ratio >= 3.0:
            return accent
    except Exception:
        pass
    return fallback


# ─── Slides ──────────────────────────────────────────────


def make_title_slide(
    prs,
    title,
    subtitle=None,
    bg_color=None,
    title_color=None,
    subtitle_color=None,
    bg_image_path=None,
):
    """Hero title slide. Large centered text on solid or image background."""
    s = blank_slide(prs)
    bg_c = bg_color or PALETTE["primary"]

    if bg_image_path:
        from ppt_images import add_full_bleed_bg

        add_full_bleed_bg(s, bg_image_path)
    else:
        slide_background(s, bg_c)

    tc = title_color or PALETTE["white"]
    add_text(
        s,
        1.0,
        2.5,
        SLIDE_W - 2.0,
        1.5,
        title,
        size=48,
        bold=True,
        color=tc,
        align="center",
    )

    if subtitle:
        sc = subtitle_color or "#CCCCCC"
        add_text(
            s,
            1.0,
            4.2,
            SLIDE_W - 2.0,
            0.8,
            subtitle,
            size=24,
            color=sc,
            align="center",
        )
    return s


def make_section_divider(
    prs,
    title,
    subtitle=None,
    bg_color=None,
    title_color=None,
    subtitle_color=None,
):
    """Section divider slide. Large title, optional subtitle."""
    s = blank_slide(prs)
    bg_c = bg_color or PALETTE["primary"]
    slide_background(s, bg_c)

    tc = title_color or PALETTE["white"]
    add_text(
        s,
        1.0,
        2.8,
        SLIDE_W - 2.0,
        1.2,
        title,
        size=44,
        bold=True,
        color=tc,
        align="center",
    )

    if subtitle:
        if subtitle_color:
            sc = subtitle_color
        elif _is_dark_bg(bg_c):
            sc = "#E0E0E0"
        else:
            sc = PALETTE.get("text_muted", "#666666")
        add_text(
            s,
            1.0,
            4.2,
            SLIDE_W - 2.0,
            0.6,
            subtitle,
            size=20,
            color=sc,
            align="center",
        )
    return s


def make_content_slide(prs, title, body_lines, badge_text=None):
    """Standard content slide with title + body text."""
    s = blank_slide(prs)

    if badge_text:
        badge(s, MARGIN_LEFT, BADGE_Y, badge_text)

    add_text(
        s,
        MARGIN_LEFT,
        TITLE_Y,
        BODY_WIDTH,
        0.5,
        title,
        size=TITLE_SIZE,
        bold=True,
        color=PALETTE["primary"],
    )

    add_multiline_text(
        s,
        MARGIN_LEFT,
        CONTENT_Y,
        BODY_WIDTH,
        CONTENT_HEIGHT,
        body_lines,
        size=16,
        color=PALETTE["text_body"],
    )
    return s


def make_split_slide(
    prs,
    title,
    body_lines,
    badge_text=None,
    right_card_fill=None,
    right_content_fn=None,
):
    """Split layout: left text column + right card/visual column."""
    s = blank_slide(prs)

    if badge_text:
        badge(s, LEFT_COL_X, BADGE_Y, badge_text)

    add_text(
        s,
        LEFT_COL_X,
        TITLE_Y,
        LEFT_COL_MAX_W,
        0.5,
        title,
        size=TITLE_SIZE,
        bold=True,
        color=PALETTE["primary"],
    )

    add_multiline_text(
        s,
        LEFT_COL_X,
        CONTENT_Y,
        LEFT_COL_MAX_W,
        CONTENT_HEIGHT,
        body_lines,
        size=16,
        color=PALETTE["text_body"],
    )

    rc_fill = right_card_fill or PALETTE["card_fill_alt"]
    card_x, card_y = RIGHT_COL_X, CONTENT_Y
    card_w = SLIDE_W - RIGHT_COL_X - MARGIN_RIGHT
    card_h = CONTENT_BOTTOM - CONTENT_Y
    card(s, card_x, card_y, card_w, card_h, fill_color=rc_fill)

    if right_content_fn:
        right_content_fn(s, card_x, card_y, card_w, card_h)
    return s


def make_kpi_slide(prs, title, kpis, badge_text=None, cols=None):
    """KPI dashboard slide with stat cards.

    Args:
        kpis: List of dicts with keys: label, value, delta (optional), color (optional)
    """
    s = blank_slide(prs)

    if badge_text:
        badge(s, MARGIN_LEFT, BADGE_Y, badge_text)

    add_text(
        s,
        MARGIN_LEFT,
        TITLE_Y,
        BODY_WIDTH,
        0.5,
        title,
        size=TITLE_SIZE,
        bold=True,
        color=PALETTE["primary"],
    )

    n = len(kpis)
    if cols is None:
        cols = min(n, 4)

    usable_w = SLIDE_W - 2 * MARGIN_LEFT
    gap = 0.4
    card_w = (usable_w - (cols - 1) * gap) / cols
    card_y_start = CONTENT_Y + 0.15
    rows = -(-n // cols)  # ceil division

    # Calculate card height respecting bottom boundary
    max_total_h = CONTENT_BOTTOM - card_y_start - 0.1
    card_h = min(2.8, (max_total_h - (rows - 1) * gap) / rows)

    for i, kpi in enumerate(kpis):
        col = i % cols
        row = i // cols
        cx = MARGIN_LEFT + col * (card_w + gap)
        cy = card_y_start + row * (card_h + gap)

        # Safety: skip if card would overflow slide
        if cy + card_h > SLIDE_H - 0.3:
            break

        card(s, cx, cy, card_w, card_h)

        add_text(
            s,
            cx + 0.3,
            cy + 0.25,
            card_w - 0.6,
            0.3,
            kpi["label"],
            size=14,
            color=PALETTE["text_muted"],
        )

        val_color = kpi.get("color", PALETTE["primary"])
        add_text(
            s,
            cx + 0.3,
            cy + 0.65,
            card_w - 0.6,
            0.8,
            kpi["value"],
            size=42,
            bold=True,
            color=val_color,
        )

        if "delta" in kpi:
            delta_str = kpi["delta"]
            if delta_str.startswith("+"):
                delta_color = _safe_accent_on(PALETTE["card_fill"])
            else:
                delta_color = "#DC2626"
            add_text(
                s,
                cx + 0.3,
                cy + 1.55,
                card_w - 0.6,
                0.3,
                delta_str,
                size=18,
                color=delta_color,
            )
    return s


def make_comparison_slide(
    prs,
    title,
    left_items,
    right_items,
    left_heading="Before",
    right_heading="After",
    badge_text=None,
    left_color=None,
    right_color=None,
):
    """Two-column comparison slide."""
    s = blank_slide(prs)

    if badge_text:
        badge(s, MARGIN_LEFT, BADGE_Y, badge_text)

    add_text(
        s,
        MARGIN_LEFT,
        TITLE_Y,
        BODY_WIDTH,
        0.5,
        title,
        size=TITLE_SIZE,
        bold=True,
        color=PALETTE["primary"],
    )

    col_w = (BODY_WIDTH - 0.6) / 2

    # Left column
    lc = left_color or PALETTE["primary"]
    card(
        s,
        MARGIN_LEFT,
        CONTENT_Y,
        col_w,
        CONTENT_HEIGHT - 0.2,
        fill_color=PALETTE["card_fill"],
    )
    add_text(
        s,
        MARGIN_LEFT + 0.3,
        CONTENT_Y + 0.2,
        col_w - 0.6,
        0.4,
        left_heading,
        size=20,
        bold=True,
        color=lc,
    )
    add_multiline_text(
        s,
        MARGIN_LEFT + 0.3,
        CONTENT_Y + 0.75,
        col_w - 0.6,
        CONTENT_HEIGHT - 1.2,
        left_items,
        size=15,
        color=PALETTE["text_body"],
        space_after_pt=8,
    )

    # Right column — auto-check contrast for heading color
    rx = MARGIN_LEFT + col_w + 0.6
    if right_color:
        rc = right_color
    else:
        rc = PALETTE["secondary"]
        try:
            if _contrast_ratio(rc, PALETTE["card_fill_alt"]) < 3.0:
                rc = PALETTE["primary"]
        except Exception:
            pass

    card(
        s,
        rx,
        CONTENT_Y,
        col_w,
        CONTENT_HEIGHT - 0.2,
        fill_color=PALETTE["card_fill_alt"],
    )
    add_text(
        s,
        rx + 0.3,
        CONTENT_Y + 0.2,
        col_w - 0.6,
        0.4,
        right_heading,
        size=20,
        bold=True,
        color=rc,
    )
    add_multiline_text(
        s,
        rx + 0.3,
        CONTENT_Y + 0.75,
        col_w - 0.6,
        CONTENT_HEIGHT - 1.2,
        right_items,
        size=15,
        color=PALETTE["text_body"],
        space_after_pt=8,
    )
    return s


def make_timeline_slide(prs, title, events, badge_text=None):
    """Vertical timeline slide.
    Args:
        events: List of dicts with keys: date, title, description (optional)
    """
    s = blank_slide(prs)

    if badge_text:
        badge(s, MARGIN_LEFT, BADGE_Y, badge_text)

    add_text(
        s,
        MARGIN_LEFT,
        TITLE_Y,
        BODY_WIDTH,
        0.5,
        title,
        size=TITLE_SIZE,
        bold=True,
        color=PALETTE["primary"],
    )

    n = len(events)
    item_h = min(1.3, (CONTENT_HEIGHT - 0.2) / n)
    line_x = MARGIN_LEFT + 1.5

    rect(s, line_x, CONTENT_Y, 0.03, n * item_h - 0.3, fill_color=PALETTE["secondary"])

    for i, evt in enumerate(events):
        ey = CONTENT_Y + i * item_h

        add_text(
            s,
            MARGIN_LEFT,
            ey,
            1.3,
            0.3,
            evt["date"],
            size=12,
            bold=True,
            color=PALETTE["primary"],
            align="right",
        )

        rect(s, line_x - 0.04, ey + 0.06, 0.11, 0.11, fill_color=PALETTE["accent"])

        add_text(
            s,
            line_x + 0.35,
            ey,
            8.0,
            0.3,
            evt["title"],
            size=16,
            bold=True,
            color=PALETTE["text_dark"],
        )

        if "description" in evt:
            add_text(
                s,
                line_x + 0.35,
                ey + 0.35,
                8.0,
                0.5,
                evt["description"],
                size=13,
                color=PALETTE["text_muted"],
            )
    return s


def make_quote_slide(
    prs,
    quote,
    attribution=None,
    bg_color=None,
    text_color=None,
    accent_color=None,
    attribution_color=None,
):
    """Centered quote slide."""
    s = blank_slide(prs)
    bg_c = bg_color or PALETTE.get("bg_white", "#FFFFFF")
    if bg_color:
        slide_background(s, bg_c)

    dark = _is_dark_bg(bg_c)
    tc = text_color or ("#FFFFFF" if dark else PALETTE["text_dark"])
    ac = accent_color or PALETTE["accent"]
    at = attribution_color or (
        "#00A896" if dark else PALETTE.get("text_muted", "#666666")
    )

    add_text(
        s,
        1.5,
        1.5,
        1.0,
        1.0,
        "\u201c",
        size=72,
        bold=True,
        color=ac,
        font_name="Georgia",
    )

    add_text(
        s,
        2.0,
        2.5,
        SLIDE_W - 4.0,
        2.5,
        quote,
        size=24,
        italic=True,
        color=tc,
        align="center",
        line_spacing=1.4,
    )

    if attribution:
        add_text(
            s,
            2.0,
            5.3,
            SLIDE_W - 4.0,
            0.5,
            f"\u2014 {attribution}",
            size=16,
            color=at,
            align="center",
        )
    return s


def make_closing_slide(
    prs,
    title="Thank You",
    subtitle=None,
    bg_color=None,
    title_color=None,
    subtitle_color=None,
    bg_image_path=None,
):
    """Closing slide. Mirrors title slide style."""
    s = blank_slide(prs)
    bg_c = bg_color or PALETTE["primary"]

    if bg_image_path:
        from ppt_images import add_full_bleed_bg

        add_full_bleed_bg(s, bg_image_path)
    else:
        slide_background(s, bg_c)

    tc = title_color or PALETTE["white"]
    add_text(
        s,
        1.0,
        2.8,
        SLIDE_W - 2.0,
        1.2,
        title,
        size=48,
        bold=True,
        color=tc,
        align="center",
    )

    if subtitle:
        if subtitle_color:
            sc = subtitle_color
        elif _is_dark_bg(bg_c):
            sc = "#E0E0E0"
        else:
            sc = PALETTE.get("text_muted", "#666666")
        add_text(
            s,
            1.0,
            4.2,
            SLIDE_W - 2.0,
            0.6,
            subtitle,
            size=20,
            color=sc,
            align="center",
        )
    return s


def make_chart_slide(
    prs,
    title,
    chart_image_path,
    badge_text=None,
    caption=None,
    full_width=True,
):
    """Slide with a chart image inside a container card."""
    from ppt_images import safe_add_picture

    s = blank_slide(prs)

    if badge_text:
        badge(s, MARGIN_LEFT, BADGE_Y, badge_text)

    add_text(
        s,
        MARGIN_LEFT,
        TITLE_Y,
        BODY_WIDTH if full_width else LEFT_COL_MAX_W,
        0.5,
        title,
        size=TITLE_SIZE,
        bold=True,
        color=PALETTE["primary"],
    )

    if full_width:
        cx, cy = MARGIN_LEFT, CONTENT_Y
        cw = BODY_WIDTH
        ch = CONTENT_HEIGHT - 0.3
    else:
        cx, cy = RIGHT_COL_X, CONTENT_Y
        cw = RIGHT_COL_MAX_W
        ch = CONTENT_HEIGHT - 0.3

    card(s, cx, cy, cw, ch)

    safe_add_picture(
        s,
        chart_image_path,
        left=cx + 0.15,
        top=cy + 0.1,
        max_w=cw - 0.3,
        max_h=ch - 0.2,
    )

    if caption:
        add_text(
            s,
            cx + 0.15,
            cy + ch - 0.35,
            cw - 0.3,
            0.3,
            caption,
            size=11,
            color=PALETTE["text_muted"],
            align="right",
        )
    return s
