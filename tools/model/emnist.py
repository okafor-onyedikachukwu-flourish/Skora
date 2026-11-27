"""EMNIST handwritten characters (NIST), the starting point for Skora's reader model.

load() returns the 'byclass' split: 28 x 28 greyscale images (white writing on black, upright)
and labels 0-9 = digits, 10-35 = A-Z, 36-61 = a-z. The download (about 560 MB) is kept in a
cache folder so later training runs skip it.

fake() makes a small stand-in from typed fonts, only for testing this code without the download.
"""
import gzip
import io
import os
import urllib.request
import zipfile

import numpy as np

URL = os.environ.get("EMNIST_URL", "https://biometrics.nist.gov/cs_links/EMNIST/gzip.zip")
CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"


def _download(cache_dir: str) -> str:
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "emnist-gzip.zip")
    if os.path.exists(path) and os.path.getsize(path) > 500_000_000:
        return path
    tmp = path + ".part"
    print(f"Downloading EMNIST from {URL} ...", flush=True)
    with urllib.request.urlopen(URL, timeout=120) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    os.replace(tmp, path)
    return path


def _idx(zf: zipfile.ZipFile, name: str) -> np.ndarray:
    raw = gzip.decompress(zf.read(name))
    if name.endswith("labels-idx1-ubyte.gz"):
        return np.frombuffer(raw, dtype=np.uint8, offset=8).astype(np.int64)
    n = int.from_bytes(raw[4:8], "big")
    imgs = np.frombuffer(raw, dtype=np.uint8, offset=16).reshape(n, 28, 28)
    return np.ascontiguousarray(imgs.transpose(0, 2, 1))  # EMNIST stores images transposed


def load(cache_dir: str):
    path = _download(cache_dir)
    with zipfile.ZipFile(path) as zf:
        names = {os.path.basename(n): n for n in zf.namelist()}
        get = lambda part: _idx(zf, names[f"emnist-byclass-{part}-ubyte.gz"])  # noqa: E731
        return get("train-images-idx3"), get("train-labels-idx1"), get("test-images-idx3"), get("test-labels-idx1")


def fake(per_char: int = 60, seed: int = 0):
    """Typed characters in a few sizes and slants: enough to run the whole pipeline, not to train a real model."""
    from PIL import Image, ImageDraw, ImageFont

    rng = np.random.default_rng(seed)
    xs, ys = [], []
    for label, ch in enumerate(CHARS):
        for _ in range(per_char):
            font = ImageFont.load_default(size=int(rng.integers(18, 26)))
            img = Image.new("L", (28, 28), 0)
            d = ImageDraw.Draw(img)
            box = d.textbbox((0, 0), ch, font=font)
            x = (28 - (box[2] - box[0])) / 2 - box[0] + rng.uniform(-1.5, 1.5)
            y = (28 - (box[3] - box[1])) / 2 - box[1] + rng.uniform(-1.5, 1.5)
            d.text((x, y), ch, fill=255, font=font)
            img = img.rotate(rng.uniform(-10, 10), resample=Image.BILINEAR)
            xs.append(np.asarray(img))
            ys.append(label)
    x, y = np.stack(xs), np.array(ys)
    order = rng.permutation(len(y))
    x, y = x[order], y[order]
    cut = int(len(y) * 0.8)
    return x[:cut], y[:cut], x[cut:], y[cut:]
