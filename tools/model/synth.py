"""Turns a clean EMNIST character into what the phone actually sees: a cut-out of a photo of an
answer script. Ink on paper of any shade, shadows, foolscap rule lines, a neighbouring full stop,
blur, phone JPEG, a box that is too tight or too loose, thick and thin pens, slanted writing.
Then the same normalize() as the phone gives the model's 32 x 32 input.
"""
import io

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from normalize import normalize


def _ink_mask(glyph: np.ndarray, rng: np.random.Generator) -> Image.Image:
    """The character as a mask (255 = ink), resized, slanted and with a thicker or thinner pen."""
    img = Image.fromarray(glyph)
    height = int(rng.integers(16, 66))
    aspect = rng.uniform(0.8, 1.2)
    img = img.resize((max(8, int(height * aspect)), height), Image.BICUBIC)
    shear = rng.uniform(-0.3, 0.3)
    w, h = img.size
    pad = int(abs(shear) * h) + 4
    canvas = Image.new("L", (w + 2 * pad, h + 2 * pad), 0)
    canvas.paste(img, (pad, pad))
    canvas = canvas.transform(canvas.size, Image.AFFINE, (1, shear, -shear * canvas.size[1] / 2, 0, 1, 0), Image.BILINEAR)
    canvas = canvas.rotate(rng.uniform(-12, 12), resample=Image.BILINEAR, expand=True)
    r = rng.random()
    if r < 0.3:
        canvas = canvas.filter(ImageFilter.MaxFilter(3))  # thicker pen
    elif r < 0.45 and height > 28:
        canvas = canvas.filter(ImageFilter.MinFilter(3))  # thinner pen
    return canvas


def _strike(mask: Image.Image, rng: np.random.Generator) -> None:
    """Cross the character out: one or two strokes, or a scribble."""
    box = mask.getbbox()
    if not box:
        return
    x0, y0, x1, y1 = box
    d = ImageDraw.Draw(mask)
    width = int(rng.integers(2, max(3, (y1 - y0) // 8 + 2)))
    if rng.random() < 0.7:
        for _ in range(int(rng.integers(1, 3))):
            a = (x0 - rng.uniform(0, 4), rng.uniform(y0, y1))
            b = (x1 + rng.uniform(0, 4), rng.uniform(y0, y1))
            d.line([a, b], fill=255, width=width)
    else:
        pts = [(rng.uniform(x0, x1), rng.uniform(y0, y1)) for _ in range(int(rng.integers(5, 10)))]
        d.line(pts, fill=255, width=width)


def make_crop(glyph: np.ndarray | None, rng: np.random.Generator, crossed: bool = False) -> np.ndarray:
    """A photo-like cut-out (uint8, dark ink on light paper). glyph None = no character at all."""
    if glyph is None:
        size = int(rng.integers(16, 70))
        mask = Image.new("L", (size, size), 0)
        box = (0, 0, size, size)
    else:
        mask = _ink_mask(glyph, rng)
        if crossed:
            _strike(mask, rng)
        box = mask.getbbox() or (0, 0, *mask.size)

    # The box the phone cuts out: sometimes tight (a little of the writing lost), usually loose.
    bw, bh = box[2] - box[0], box[3] - box[1]
    m = lambda: rng.uniform(-0.06, 0.45)  # noqa: E731
    left, top = int(box[0] - m() * bw), int(box[1] - m() * bh)
    right, bottom = int(box[2] + m() * bw), int(box[3] + m() * bh)
    W, H = max(4, right - left), max(4, bottom - top)
    ink = np.zeros((H, W), dtype=np.float64)
    src = np.asarray(mask, dtype=np.float64) / 255.0
    sx0, sy0 = max(0, left), max(0, top)
    sx1, sy1 = min(src.shape[1], right), min(src.shape[0], bottom)
    if sx1 > sx0 and sy1 > sy0:
        ink[sy0 - top:sy1 - top, sx0 - left:sx1 - left] = src[sy0:sy1, sx0:sx1]

    # Paper: any shade, a shadow across it, grain.
    paper = rng.uniform(140, 245)
    gy, gx = np.mgrid[0:H, 0:W]
    shade = paper + rng.uniform(-30, 30) * (gx / max(1, W - 1) - 0.5) + rng.uniform(-30, 30) * (gy / max(1, H - 1) - 0.5)
    shade = shade + rng.normal(0, rng.uniform(1, 9), size=(H, W))
    page = shade.copy()

    # A foolscap rule line, often under the writing.
    if rng.random() < 0.4:
        y = int(rng.uniform(0.55, 1.0) * (H - 1)) if rng.random() < 0.7 else int(rng.uniform(0, 1) * (H - 1))
        thick = int(rng.integers(1, 3))
        page[max(0, y - thick + 1):y + 1, :] -= rng.uniform(25, 80)
    # A neighbouring mark at the edge: the full stop after the number, or part of another letter.
    if rng.random() < 0.3:
        r = max(1, int(rng.uniform(0.04, 0.1) * H))
        cx = int(rng.uniform(0, 0.12) * W) if rng.random() < 0.5 else int(rng.uniform(0.88, 1.0) * W)
        cy = int(rng.uniform(0.6, 0.95) * H)
        page[max(0, cy - r):cy + r, max(0, cx - r):cx + r] -= rng.uniform(60, 140)

    ink_level = rng.uniform(10, 130)
    strength = rng.uniform(0.75, 1.0)
    a = np.clip(ink * strength, 0, 1)
    page = page * (1 - a) + ink_level * a
    img = Image.fromarray(np.clip(page, 0, 255).astype(np.uint8))

    blur = rng.uniform(0, 1.3)
    if blur > 0.3:
        img = img.filter(ImageFilter.GaussianBlur(blur))
    if rng.random() < 0.7:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=int(rng.integers(35, 95)))
        img = Image.open(io.BytesIO(buf.getvalue())).convert("L")
    return np.asarray(img, dtype=np.uint8)


def sample(glyph, seed: int, crossed: bool = False) -> np.ndarray:
    """The model's input (32 x 32, uint8 0-255) for one augmented character."""
    rng = np.random.default_rng(seed)
    x = normalize(make_crop(glyph, rng, crossed))
    return np.clip(np.rint(x * 255), 0, 255).astype(np.uint8)
