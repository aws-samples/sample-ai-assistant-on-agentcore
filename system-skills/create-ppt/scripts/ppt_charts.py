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
ppt_charts.py — Matplotlib chart generation with template-harmonized styling.

All charts save as PNG and return the file path, ready for safe_add_picture().

Usage:
    from ppt_charts import *
    init_chart_style(primary='#1B2A4A', series=['#1B2A4A','#2D5F8A','#22C55E'])
    path = create_bar_chart(
        categories=['Q1','Q2','Q3','Q4'],
        series={'Revenue': [50,62,58,71]},
        title='Quarterly Revenue',
        output_path='/tmp/charts/revenue.png'
    )
"""

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.ticker as mticker
import numpy as np
import os

CHART_STYLE = {
    "primary": "#1B2A4A",
    "secondary": "#2D5F8A",
    "accent": "#22C55E",
    "text_dark": "#333333",
    "text_body": "#4A4A4A",
    "text_muted": "#888888",
    "background": "none",
    "gridline": "#E5E7EB",
    "series_colors": ["#1B2A4A", "#2D5F8A", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"],
}

CHART_DIR = "/tmp/charts"


def _is_transparent_bg():
    """Check whether the current background setting means transparent."""
    bg = CHART_STYLE["background"]
    return bg in ("none", "transparent", None, "")


def init_chart_style(
    primary=None,
    secondary=None,
    accent=None,
    series=None,
    background=None,
    font_family="sans-serif",
):
    """Initialize chart styling from your presentation palette."""
    if primary:
        CHART_STYLE["primary"] = primary
    if secondary:
        CHART_STYLE["secondary"] = secondary
    if accent:
        CHART_STYLE["accent"] = accent
    if series:
        CHART_STYLE["series_colors"] = series
    if background is not None:
        CHART_STYLE["background"] = background
    _apply_rcparams(font_family)


def _apply_rcparams(font_family="sans-serif"):
    bg = "none" if _is_transparent_bg() else CHART_STYLE["background"]
    plt.rcParams.update(
        {
            "font.family": font_family,
            "font.size": 11,
            "axes.facecolor": bg,
            "figure.facecolor": bg,
            "axes.edgecolor": CHART_STYLE["gridline"],
            "axes.labelcolor": CHART_STYLE["text_body"],
            "axes.labelsize": 12,
            "axes.titlesize": 14,
            "axes.titleweight": "bold",
            "axes.titlecolor": CHART_STYLE["text_dark"],
            "xtick.color": CHART_STYLE["text_body"],
            "ytick.color": CHART_STYLE["text_body"],
            "xtick.labelsize": 10,
            "ytick.labelsize": 10,
            "text.color": CHART_STYLE["text_body"],
            "grid.color": CHART_STYLE["gridline"],
            "grid.alpha": 0.5,
            "grid.linewidth": 0.5,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "legend.frameon": False,
            "legend.fontsize": 10,
            "figure.dpi": 200,
        }
    )


_apply_rcparams()


def _ensure_dir(path):
    os.makedirs(os.path.dirname(path) if "/" in path else CHART_DIR, exist_ok=True)


def _save_and_close(fig, output_path, pad_inches=0.25):
    """Save figure and close it. pad_inches controls whitespace around the chart."""
    _ensure_dir(output_path)
    transparent = _is_transparent_bg()
    if transparent:
        fig.patch.set_alpha(0)
        for ax in fig.get_axes():
            ax.patch.set_alpha(0)
    fig.savefig(
        output_path,
        dpi=200,
        bbox_inches="tight",
        facecolor="none" if transparent else CHART_STYLE["background"],
        transparent=transparent,
        pad_inches=pad_inches,
    )
    plt.close(fig)
    return output_path


def _get_colors(n):
    colors = CHART_STYLE["series_colors"]
    return [colors[i % len(colors)] for i in range(n)]


def create_bar_chart(
    categories,
    series,
    title="",
    output_path=None,
    figsize=(10, 5.5),
    ylabel="",
    xlabel="",
    show_values=True,
    value_fmt="{:.0f}",
    horizontal=False,
    stacked=False,
    pad_inches=0.25,
):
    if output_path is None:
        output_path = os.path.join(CHART_DIR, "bar_chart.png")

    fig, ax = plt.subplots(figsize=figsize)
    n_series = len(series)
    n_cats = len(categories)
    colors = _get_colors(n_series)
    x = np.arange(n_cats)
    bar_width = 0.5 if n_series == 1 else 0.7 / n_series

    # Pre-compute cumulative sums for stacked bar value positioning
    series_values = list(series.values())

    for i, (name, values) in enumerate(series.items()):
        if stacked:
            offset = x
            bottom = np.zeros(n_cats) if i == 0 else np.sum(series_values[:i], axis=0)
            if horizontal:
                b = ax.barh(
                    offset,
                    values,
                    height=0.5,
                    left=bottom,
                    label=name,
                    color=colors[i],
                )
            else:
                b = ax.bar(
                    offset,
                    values,
                    width=0.5,
                    bottom=bottom,
                    label=name,
                    color=colors[i],
                )
        else:
            offset = x + (i - n_series / 2 + 0.5) * bar_width
            if horizontal:
                b = ax.barh(
                    offset,
                    values,
                    height=bar_width * 0.9,
                    label=name,
                    color=colors[i],
                )
            else:
                b = ax.bar(
                    offset,
                    values,
                    width=bar_width * 0.9,
                    label=name,
                    color=colors[i],
                )

        if show_values:
            for j, bar_item in enumerate(b):
                if horizontal:
                    val = bar_item.get_width()
                    # For stacked, position at cumulative right edge
                    xpos = (bottom[j] + val) if stacked else val
                    ax.text(
                        xpos + max(values) * 0.01,
                        bar_item.get_y() + bar_item.get_height() / 2,
                        value_fmt.format(val),
                        ha="left",
                        va="center",
                        fontsize=9,
                        color=CHART_STYLE["text_body"],
                    )
                else:
                    val = bar_item.get_height()
                    # For stacked, position at cumulative top edge
                    ypos = (bottom[j] + val) if stacked else val
                    ax.text(
                        bar_item.get_x() + bar_item.get_width() / 2,
                        ypos + max(values) * 0.01,
                        value_fmt.format(val),
                        ha="center",
                        va="bottom",
                        fontsize=9,
                        color=CHART_STYLE["text_body"],
                    )

    if horizontal:
        ax.set_yticks(x)
        ax.set_yticklabels(categories)
        ax.set_xlabel(xlabel)
        ax.grid(axis="x", alpha=0.3)
    else:
        ax.set_xticks(x)
        ax.set_xticklabels(categories)
        ax.set_ylabel(ylabel)
        ax.grid(axis="y", alpha=0.3)

    if title:
        ax.set_title(title, pad=12)
    if n_series > 1:
        ax.legend()
    plt.tight_layout()
    return _save_and_close(fig, output_path, pad_inches=pad_inches)


def create_line_chart(
    categories,
    series,
    title="",
    output_path=None,
    figsize=(10, 5.5),
    ylabel="",
    xlabel="",
    show_markers=True,
    show_values=False,
    value_fmt="{:.0f}",
    fill=False,
    pad_inches=0.25,
):
    if output_path is None:
        output_path = os.path.join(CHART_DIR, "line_chart.png")

    fig, ax = plt.subplots(figsize=figsize)
    colors = _get_colors(len(series))
    x = np.arange(len(categories))

    for i, (name, values) in enumerate(series.items()):
        marker = "o" if show_markers else None
        ax.plot(
            x,
            values,
            label=name,
            color=colors[i],
            marker=marker,
            markersize=6,
            linewidth=2,
        )
        if fill:
            ax.fill_between(x, values, alpha=0.1, color=colors[i])
        if show_values:
            for j, v in enumerate(values):
                ax.annotate(
                    value_fmt.format(v),
                    (x[j], v),
                    textcoords="offset points",
                    xytext=(0, 10),
                    ha="center",
                    fontsize=9,
                    color=colors[i],
                )

    ax.set_xticks(x)
    ax.set_xticklabels(categories)
    ax.grid(axis="y", alpha=0.3)
    if ylabel:
        ax.set_ylabel(ylabel)
    if xlabel:
        ax.set_xlabel(xlabel)
    if title:
        ax.set_title(title, pad=12)
    if len(series) > 1:
        ax.legend()
    plt.tight_layout()
    return _save_and_close(fig, output_path, pad_inches=pad_inches)


def create_pie_chart(
    labels,
    values,
    title="",
    output_path=None,
    figsize=(7, 5.5),
    show_pct=True,
    pct_fmt="%.1f%%",
    explode_index=None,
    pad_inches=0.25,
):
    if output_path is None:
        output_path = os.path.join(CHART_DIR, "pie_chart.png")

    fig, ax = plt.subplots(figsize=figsize)
    colors = _get_colors(len(labels))
    explode = (
        [0.05 if i == explode_index else 0 for i in range(len(labels))]
        if explode_index is not None
        else None
    )
    autopct = pct_fmt if show_pct else None
    wedges, texts, autotexts = ax.pie(
        values,
        labels=labels,
        colors=colors,
        autopct=autopct,
        explode=explode,
        startangle=90,
        pctdistance=0.8,
        textprops={"fontsize": 11, "color": CHART_STYLE["text_dark"]},
    )
    for at in autotexts:
        at.set_fontsize(10)
        at.set_color("white")
        at.set_fontweight("bold")
    if title:
        ax.set_title(title, pad=16)
    plt.tight_layout()
    return _save_and_close(fig, output_path, pad_inches=pad_inches)


def create_donut_chart(
    labels,
    values,
    title="",
    output_path=None,
    figsize=(7, 5.5),
    center_text=None,
    center_subtext=None,
    pad_inches=0.25,
):
    if output_path is None:
        output_path = os.path.join(CHART_DIR, "donut_chart.png")

    fig, ax = plt.subplots(figsize=figsize)
    colors = _get_colors(len(labels))
    wedges, texts = ax.pie(
        values,
        labels=labels,
        colors=colors,
        startangle=90,
        wedgeprops={"width": 0.4, "edgecolor": "white"},
        textprops={"fontsize": 11, "color": CHART_STYLE["text_dark"]},
    )
    if center_text:
        ax.text(
            0,
            0.08,
            center_text,
            ha="center",
            va="center",
            fontsize=24,
            fontweight="bold",
            color=CHART_STYLE["primary"],
        )
    if center_subtext:
        ax.text(
            0,
            -0.15,
            center_subtext,
            ha="center",
            va="center",
            fontsize=11,
            color=CHART_STYLE["text_muted"],
        )
    if title:
        ax.set_title(title, pad=16)
    plt.tight_layout()
    return _save_and_close(fig, output_path, pad_inches=pad_inches)


def create_horizontal_bar(
    categories,
    values,
    title="",
    output_path=None,
    figsize=(10, 5.5),
    xlabel="",
    show_values=True,
    value_fmt="{:.0f}",
    sort=True,
    pad_inches=0.25,
):
    if output_path is None:
        output_path = os.path.join(CHART_DIR, "hbar_chart.png")
    if sort:
        paired = sorted(zip(values, categories))
        values, categories = zip(*paired)
        values, categories = list(values), list(categories)
    return create_bar_chart(
        categories,
        {"": values},
        title=title,
        output_path=output_path,
        figsize=figsize,
        xlabel=xlabel,
        show_values=show_values,
        value_fmt=value_fmt,
        horizontal=True,
        pad_inches=pad_inches,
    )


def create_stacked_bar(
    categories,
    series,
    title="",
    output_path=None,
    figsize=(10, 5.5),
    ylabel="",
    show_values=False,
    value_fmt="{:.0f}",
    pad_inches=0.25,
):
    if output_path is None:
        output_path = os.path.join(CHART_DIR, "stacked_bar.png")
    return create_bar_chart(
        categories,
        series,
        title=title,
        output_path=output_path,
        figsize=figsize,
        ylabel=ylabel,
        show_values=show_values,
        value_fmt=value_fmt,
        stacked=True,
        pad_inches=pad_inches,
    )
