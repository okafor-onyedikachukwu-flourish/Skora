"""Draws Skora's app icons into assets/: a white tick on indigo, with an orange dot.

Run from the repo root:  python3 tools/make_icons.py
"""
from PIL import Image, ImageDraw

TOP, BOTTOM = (79, 70, 229), (55, 48, 163)  # indigo gradient, as before
ORANGE = (245, 158, 11)
WHITE = (255, 255, 255, 255)


def gradient(size):
    im = Image.new("RGBA", (size, size))
    d = ImageDraw.Draw(im)
    for y in range(size):
        t = y / (size - 1)
        d.line([(0, y), (size, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(TOP, BOTTOM)) + (255,))
    return im


def mark(size, scale=1.0, colour=WHITE, dot=True):
    """The tick and dot on a transparent square. scale < 1 shrinks it into the middle."""
    big = size * 4  # draw large, then shrink, for smooth edges
    im = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    c, s = big / 2, big * 0.5 * scale
    pts = [(c - 0.40 * s, c + 0.02 * s), (c - 0.10 * s, c + 0.32 * s), (c + 0.42 * s, c - 0.30 * s)]
    w = round(0.17 * s)
    d.line(pts, fill=colour, width=w, joint="curve")
    for x, y in (pts[0], pts[-1]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=colour)
    if dot:
        r = 0.09 * s
        x, y = c + 0.42 * s, c - 0.62 * s
        d.ellipse([x - r, y - r, x + r, y + r], fill=ORANGE + (255,) if colour == WHITE else colour)
    return im.resize((size, size), Image.LANCZOS)


def save_icon():
    icon = gradient(1024)
    icon.alpha_composite(mark(1024, 0.9))
    icon.convert("RGB").save("assets/icon.png")

    gradient(512).save("assets/android-icon-background.png")
    mark(512, 0.62).save("assets/android-icon-foreground.png")       # inside the adaptive-icon safe zone
    mark(432, 0.62, dot=False).save("assets/android-icon-monochrome.png")
    mark(1024, 0.55).save("assets/splash-icon.png")

    fav = gradient(48)
    fav.alpha_composite(mark(48, 0.9, dot=False))
    fav.save("assets/favicon.png")


if __name__ == "__main__":
    save_icon()
