"""
pdf_helpers.py - Reusable PDF report generation toolkit.
Auto-loaded with the pdf-report-guidelines skill.

Usage:
    from pdf_helpers import PDFReport, THEMES, render_formula
"""

from fpdf import FPDF
from PIL import Image
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

# ═══════════════════════════════════════════════════════════════════════════════
# THEME PALETTES: (title_rgb, accent_rgb, card_bg_rgb, body_rgb)
# ═══════════════════════════════════════════════════════════════════════════════
THEMES = {
    "midnight": ((30, 39, 97), (202, 220, 252), (237, 241, 250), (51, 51, 51)),
    "forest": ((44, 95, 45), (151, 188, 98), (240, 245, 232), (51, 51, 51)),
    "coral": ((249, 97, 103), (47, 60, 126), (255, 245, 240), (51, 51, 51)),
    "terracotta": ((184, 80, 66), (167, 190, 174), (245, 240, 237), (61, 61, 61)),
    "ocean": ((6, 90, 130), (28, 114, 147), (232, 242, 247), (51, 51, 51)),
    "charcoal": ((54, 69, 79), (33, 33, 33), (242, 242, 242), (54, 69, 79)),
    "teal": ((2, 128, 144), (2, 195, 154), (230, 245, 242), (51, 51, 51)),
    "berry": ((109, 46, 70), (162, 103, 105), (245, 237, 232), (61, 61, 61)),
    "sage": ((132, 181, 159), (80, 128, 142), (237, 243, 240), (51, 51, 51)),
    "cherry": ((153, 0, 17), (47, 60, 126), (255, 245, 245), (51, 51, 51)),
}


def _rgb_to_hex(rgb):
    """Convert (R, G, B) tuple to '#RRGGBB' hex string."""
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def _luminance(rgb):
    """Perceived brightness 0-1 (NTSC formula)."""
    return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255


def _blend(c1, c2, t=0.5):
    """Linearly blend two RGB tuples. t=0 -> c1, t=1 -> c2."""
    return tuple(int(a + (b - a) * t) for a, b in zip(c1, c2))


# ═══════════════════════════════════════════════════════════════════════════════
# FORMULA RENDERING
# ═══════════════════════════════════════════════════════════════════════════════
def render_formula(latex_str, filepath, fontsize=15, dpi=250):
    """Render a LaTeX math string to PNG via matplotlib mathtext.

    Limitations: does NOT support \\begin{pmatrix}, \\begin{align}, etc.
    """
    plt.rcParams["mathtext.fontset"] = "cm"
    plt.rcParams["font.family"] = "serif"
    fig = plt.figure(figsize=(0.1, 0.1))
    fig.text(
        0.5,
        0.5,
        f"${latex_str}$",
        fontsize=fontsize,
        ha="center",
        va="center",
        color="#000000",
    )
    fig.savefig(
        filepath, dpi=dpi, bbox_inches="tight", pad_inches=0.1, transparent=True
    )
    plt.close(fig)


# ═══════════════════════════════════════════════════════════════════════════════
# MAIN REPORT CLASS
# ═══════════════════════════════════════════════════════════════════════════════
class PDFReport(FPDF):
    """Feature-rich FPDF subclass for modern, themed PDF reports."""

    COLORS = {
        "title": (26, 60, 110),
        "body": (51, 51, 51),
        "accent": (46, 125, 155),
        "card_bg": (240, 244, 248),
        "white": (255, 255, 255),
        "border": (200, 200, 200),
    }

    # ── Theme ────────────────────────────────────────────────────────────
    def set_theme(self, name):
        """Apply a named theme palette from THEMES dict."""
        if name in THEMES:
            t = THEMES[name]
            self.COLORS["title"] = t[0]
            self.COLORS["accent"] = t[1]
            self.COLORS["card_bg"] = t[2]
            self.COLORS["body"] = t[3]
            self.COLORS["border"] = _blend(t[1], (255, 255, 255), 0.6)

    def get_chart_palette(self, n=6):
        """Return theme-derived hex colors for matplotlib charts.

        Returns dict with 'primary', 'secondary', 'series' (list[str]),
        'title_hex', 'body_hex', 'card_bg_hex'.
        """
        title = self.COLORS["title"]
        accent = self.COLORS["accent"]
        white = (255, 255, 255)
        series = [
            title,
            accent,
            _blend(title, white, 0.40),
            _blend(accent, white, 0.35),
            _blend(title, accent, 0.50),
            _blend(title, (0, 0, 0), 0.25),
        ]
        while len(series) < n:
            idx = len(series) % 3
            series.append(_blend(series[idx], white, 0.2 * (len(series) // 3)))
        return {
            "primary": _rgb_to_hex(title),
            "secondary": _rgb_to_hex(accent),
            "series": [_rgb_to_hex(c) for c in series[:n]],
            "title_hex": _rgb_to_hex(title),
            "body_hex": _rgb_to_hex(self.COLORS["body"]),
            "card_bg_hex": _rgb_to_hex(self.COLORS["card_bg"]),
        }

    # ── Layout Utilities ─────────────────────────────────────────────────
    def ensure_space(self, min_mm):
        """Add a page break if fewer than min_mm mm remain above bottom margin."""
        if self.h - self.b_margin - self.get_y() < min_mm:
            self.add_page()

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")

    # ── Title Page ───────────────────────────────────────────────────────
    def add_title_page(self, title, subtitle="", author="", date="", org=""):
        """Dark header-band title page with white text."""
        self.add_page()
        band_h = 130

        # Dark header band
        self.set_fill_color(*self.COLORS["title"])
        self.rect(0, 0, 210, band_h, "F")

        # Title
        self.set_y(38)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 30)
        self.multi_cell(0, 14, title, align="C")

        # Subtitle
        if subtitle:
            self.ln(3)
            self.set_font("Helvetica", "", 15)
            self.set_text_color(210, 225, 240)
            self.cell(0, 10, subtitle, ln=True, align="C")

        # Accent divider — light color on dark band
        self.ln(4)
        acc = self.COLORS["accent"]
        line_clr = acc if _luminance(acc) > 0.40 else (255, 255, 255)
        self.set_draw_color(*line_clr)
        self.set_line_width(0.8)
        self.line(70, self.get_y(), 140, self.get_y())

        # Meta below band
        self.set_y(band_h + 20)
        self.set_text_color(*self.COLORS["body"])
        self.set_font("Helvetica", "", 13)
        meta = [p for p in [author, org, date] if p]
        if meta:
            self.cell(0, 8, "  |  ".join(meta), ln=True, align="C")

    # ── Sections ─────────────────────────────────────────────────────────
    def add_section(self, title):
        self.ln(8)
        self.set_text_color(*self.COLORS["title"])
        self.set_font("Helvetica", "B", 18)
        self.cell(0, 12, title, ln=True)
        self.set_draw_color(*self.COLORS["accent"])
        self.set_line_width(0.5)
        self.line(20, self.get_y(), 80, self.get_y())
        self.ln(6)
        self.set_text_color(*self.COLORS["body"])

    def add_subsection(self, title):
        self.ln(4)
        self.set_text_color(*self.COLORS["title"])
        self.set_font("Helvetica", "B", 14)
        self.cell(0, 10, title, ln=True)
        self.ln(2)
        self.set_text_color(*self.COLORS["body"])

    # ── Body Text ────────────────────────────────────────────────────────
    def add_body(self, text):
        self.set_font("Helvetica", "", 11)
        self.set_text_color(*self.COLORS["body"])
        self.multi_cell(0, 6, text)
        self.ln(4)

    # ── Callout Box (page-break safe) ────────────────────────────────────
    def add_callout_box(self, text, fill_color=None, min_height=30):
        """Tinted box with left accent bar. Page-break safe."""
        self.ensure_space(min_height)
        fill = fill_color or self.COLORS["card_bg"]
        y0 = self.get_y()
        x_text = 27
        old_l = self.l_margin
        self.set_left_margin(x_text)
        self.set_x(x_text)
        self.set_font("Helvetica", "", 11)
        self.set_text_color(*self.COLORS["body"])
        self.set_fill_color(*fill)
        self.multi_cell(160, 6, text, fill=True)
        box_h = self.get_y() - y0
        self.set_fill_color(*self.COLORS["accent"])
        self.rect(20, y0, 2.5, box_h, "F")
        self.set_left_margin(old_l)
        self.ln(6)

    # ── Quote / Highlight Strip ──────────────────────────────────────────
    def add_quote_strip(self, text, attribution=""):
        """Centered italic text in a tinted band with optional attribution."""
        self.ensure_space(35)
        y0 = self.get_y()

        self.set_font("Helvetica", "I", 12)
        line_count = max(1, len(text) // 70 + 1)
        text_h = line_count * 7
        strip_h = text_h + (14 if attribution else 6) + 10

        # Band
        self.set_fill_color(*self.COLORS["card_bg"])
        self.rect(20, y0, 170, strip_h, "F")

        # Quote
        self.set_xy(35, y0 + 5)
        self.set_text_color(*self.COLORS["title"])
        old_l = self.l_margin
        self.set_left_margin(35)
        self.multi_cell(140, 7, text, align="C")
        self.set_left_margin(old_l)

        # Attribution
        if attribution:
            self.set_x(35)
            self.set_font("Helvetica", "", 9)
            self.set_text_color(120, 120, 120)
            self.cell(140, 6, attribution, align="C")

        self.set_y(y0 + strip_h + 6)

    # ── KPI Strip ────────────────────────────────────────────────────────
    def add_kpi_strip(self, kpis, cols=None):
        """Row of large stat callouts. kpis: [{'label': str, 'value': str}]"""
        self.ensure_space(35)
        n = len(kpis)
        cols = cols or n
        col_w = 170 / cols
        y0 = self.get_y()
        for i, kpi in enumerate(kpis):
            x = 20 + i * col_w
            self.set_fill_color(*self.COLORS["card_bg"])
            self.rect(x + 1, y0, col_w - 2, 22, "F")
            self.set_xy(x + 1, y0 + 2)
            self.set_font("Helvetica", "B", 24)
            self.set_text_color(*self.COLORS["title"])
            self.cell(col_w - 2, 12, str(kpi["value"]), align="C")
            self.set_xy(x + 1, y0 + 14)
            self.set_font("Helvetica", "", 9)
            self.set_text_color(120, 120, 120)
            self.cell(col_w - 2, 6, kpi["label"], align="C")
        self.set_y(y0 + 28)

    # ── Indented Rich Text (write-safe pattern) ──────────────────────────
    def add_indented_rich_text(
        self,
        indent_x,
        bold_text,
        regular_text,
        bold_font_size=11,
        regular_font_size=11,
        line_height=6,
        spacing=8,
        bold_color=None,
        regular_color=None,
    ):
        """Bold + regular inline text at an indented position.
        Uses write() for both parts to avoid overflow.
        """
        bold_color = bold_color or self.COLORS["body"]
        regular_color = regular_color or self.COLORS["body"]
        old_l = self.l_margin
        self.set_left_margin(indent_x)
        self.set_x(indent_x)
        self.set_font("Helvetica", "B", bold_font_size)
        self.set_text_color(*bold_color)
        self.write(line_height, bold_text)
        self.set_font("Helvetica", "", regular_font_size)
        self.set_text_color(*regular_color)
        self.write(line_height, regular_text)
        self.ln(spacing)
        self.set_left_margin(old_l)

    # ── Labeled Item ─────────────────────────────────────────────────────
    def add_labeled_item(
        self,
        indent_x,
        indicator_color,
        label,
        description,
        label_font_size=10,
        desc_font_size=10,
        line_height=5.5,
    ):
        """Colored indicator bar + bold label + description."""
        self.ensure_space(15)
        y0 = self.get_y()
        self.set_fill_color(*indicator_color)
        self.rect(indent_x - 6, y0, 2, 6, "F")
        self.add_indented_rich_text(
            indent_x,
            label + ": ",
            description,
            label_font_size,
            desc_font_size,
            line_height,
            8,
            indicator_color,
            self.COLORS["body"],
        )

    # ── Numbered Item ────────────────────────────────────────────────────
    def add_numbered_item(
        self,
        indent_x,
        number,
        badge_color,
        label,
        description,
        label_font_size=11,
        desc_font_size=10,
        line_height=5.5,
    ):
        """Numbered badge + bold label + description."""
        self.ensure_space(15)
        y0 = self.get_y()
        badge_x = indent_x - 11
        self.set_fill_color(*badge_color)
        self.rect(badge_x, y0, 8, 7, "F")
        self.set_xy(badge_x, y0)
        self.set_text_color(255, 255, 255)
        self.set_font("Helvetica", "B", 9)
        self.cell(8, 7, str(number), align="C")
        self.add_indented_rich_text(
            indent_x,
            label + ": ",
            description,
            label_font_size,
            desc_font_size,
            line_height,
            9,
            self.COLORS["title"],
            self.COLORS["body"],
        )

    # ── Chart Embedding ──────────────────────────────────────────────────
    def add_chart(self, img_path, caption="", width=160):
        """Embed a chart image centered, with optional caption.
        Estimates image height and ensures space before embedding.
        """
        try:
            img = Image.open(img_path)
            aspect = img.size[1] / img.size[0]
            est_h = width * aspect
            est_h = max(est_h, 50)
        except Exception:
            est_h = 80
        self.ensure_space(est_h + 15)
        x = (210 - width) / 2
        self.image(img_path, x=x, w=width)
        if caption:
            self.ln(3)
            self.set_font("Helvetica", "I", 9)
            self.set_text_color(120, 120, 120)
            self.cell(0, 5, caption, ln=True, align="C")
        self.ln(6)

    # ── Table (simple) ───────────────────────────────────────────────────
    def add_table(self, headers, rows, col_widths=None, row_height=7):
        """Themed table with header band and alternating rows.
        Uses cell() — text exceeding column width is clipped.
        For wrapping cells use add_table_wrapped().
        """
        if not col_widths:
            w = (210 - 40) / len(headers)
            col_widths = [w] * len(headers)
        hdr_h = row_height + 1
        self.ensure_space(min(hdr_h + row_height * len(rows) + 8, 60))

        self.set_font("Helvetica", "B", 10)
        self.set_fill_color(*self.COLORS["title"])
        self.set_text_color(*self.COLORS["white"])
        for i, h in enumerate(headers):
            self.cell(col_widths[i], hdr_h, h, border=1, fill=True, align="C")
        self.ln()

        self.set_font("Helvetica", "", 10)
        self.set_text_color(*self.COLORS["body"])
        for ri, row in enumerate(rows):
            self.ensure_space(row_height + 2)
            bg = self.COLORS["card_bg"] if ri % 2 == 0 else self.COLORS["white"]
            self.set_fill_color(*bg)
            for i, cv in enumerate(row):
                self.cell(
                    col_widths[i], row_height, str(cv), border=1, fill=True, align="C"
                )
            self.ln()
        self.ln(4)

    def add_table_wrapped(
        self, headers, rows, col_widths=None, line_height=5.5, padding=1.5
    ):
        """Table with automatic multi-line cell wrapping.
        Row height adjusts to the tallest cell per row.
        """
        if not col_widths:
            w = (210 - 40) / len(headers)
            col_widths = [w] * len(headers)
        x_start = self.l_margin
        self.ensure_space(40)

        # Header
        self.set_font("Helvetica", "B", 10)
        self.set_fill_color(*self.COLORS["title"])
        self.set_text_color(*self.COLORS["white"])
        for i, h in enumerate(headers):
            self.cell(col_widths[i], 8, h, border=1, fill=True, align="C")
        self.ln()

        # Rows
        self.set_font("Helvetica", "", 10)
        for ri, row in enumerate(rows):
            max_lines = 1
            for i, cv in enumerate(row):
                inner_w = col_widths[i] - 2 * padding
                if inner_w > 0:
                    tw = self.get_string_width(str(cv))
                    max_lines = max(max_lines, int(tw / inner_w) + 1)
            rh = max(max_lines * line_height + 2 * padding, line_height + 2 * padding)
            self.ensure_space(rh + 2)
            bg = self.COLORS["card_bg"] if ri % 2 == 0 else self.COLORS["white"]
            y_row = self.get_y()

            for i in range(len(row)):
                x = x_start + sum(col_widths[:i])
                self.set_fill_color(*bg)
                self.set_draw_color(*self.COLORS["border"])
                self.rect(x, y_row, col_widths[i], rh, "DF")

            for i, cv in enumerate(row):
                x = x_start + sum(col_widths[:i])
                self.set_xy(x + padding, y_row + padding)
                old_l = self.l_margin
                self.set_left_margin(x + padding)
                self.set_text_color(*self.COLORS["body"])
                self.multi_cell(col_widths[i] - 2 * padding, line_height, str(cv))
                self.set_left_margin(old_l)
            self.set_y(y_row + rh)
        self.ln(4)

    # ── Formula Embedding ────────────────────────────────────────────────
    def add_formula(self, img_path, max_w=90):
        """Embed a rendered formula image in a tinted strip."""
        self.ensure_space(20)
        img = Image.open(img_path)
        pw, ph = img.size
        img_w = pw / 250 * 25.4
        img_h = ph / 250 * 25.4
        if img_w > max_w:
            s = max_w / img_w
            img_w *= s
            img_h *= s
        img_h = max(img_h, 7)
        pad = 3
        strip_h = img_h + 2 * pad
        y0 = self.get_y()
        self.set_fill_color(*self.COLORS["card_bg"])
        self.set_draw_color(*self.COLORS["border"])
        self.set_line_width(0.25)
        self.rect(20, y0, 170, strip_h, "DF")
        x = (210 - img_w) / 2
        self.image(img_path, x=x, y=y0 + (strip_h - img_h) / 2, w=img_w, h=img_h)
        self.set_y(y0 + strip_h + 4)
