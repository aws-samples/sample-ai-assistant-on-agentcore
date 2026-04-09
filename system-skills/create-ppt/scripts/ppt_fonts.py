"""
ppt_fonts.py — Download and install metric-compatible fonts for accurate PPT rendering.

Run once at the start of a PPT session. Downloads are cached — skips if already present.

Usage:
    from ppt_fonts import ensure_fonts
    ensure_fonts()   # idempotent — safe to call multiple times
"""

import os
import urllib.request

_USER_FONTS = os.path.expanduser("~/.fonts")

# Font sources: (filename, URL)
_FONT_SOURCES = {
    # Carlito ≈ Calibri (metric-compatible, designed by Google)
    "Carlito-Regular.ttf": "https://fonts.gstatic.com/s/carlito/v4/3Jn9SDPw3m-pk039PDA.ttf",
    "Carlito-Bold.ttf": "https://fonts.gstatic.com/s/carlito/v4/3Jn4SDPw3m-pk039BIykaX0.ttf",
    "Carlito-Italic.ttf": "https://fonts.gstatic.com/s/carlito/v4/3Jn6SDPw3m-pk039DDK59XglVg.ttf",
    "Carlito-BoldItalic.ttf": "https://fonts.gstatic.com/s/carlito/v4/3Jn_SDPw3m-pk039DDKBSQ.ttf",
    # Caladea ≈ Cambria (metric-compatible)
    "Caladea-Regular.ttf": "https://fonts.gstatic.com/s/caladea/v8/kJEzBugZ7AAjhybUjR8.ttf",
    "Caladea-Bold.ttf": "https://fonts.gstatic.com/s/caladea/v8/kJE2BugZ7AAjhybUtaNY39o.ttf",
    "Caladea-Italic.ttf": "https://fonts.gstatic.com/s/caladea/v8/kJE0BugZ7AAjhybUvR1FQ98SrA.ttf",
    "Caladea-BoldItalic.ttf": "https://fonts.gstatic.com/s/caladea/v8/kJExBugZ7AAjhybUvR19_w.ttf",
    # Lora ≈ Georgia (style-similar)
    "Lora-Regular.ttf": None,  # populated dynamically from Google Fonts API
    "Lora-Bold.ttf": None,
    "Lora-Italic.ttf": None,
    "Lora-BoldItalic.ttf": None,
}

# Liberation fonts come from GitHub (tarball)
_LIBERATION_URL = "https://github.com/liberationfonts/liberation-fonts/files/7261482/liberation-fonts-ttf-2.1.5.tar.gz"
_LIBERATION_FONTS = [
    "LiberationSans-Regular.ttf",
    "LiberationSans-Bold.ttf",
    "LiberationSans-Italic.ttf",
    "LiberationSans-BoldItalic.ttf",
    "LiberationSerif-Regular.ttf",
    "LiberationSerif-Bold.ttf",
    "LiberationSerif-Italic.ttf",
    "LiberationSerif-BoldItalic.ttf",
    "LiberationMono-Regular.ttf",
    "LiberationMono-Bold.ttf",
    "LiberationMono-Italic.ttf",
    "LiberationMono-BoldItalic.ttf",
]


def _all_fonts_present():
    """Check if all required fonts are already installed."""
    required = list(_FONT_SOURCES.keys()) + _LIBERATION_FONTS
    for f in required:
        if not os.path.exists(os.path.join(_USER_FONTS, f)):
            return False
    return True


def _install_liberation():
    """Download and extract Liberation fonts."""
    import tarfile, shutil

    tar_path = "/tmp/_liberation.tar.gz"
    try:
        urllib.request.urlretrieve(_LIBERATION_URL, tar_path)
        with tarfile.open(tar_path, "r:gz") as tar:
            tar.extractall("/tmp/_liberation_extract", filter="data")
        for root, dirs, files in os.walk("/tmp/_liberation_extract"):
            for f in files:
                if f.endswith(".ttf"):
                    shutil.copy2(os.path.join(root, f), os.path.join(_USER_FONTS, f))
    except Exception as e:
        print(f"  Warning: Liberation fonts failed: {e}")
    finally:
        for p in [tar_path, "/tmp/_liberation_extract"]:
            if os.path.exists(p):
                shutil.rmtree(p, ignore_errors=True) if os.path.isdir(p) else os.remove(
                    p
                )


def _install_google_fonts():
    """Download Google Fonts (Carlito, Caladea, Lora)."""
    import re

    # Direct downloads for Carlito and Caladea
    for fname, url in _FONT_SOURCES.items():
        if url is None:
            continue
        dest = os.path.join(_USER_FONTS, fname)
        if os.path.exists(dest):
            continue
        try:
            urllib.request.urlretrieve(url, dest)
        except Exception as e:
            print(f"  Warning: {fname} failed: {e}")

    # Lora via CSS API
    lora_dest = {
        "Lora-Regular.ttf": None,
        "Lora-Bold.ttf": None,
        "Lora-Italic.ttf": None,
        "Lora-BoldItalic.ttf": None,
    }
    if all(os.path.exists(os.path.join(_USER_FONTS, f)) for f in lora_dest):
        return
    try:
        req = urllib.request.Request(
            "https://fonts.googleapis.com/css2?family=Lora:ital,wght@0,400;0,700;1,400;1,700",
            headers={"User-Agent": "Mozilla/5.0"},
        )
        css = urllib.request.urlopen(req).read().decode()
        urls = re.findall(r"url\((https://fonts\.gstatic\.com/[^)]+\.ttf)\)", css)
        names = [
            "Lora-Regular.ttf",
            "Lora-Bold.ttf",
            "Lora-Italic.ttf",
            "Lora-BoldItalic.ttf",
        ]
        for name, url in zip(names, urls):
            dest = os.path.join(_USER_FONTS, name)
            if not os.path.exists(dest):
                urllib.request.urlretrieve(url, dest)
    except Exception as e:
        print(f"  Warning: Lora fonts failed: {e}")


def ensure_fonts(verbose=True):
    """Ensure all metric-compatible fonts are installed. Idempotent."""
    os.makedirs(_USER_FONTS, exist_ok=True)
    if _all_fonts_present():
        if verbose:
            print("Fonts: all present ✓")
        return True
    if verbose:
        print("Fonts: installing metric-compatible fonts...")
    _install_liberation()
    _install_google_fonts()
    ok = _all_fonts_present()
    if verbose:
        installed = sum(
            1
            for f in (list(_FONT_SOURCES.keys()) + _LIBERATION_FONTS)
            if os.path.exists(os.path.join(_USER_FONTS, f))
        )
        total = len(_FONT_SOURCES) + len(_LIBERATION_FONTS)
        print(f"Fonts: {installed}/{total} installed {'✓' if ok else '⚠'}")
    return ok
