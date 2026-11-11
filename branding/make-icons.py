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
  mk-flix-app/.../drawable-{xhdpi,xxxhdpi}/tv_banner.png  Android TV home-screen banner

The master is a glowing mark on a transparent background, designed for dark
surroundings. The desktop icons keep it transparent. Android legacy icons
sit it on black, and the adaptive icon pairs it with the black background
colour already set in res/values/colors.xml.
"""
import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent.parent
MASTER = ROOT / "branding" / "mkflix-icon-1024.png"
# Wordmark font for the TV banner (Ubuntu Bold, Ubuntu Font Licence 1.0; see
# fonts/Ubuntu-font-LICENCE.txt).
FONT = ROOT / "branding" / "fonts" / "Ubuntu-B.ttf"
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

    # Android TV / Google TV home-screen banner (320x180 dp): the mark plus an
    # "MK-Flix" wordmark. 1080p TVs use xhdpi (320x180 px), 4K TVs xxxhdpi.
    for folder, scale in (("drawable-xhdpi", 1), ("drawable-xxxhdpi", 2)):
        (RES / folder).mkdir(exist_ok=True)
        tv_banner(mark, 320 * scale, 180 * scale).save(RES / folder / "tv_banner.png", optimize=True)

    print("icons written from", MASTER.relative_to(ROOT))


def tv_banner(mark, w, h):
    """Mark on the left, "MK-Flix" on the right, on a dark backdrop.

    The wordmark is filled with a left-to-right gradient sampled from the
    mark's own neon colours (cyan, magenta, red), so it reads as one logo.
    """
    banner = Image.new("RGBA", (w, h), BLACK)
    # A faint glow behind the mark keeps the black from looking flat on TV.
    glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse((-w * 0.15, -h * 0.4, w * 0.55, h * 1.4), fill=(40, 20, 60, 255))
    banner.alpha_composite(glow.filter(ImageFilter.GaussianBlur(h * 0.25)))

    mark_h = round(h * 0.74)
    art = mark.resize((round(mark.width * mark_h / mark.height), mark_h), Image.LANCZOS)
    left = round(w * 0.07)
    banner.alpha_composite(art, (left, (h - mark_h) // 2))

    text = "MK-Flix"
    text_left = left + art.width + round(w * 0.04)
    max_w = w - text_left - round(w * 0.06)
    size = round(h * 0.34)
    font = ImageFont.truetype(str(FONT), size)
    while font.getlength(text) > max_w and size > 8:
        size -= 1
        font = ImageFont.truetype(str(FONT), size)
    box = font.getbbox(text)
    text_h = box[3] - box[1]
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).text((text_left, (h - text_h) // 2 - box[1]), text, font=font, fill=255)

    gradient = Image.new("RGBA", (w, h))
    stops = sample_neon(mark)
    gd = ImageDraw.Draw(gradient)
    span = max(1, font.getlength(text))
    for x in range(w):
        t = min(1.0, max(0.0, (x - text_left) / span))
        gd.line([(x, 0), (x, h)], fill=lerp_stops(stops, t))
    banner.paste(gradient, (0, 0), mask)
    return banner


def sample_neon(mark):
    """Cyan, magenta and red, as they actually appear in the mark."""
    small = mark.convert("RGBA").resize((64, 64))
    def pick(test):
        hits = [p for p in small.getdata() if p[3] > 200 and test(p)]
        n = max(1, len(hits))
        return tuple(sum(p[i] for p in hits) // n for i in range(3)) + (255,)
    return [pick(lambda p: p[2] > 150 and p[1] > 150 and p[0] < 120),   # cyan
            pick(lambda p: p[0] > 150 and p[2] > 150 and p[1] < 120),   # magenta
            pick(lambda p: p[0] > 180 and p[1] < 90 and p[2] < 110)]    # red


def lerp_stops(stops, t):
    seg = t * (len(stops) - 1)
    i = min(int(seg), len(stops) - 2)
    f = seg - i
    a, b = stops[i], stops[i + 1]
    return tuple(round(a[k] + (b[k] - a[k]) * f) for k in range(4))


if __name__ == "__main__":
    main()
