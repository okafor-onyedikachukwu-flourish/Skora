"""EMNIST handwritten characters (NIST), the starting point for Skora's reader model.

load() returns the 'byclass' split: 28 x 28 greyscale images (white writing on black, upright)
and labels 0-9 = digits, 10-35 = A-Z, 36-61 = a-z. The four byclass files (about 200 MB) are
kept in a cache folder so later training runs skip the download.

fake() makes a small stand-in from typed fonts, only for testing this code without the download.
"""
import gzip
import os
import time
import urllib.request
import zipfile

import numpy as np

# Where the EMNIST files can be fetched, tried in order. NIST's own server refuses many
# downloads, so the mirrors come first:
#   - Hugging Face, Heliosoph/EMNIST: NIST's files byte for byte, one file per split;
#   - Western Sydney University, where the EMNIST authors work: NIST's whole gzip.zip;
#   - NIST.
FILE_MIRRORS = ["https://huggingface.co/datasets/Heliosoph/EMNIST/resolve/main/{name}"]
ZIP_MIRRORS = [
    "https://rds.westernsydney.edu.au/Institutes/MARCS/BENS/EMNIST/emnist-gzip.zip",
    "https://biometrics.nist.gov/cs_links/EMNIST/gzip.zip",
]
if os.environ.get("EMNIST_URL"):  # one more place to try first, for testing or a new mirror
    ZIP_MIRRORS.insert(0, os.environ["EMNIST_URL"])
if os.environ.get("EMNIST_FILE_URL"):
    FILE_MIRRORS.insert(0, os.environ["EMNIST_FILE_URL"])

PARTS = {
    "train-images-idx3": 697_932,
    "train-labels-idx1": 697_932,
    "test-images-idx3": 116_323,
    "test-labels-idx1": 116_323,
}
NAMES = [f"emnist-byclass-{part}-ubyte.gz" for part in PARTS]
HEADERS = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) Skora-trainer/1.0 (+https://github.com/okafor-onyedikachukwu-flourish/Skora)"}


def _fetch(url: str, path: str) -> None:
    tmp = path + ".part"
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                while True:
                    chunk = r.read(1 << 20)
                    if not chunk:
                        break
                    f.write(chunk)
            os.replace(tmp, path)
            return
        except Exception as e:  # noqa: BLE001 - any failure: try again, then the next mirror
            last = e
            time.sleep(3 * (attempt + 1))
    raise RuntimeError(f"{url}: {last}")


def _check(path: str, part: str) -> bool:
    """The file is a whole EMNIST byclass file of the expected kind and length."""
    try:
        with gzip.open(path, "rb") as f:
            head = f.read(8)
        magic, count = int.from_bytes(head[:4], "big"), int.from_bytes(head[4:8], "big")
        return magic == (2051 if "images" in part else 2049) and count == PARTS[part]
    except Exception:  # noqa: BLE001
        return False


def ensure(cache_dir: str) -> dict:
    """The four byclass files in cache_dir, downloading them if needed. Returns name -> path."""
    os.makedirs(cache_dir, exist_ok=True)
    paths = {n: os.path.join(cache_dir, n) for n in NAMES}
    missing = lambda: [n for n, part in zip(NAMES, PARTS) if not _check(paths[n], part)]  # noqa: E731
    if not missing():
        return paths
    errors = []
    for mirror in FILE_MIRRORS:
        try:
            for name in missing():
                print(f"Downloading {name} from {mirror.split('/{')[0]} ...", flush=True)
                _fetch(mirror.format(name=name), paths[name])
            if not missing():
                return paths
        except Exception as e:  # noqa: BLE001
            errors.append(str(e))
            print(f"  failed: {e}", flush=True)
    for url in ZIP_MIRRORS:
        zpath = os.path.join(cache_dir, "emnist.zip")
        try:
            print(f"Downloading the whole EMNIST zip from {url} ...", flush=True)
            _fetch(url, zpath)
            with zipfile.ZipFile(zpath) as zf:
                members = {os.path.basename(m): m for m in zf.namelist()}
                for name in NAMES:
                    with zf.open(members[name]) as src, open(paths[name], "wb") as dst:
                        dst.write(src.read())
            os.remove(zpath)
            if not missing():
                return paths
            errors.append(f"{url}: files in the zip are not complete")
        except Exception as e:  # noqa: BLE001
            errors.append(str(e))
            print(f"  failed: {e}", flush=True)
            if os.path.exists(zpath):
                os.remove(zpath)
    raise RuntimeError("Could not download EMNIST from any mirror:\n  " + "\n  ".join(errors))


def _idx(path: str, labels: bool) -> np.ndarray:
    raw = gzip.decompress(open(path, "rb").read())
    if labels:
        return np.frombuffer(raw, dtype=np.uint8, offset=8).astype(np.int64)
    n = int.from_bytes(raw[4:8], "big")
    imgs = np.frombuffer(raw, dtype=np.uint8, offset=16).reshape(n, 28, 28)
    return np.ascontiguousarray(imgs.transpose(0, 2, 1))  # EMNIST stores images transposed


def load(cache_dir: str):
    paths = ensure(cache_dir)
    get = lambda part: _idx(paths[f"emnist-byclass-{part}-ubyte.gz"], "labels" in part)  # noqa: E731
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
