#!/usr/bin/env python3
"""Generate every MK-Flix app icon from branding/mkflix-icon-1024.png.

Run from anywhere:  python3 branding/make-icons.py   (needs Pillow)

Writes:
  mk-flix-desktop/icon.ico   Windows exe, taskbar and window (16-256 px)
  mk-flix-desktop/icon.png   Linux menu, dock and window; also the error screen
  mk-flix-app/.../mipmap-*/ic_launcher.png             legacy icon (Android 7)
  mk-flix-app/.../mipmap-*/ic_launcher_round.png       legacy round icon
  mk-flix-app/.../mipmap-*/ic_launcher_foreground.png  adaptive icon layer (8+)
  mk-flix-app/.../drawable/ic_launcher_monochrome.png  themed icon (13+)
  mkflix-logo.css (desktop folder and Android assets)  logos shown in place of
                                                        cinejoy.pk's (header, loading screen)
  mk-flix-app/.../assets/icon.png                      icon on the Android error screen

The master is a glowing mark on a transparent background, designed for dark
surroundings. The desktop icons keep it transparent. Android legacy icons
sit it on black, and the adaptive icon pairs it with the black background
colour already set in res/values/colors.xml.
"""
import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "branding" / "mkflix-icon-1024.png"
DESKTOP = ROOT / "mk-flix-desktop"
RES = ROOT / "mk-flix-app" / "app" / "src" / "main" / "res"
ANDROID_ASSETS = ROOT / "mk-flix-app" / "app" / "src" / "main" / "assets"

# Android density buckets: legacy icon size (48dp) and adaptive layer size (108dp).
DENSITIES = {"mdpi": (48, 108), "hdpi": (72, 162), "xhdpi": (96, 216),
             "xxhdpi": (144, 324), "xxxhdpi": (192, 432)}

# Share of the canvas the mark may fill.
DESKTOP_FILL = 0.94   # desktop icons are shown unmasked
LEGACY_FILL = 0.78    # leaves a dark border inside the legacy tile
ADAPTIVE_FILL = 0.54  # adaptive masks may keep only the centre 66 of 108 dp
ROUND_FILL = 0.70     # inside the legacy circle

# The mark is a right-pointing triangle. Centred by its bounding box, its two
# left corners poke out of a circle long before the rest of it fills one.
# For circular and adaptive icons it's centred on the triangle's circumcentre
# instead: for vertices (0,0), (0,h), (w,h/2) with h close to w, that point
# is 3w/8 from the left edge, w/8 left of the box centre, so the mark moves
# right by w/8.
CIRCLE_SHIFT = 1 / 8

# How much bigger than cinejoy.pk's own logo (44 px) the in-page logo is drawn.
# The glowing triangle has less visual weight than the solid logo it replaces.
LOGO_SCALE = 1.3

BLACK = (0, 0, 0, 255)


def load_mark():
    """The master cropped to its visible pixels."""
    im = Image.open(MASTER).convert("RGBA")
    return im.crop(im.getchannel("A").getbbox())


def place(mark, size, fill, background=None, shift=0.0):
    """Centre the mark on a size x size canvas, scaled to `fill` of it.

    `shift` moves the mark right by that share of its width, so the point
    `shift` left of its box centre lands on the canvas centre.
    """
    canvas = background.copy() if background else Image.new("RGBA", (size, size), (0, 0, 0, 0))
    scale = fill * size / max(mark.size)
    w, h = max(1, round(mark.width * scale)), max(1, round(mark.height * scale))
    art = mark.resize((w, h), Image.LANCZOS)
    canvas.alpha_composite(art, ((size - w) // 2 + round(w * shift), (size - h) // 2))
    return canvas


def tile(size, round_shape):
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(im)
    if round_shape:
        draw.ellipse((0, 0, size - 1, size - 1), fill=BLACK)
    else:
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=size * 0.18, fill=BLACK)
    return im


def silhouette(mark):
    """White mark for themed icons: the strokes, without the soft glow."""
    alpha = mark.getchannel("A").point(lambda v: 255 if v > 128 else 0)
    white = Image.new("RGBA", mark.size, (255, 255, 255, 0))
    white.putalpha(alpha)
    return white


def main():
    mark = load_mark()

    big = place(mark, 1024, DESKTOP_FILL)
    big.resize((512, 512), Image.LANCZOS).save(DESKTOP / "icon.png", optimize=True)
    big.resize((256, 256), Image.LANCZOS).save(
        DESKTOP / "icon.ico", sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])

    for density, (legacy, adaptive) in DENSITIES.items():
        folder = RES / f"mipmap-{density}"
        folder.mkdir(parents=True, exist_ok=True)
        place(mark, legacy, LEGACY_FILL, tile(legacy, False)).save(folder / "ic_launcher.png", optimize=True)
        place(mark, legacy, ROUND_FILL, tile(legacy, True), CIRCLE_SHIFT).save(
            folder / "ic_launcher_round.png", optimize=True)
        place(mark, adaptive, ADAPTIVE_FILL, shift=CIRCLE_SHIFT).save(
            folder / "ic_launcher_foreground.png", optimize=True)

    # In-page logos: style rules that draw the MK-Flix mark wherever cinejoy.pk
    # shows its own. Being CSS, they also cover logos the site redraws later,
    # and the apps apply them before the page first paints (no flash of the
    # old logo). Pages on cinejoy.pk can't read the app's own files, so the
    # image is embedded once as a data: URL in a custom property.
    #  - Header: an <img> of /brand/logomark-*.svg. CSS `content` on an <img>
    #    makes Chromium draw a different image in its place.
    #  - Video loading screen ("Whipping up..."): an inline, animated <svg> of
    #    the clapper (class loading-logo, viewBox 0 0 1634.4 1748.1). `content`
    #    doesn't work on SVG, so its drawing is hidden and the mark is shown as
    #    the SVG's background, with a gentle pulse in place of the clapper's
    #    own animation. Matching the viewBox catches other inline copies too.
    # 288 px keeps the loading-screen logo (up to 144 px) sharp on 2x screens.
    buf = io.BytesIO()
    big.resize((288, 288), Image.LANCZOS).save(buf, "PNG", optimize=True)
    data_url = "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    svg_logo = 'svg.loading-logo, svg[viewBox="0 0 1634.4 1748.1"]'
    logo_css = (
        "/* Generated by branding/make-icons.py from branding/mkflix-icon-1024.png.\n"
        "   Don't edit by hand; change it there and re-run it. */\n"
        f":root {{ --mkflix-logo: url(\"{data_url}\"); }}\n"
        "img[src*=\"/brand/logomark\"] {\n"
        "  content: var(--mkflix-logo) !important;\n"
        f"  transform: scale({LOGO_SCALE});\n"
        "  transform-origin: left center;\n"
        "}\n"
        f"{svg_logo.replace(', ', ' > *, ')} > * {{ display: none !important; }}\n"
        f"{svg_logo} {{\n"
        "  background: var(--mkflix-logo) center / contain no-repeat !important;\n"
        "}\n"
        "svg.loading-logo { animation: mkflix-pulse 1.6s ease-in-out infinite !important; }\n"
        "@keyframes mkflix-pulse {\n"
        "  0%, 100% { opacity: 1; transform: scale(1); }\n"
        "  50% { opacity: 0.7; transform: scale(0.94); }\n"
        "}\n")
    for folder in (DESKTOP, ANDROID_ASSETS):
        (folder / "mkflix-logo.css").write_text(logo_css)

    # error.html (shared by both apps) shows the icon; Android serves it from
    # assets, the desktop app from its own folder (icon.png above).
    big.resize((256, 256), Image.LANCZOS).save(ANDROID_ASSETS / "icon.png", optimize=True)

    (RES / "drawable").mkdir(exist_ok=True)
    place(silhouette(mark), 432, ADAPTIVE_FILL, shift=CIRCLE_SHIFT).save(
        RES / "drawable" / "ic_launcher_monochrome.png", optimize=True)

    print("icons written from", MASTER.relative_to(ROOT))


if __name__ == "__main__":
    main()
