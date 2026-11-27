"""The one way Skora turns a cut-out of handwriting into the model's 32 x 32 input.

The phone does exactly the same in src/lib/reader/normalize.ts; tools/test/normalize_test
checks the two agree. Change both together, then train again.

Input: a greyscale crop (uint8, dark ink on light paper). Output: 32 x 32 float32, 0 = paper,
1 = ink, with the writing centred and scaled to fill most of the square.
"""
import math

import numpy as np

SIZE = 32
SUB = 4  # samples per output pixel along each side
MARGIN = 1.25  # the square is this much bigger than the writing
MIN_CONTRAST = 24
INK_LEVEL = 0.4


def _percentile(hist, total, frac):
    """The smallest grey value v with at least frac of the pixels at or below v."""
    need = frac * total
    run = 0
    for v in range(256):
        run += int(hist[v])
        if run >= need:
            return v
    return 255


def normalize(crop: np.ndarray) -> np.ndarray:
    crop = np.asarray(crop, dtype=np.uint8)
    h, w = crop.shape
    out = np.zeros((SIZE, SIZE), dtype=np.float32)
    if w < 2 or h < 2:
        return out
    hist = np.bincount(crop.ravel(), minlength=256)
    total = w * h
    paper = _percentile(hist, total, 0.9)
    ink = _percentile(hist, total, 0.02)
    if paper - ink < MIN_CONTRAST:
        return out
    t = (paper - crop.astype(np.float64)) / float(paper - ink)
    t = np.clip(t, 0.0, 1.0)
    # A rule line (most of a row inked, but lighter than the writing) is not part of the
    # character: drop it, so the letter, not the line, is centred. Crossings-out are as dark as
    # the writing, so they stay.
    if w >= 12:
        row_ink = (t >= INK_LEVEL).sum(axis=1)
        row_mean = t.mean(axis=1)
        t[(row_ink >= 0.75 * w) & (row_mean < 0.75)] = 0.0
    ys, xs = np.nonzero(t >= INK_LEVEL)
    if len(xs) == 0:
        return out
    x0, x1, y0, y1 = int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max())
    side = max(x1 - x0 + 1, y1 - y0 + 1) * MARGIN
    cx = (x0 + x1 + 1) / 2.0
    cy = (y0 + y1 + 1) / 2.0
    left = cx - side / 2.0
    top = cy - side / 2.0
    step = side / (SIZE * SUB)
    # Sample positions: SIZE * SUB points along each side, at the centres of equal steps.
    pos = (np.arange(SIZE * SUB, dtype=np.float64) + 0.5) * step
    px = np.floor(left + pos).astype(np.int64)
    py = np.floor(top + pos).astype(np.int64)
    okx = (px >= 0) & (px < w)
    oky = (py >= 0) & (py < h)
    grid = np.zeros((SIZE * SUB, SIZE * SUB), dtype=np.float64)
    sub = t[np.ix_(np.clip(py, 0, h - 1), np.clip(px, 0, w - 1))]
    grid[np.ix_(oky, okx)] = sub[np.ix_(oky, okx)]
    out = grid.reshape(SIZE, SUB, SIZE, SUB).sum(axis=(1, 3)) / (SUB * SUB)
    return out.astype(np.float32)
