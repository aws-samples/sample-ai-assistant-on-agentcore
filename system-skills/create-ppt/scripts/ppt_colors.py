"""
ppt_colors.py — Color system for PPT presentations.
Provides color scales, pre-composed themes, and palette composition utilities.

Color families:
  Neutrals (9): neutral, stone, zinc, slate, gray, mauve, olive, mist, taupe
  Chromatic (17): red, orange, amber, yellow, lime, green, emerald, teal,
                   cyan, sky, blue, indigo, violet, purple, fuchsia, pink, rose
"""

# ─── Color Scales ────────────────────────────────────────────────────────────

COLORS = {
    "neutral": {
        50: "#fafafa",
        100: "#f5f5f5",
        200: "#e5e5e5",
        300: "#d4d4d4",
        400: "#a3a3a3",
        500: "#737373",
        600: "#525252",
        700: "#404040",
        800: "#262626",
        900: "#171717",
        950: "#0a0a0a",
    },
    "stone": {
        50: "#fafaf9",
        100: "#f5f5f4",
        200: "#e7e5e4",
        300: "#d6d3d1",
        400: "#a8a29e",
        500: "#78716c",
        600: "#57534e",
        700: "#44403c",
        800: "#292524",
        900: "#1c1917",
        950: "#0c0a09",
    },
    "zinc": {
        50: "#fafafa",
        100: "#f4f4f5",
        200: "#e4e4e7",
        300: "#d4d4d8",
        400: "#a1a1aa",
        500: "#71717a",
        600: "#52525b",
        700: "#3f3f46",
        800: "#27272a",
        900: "#18181b",
        950: "#09090b",
    },
    "slate": {
        50: "#f8fafc",
        100: "#f1f5f9",
        200: "#e2e8f0",
        300: "#cbd5e1",
        400: "#94a3b8",
        500: "#64748b",
        600: "#475569",
        700: "#334155",
        800: "#1e293b",
        900: "#0f172a",
        950: "#020617",
    },
    "gray": {
        50: "#f9fafb",
        100: "#f3f4f6",
        200: "#e5e7eb",
        300: "#d1d5db",
        400: "#9ca3af",
        500: "#6b7280",
        600: "#4b5563",
        700: "#374151",
        800: "#1f2937",
        900: "#111827",
        950: "#030712",
    },
    "mauve": {
        50: "#fafafb",
        100: "#f4f2f6",
        200: "#e5e1e8",
        300: "#d0c9d5",
        400: "#a69bae",
        500: "#81758b",
        600: "#675d70",
        700: "#524959",
        800: "#3d3642",
        900: "#2a252e",
        950: "#161218",
    },
    "olive": {
        50: "#f9faf9",
        100: "#f1f4f2",
        200: "#dee5e0",
        300: "#c4cfc8",
        400: "#94a599",
        500: "#6c8072",
        600: "#56675b",
        700: "#435147",
        800: "#313c35",
        900: "#222a24",
        950: "#101512",
    },
    "mist": {
        50: "#f9fafb",
        100: "#f0f4f5",
        200: "#dce5e6",
        300: "#c1cfd2",
        400: "#8da5a9",
        500: "#648085",
        600: "#4f676b",
        700: "#3d5155",
        800: "#2d3c3f",
        900: "#1e2a2c",
        950: "#0e1517",
    },
    "taupe": {
        50: "#fbfaf9",
        100: "#f5f3f0",
        200: "#e7e2dc",
        300: "#d3cbc0",
        400: "#aa9e8d",
        500: "#867865",
        600: "#6c6050",
        700: "#554b3e",
        800: "#40382d",
        900: "#2c271f",
        950: "#17130e",
    },
    "red": {
        50: "#fef2f2",
        100: "#fee2e2",
        200: "#fecaca",
        300: "#fca5a5",
        400: "#f87171",
        500: "#ef4444",
        600: "#dc2626",
        700: "#b91c1c",
        800: "#991b1b",
        900: "#7f1d1d",
        950: "#450a0a",
    },
    "orange": {
        50: "#fff7ed",
        100: "#ffedd5",
        200: "#fed7aa",
        300: "#fdba74",
        400: "#fb923c",
        500: "#f97316",
        600: "#ea580c",
        700: "#c2410c",
        800: "#9a3412",
        900: "#7c2d12",
        950: "#431407",
    },
    "amber": {
        50: "#fffbeb",
        100: "#fef3c7",
        200: "#fde68a",
        300: "#fcd34d",
        400: "#fbbf24",
        500: "#f59e0b",
        600: "#d97706",
        700: "#b45309",
        800: "#92400e",
        900: "#78350f",
        950: "#451a03",
    },
    "yellow": {
        50: "#fefce8",
        100: "#fef9c3",
        200: "#fef08a",
        300: "#fde047",
        400: "#facc15",
        500: "#eab308",
        600: "#ca8a04",
        700: "#a16207",
        800: "#854d0e",
        900: "#713f12",
        950: "#422006",
    },
    "lime": {
        50: "#f7fee7",
        100: "#ecfccb",
        200: "#d9f99d",
        300: "#bef264",
        400: "#a3e635",
        500: "#84cc16",
        600: "#65a30d",
        700: "#4d7c0f",
        800: "#3f6212",
        900: "#365314",
        950: "#1a2e05",
    },
    "green": {
        50: "#f0fdf4",
        100: "#dcfce7",
        200: "#bbf7d0",
        300: "#86efac",
        400: "#4ade80",
        500: "#22c55e",
        600: "#16a34a",
        700: "#15803d",
        800: "#166534",
        900: "#14532d",
        950: "#052e16",
    },
    "emerald": {
        50: "#ecfdf5",
        100: "#d1fae5",
        200: "#a7f3d0",
        300: "#6ee7b7",
        400: "#34d399",
        500: "#10b981",
        600: "#059669",
        700: "#047857",
        800: "#065f46",
        900: "#064e3b",
        950: "#022c22",
    },
    "teal": {
        50: "#f0fdfa",
        100: "#ccfbf1",
        200: "#99f6e4",
        300: "#5eead4",
        400: "#2dd4bf",
        500: "#14b8a6",
        600: "#0d9488",
        700: "#0f766e",
        800: "#115e59",
        900: "#134e4a",
        950: "#042f2e",
    },
    "cyan": {
        50: "#ecfeff",
        100: "#cffafe",
        200: "#a5f3fc",
        300: "#67e8f9",
        400: "#22d3ee",
        500: "#06b6d4",
        600: "#0891b2",
        700: "#0e7490",
        800: "#155e75",
        900: "#164e63",
        950: "#083344",
    },
    "sky": {
        50: "#f0f9ff",
        100: "#e0f2fe",
        200: "#bae6fd",
        300: "#7dd3fc",
        400: "#38bdf8",
        500: "#0ea5e9",
        600: "#0284c7",
        700: "#0369a1",
        800: "#075985",
        900: "#0c4a6e",
        950: "#082f49",
    },
    "blue": {
        50: "#eff6ff",
        100: "#dbeafe",
        200: "#bfdbfe",
        300: "#93c5fd",
        400: "#60a5fa",
        500: "#3b82f6",
        600: "#2563eb",
        700: "#1d4ed8",
        800: "#1e40af",
        900: "#1e3a8a",
        950: "#172554",
    },
    "indigo": {
        50: "#eef2ff",
        100: "#e0e7ff",
        200: "#c7d2fe",
        300: "#a5b4fc",
        400: "#818cf8",
        500: "#6366f1",
        600: "#4f46e5",
        700: "#4338ca",
        800: "#3730a3",
        900: "#312e81",
        950: "#1e1b4b",
    },
    "violet": {
        50: "#f5f3ff",
        100: "#ede9fe",
        200: "#ddd6fe",
        300: "#c4b5fd",
        400: "#a78bfa",
        500: "#8b5cf6",
        600: "#7c3aed",
        700: "#6d28d9",
        800: "#5b21b6",
        900: "#4c1d95",
        950: "#1e1b4b",
    },
    "purple": {
        50: "#faf5ff",
        100: "#f3e8ff",
        200: "#e9d5ff",
        300: "#d8b4fe",
        400: "#c084fc",
        500: "#a855f7",
        600: "#9333ea",
        700: "#7e22ce",
        800: "#6b21a8",
        900: "#581c87",
        950: "#3b0764",
    },
    "fuchsia": {
        50: "#fdf4ff",
        100: "#fae8ff",
        200: "#f5d0fe",
        300: "#f0abfc",
        400: "#e879f9",
        500: "#d946ef",
        600: "#c026d3",
        700: "#a21caf",
        800: "#86198f",
        900: "#701a75",
        950: "#4a044e",
    },
    "pink": {
        50: "#fdf2f8",
        100: "#fce7f3",
        200: "#fbcfe8",
        300: "#f9a8d4",
        400: "#f472b6",
        500: "#ec4899",
        600: "#db2777",
        700: "#be185d",
        800: "#9d174d",
        900: "#831843",
        950: "#500724",
    },
    "rose": {
        50: "#fff1f2",
        100: "#ffe4e6",
        200: "#fecdd3",
        300: "#fda4af",
        400: "#fb7185",
        500: "#f43f5e",
        600: "#e11d48",
        700: "#be123c",
        800: "#9f1239",
        900: "#881337",
        950: "#4c0519",
    },
}

# Neutral family names (for validation)
NEUTRALS = {
    "neutral",
    "stone",
    "zinc",
    "slate",
    "gray",
    "mauve",
    "olive",
    "mist",
    "taupe",
}

# Chromatic family names
CHROMATICS = {
    "red",
    "orange",
    "amber",
    "yellow",
    "lime",
    "green",
    "emerald",
    "teal",
    "cyan",
    "sky",
    "blue",
    "indigo",
    "violet",
    "purple",
    "fuchsia",
    "pink",
    "rose",
}


def c(name, scale):
    """Shorthand color accessor.  c('blue', 600) → '#2563eb'"""
    return COLORS[name][scale]


def compose_palette(neutral="slate", accent="blue", dark_mode=False):
    """
    Build a set_palette()-compatible dict from a neutral + accent family.

    Args:
        neutral: Any neutral scale name (slate, zinc, gray, stone, ...)
        accent:  Any chromatic scale name (blue, indigo, emerald, rose, ...)
        dark_mode: True -> dark-background palette

    Returns:
        dict with keys: primary, secondary, accent, text_dark, text_muted,
                        card_fill, card_fill_alt, bg_dark, bg_light
    """
    n = COLORS[neutral]
    a = COLORS[accent]

    if dark_mode:
        return {
            "primary": a[400],
            "secondary": n[800],
            "accent": a[400],
            "text_dark": n[50],
            "text_muted": n[400],
            "card_fill": n[800],
            "card_fill_alt": n[700],
            "bg_dark": n[950],
            "bg_light": n[900],
        }
    return {
        "primary": a[700],
        "secondary": n[200],
        "accent": a[600],
        "text_dark": n[900],
        "text_muted": n[500],
        "card_fill": n[100],
        "card_fill_alt": n[200],
        "bg_dark": n[900],
        "bg_light": n[50],
    }


def chart_series(accent="blue", count=4):
    """Return *count* series colors spread across one chromatic scale."""
    pools = {
        2: [600, 300],
        3: [700, 500, 300],
        4: [700, 500, 300, 200],
        5: [800, 600, 500, 300, 200],
        6: [800, 600, 500, 400, 300, 200],
    }
    stops = pools.get(count, pools[6][:count])
    return [COLORS[accent][s] for s in stops]


def chart_series_multi(*names):
    """One color per family at the 600 stop — good for categorical charts."""
    return [COLORS[n][600] for n in names]


# ─── Pre-Composed Themes ────────────────────────────────────────────────────

THEMES = {
    "corporate_blue": (
        "slate",
        "blue",
        "Professional, trustworthy — finance, enterprise",
    ),
    "deep_indigo": ("slate", "indigo", "Sophisticated, tech — SaaS, AI, deep tech"),
    "emerald_growth": ("stone", "emerald", "Natural, growth — sustainability, health"),
    "warm_rose": ("gray", "rose", "Warm, approachable — consumer, lifestyle, HR"),
    "bold_orange": (
        "neutral",
        "orange",
        "Energetic, bold — startups, marketing, events",
    ),
    "creative_violet": ("zinc", "violet", "Creative, modern — design, education, arts"),
    "calm_teal": ("mist", "teal", "Balanced, calm — wellness, consulting"),
    "earthy_amber": ("taupe", "amber", "Earthy, warm — food, architecture, craft"),
    "fresh_cyan": ("zinc", "cyan", "Cool, techy — engineering, data, cloud"),
    "nature_green": ("olive", "green", "Organic, natural — agriculture, eco"),
    "luxe_purple": ("mauve", "purple", "Luxurious, elegant — premium, beauty, fashion"),
    "urgent_red": ("zinc", "red", "Bold, urgent — alerts, impact, critical"),
    "sky_open": ("slate", "sky", "Open, friendly — education, non-profit"),
    "lime_energy": ("neutral", "lime", "Vibrant, energetic — fitness, youth"),
}


def theme_palette(name, dark_mode=False):
    """Shortcut: theme_palette('corporate_blue') -> ready-to-use palette dict."""
    neutral, accent, _ = THEMES[name]
    return compose_palette(neutral, accent, dark_mode)


def list_themes():
    """Print and return all pre-composed themes with descriptions.

    Returns:
        list of dicts with keys: name, neutral, accent, description
    """
    result = []
    for name, (neutral, accent, desc) in sorted(THEMES.items()):
        print(f"  {name:20s}  {neutral:8s} + {accent:8s}  {desc}")
        result.append(
            {"name": name, "neutral": neutral, "accent": accent, "description": desc}
        )
    return result
