"""Checks the phone's crop normaliser (src/lib/reader/normalize.ts) gives exactly what training
uses (tools/model/normalize.py). Run: python3 tools/test/normalize_test.py (needs deno)."""
import json
import os
import subprocess
import sys
import tempfile

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "model"))
from normalize import normalize  # noqa: E402

rng = np.random.default_rng(3)
W, H = 400, 300
page = np.full((H, W), 220, dtype=np.uint8)
page += rng.integers(0, 20, size=(H, W), dtype=np.uint8)
# Some "writing": random dark strokes.
for _ in range(60):
    x, y = rng.integers(0, W - 30), rng.integers(0, H - 30)
    page[y:y + rng.integers(2, 25), x:x + rng.integers(2, 6)] = rng.integers(20, 120)
    page[y:y + 3, x:x + rng.integers(3, 25)] = rng.integers(20, 120)
# Rule lines, lighter than the writing, as on foolscap.
for y in range(20, H, 37):
    page[y:y + 2, :] = 160
boxes = []
for _ in range(200):
    x0, y0 = rng.uniform(-20, W - 10), rng.uniform(-20, H - 10)
    boxes.append([x0, y0, x0 + rng.uniform(1, 80), y0 + rng.uniform(1, 60)])
boxes += [[10, 10, 11, 11], [0, 0, W, H], [50, 50, 50, 90]]

expected = []
for b in boxes:
    x0, y0 = max(0, int(np.floor(b[0]))), max(0, int(np.floor(b[1])))
    x1, y1 = min(W, int(np.ceil(b[2]))), min(H, int(np.ceil(b[3])))
    crop = page[y0:y1, x0:x1] if x1 > x0 and y1 > y0 else np.zeros((0, 0), np.uint8)
    expected.append(normalize(crop) if crop.size else np.zeros((32, 32), np.float32))

with tempfile.TemporaryDirectory() as d:
    page.tofile(os.path.join(d, "page.bin"))
    json.dump({"width": W, "height": H, "boxes": boxes}, open(os.path.join(d, "job.json"), "w"))
    script = os.path.join(d, "run.ts")
    root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    open(script, "w").write(f"""
import {{ normalizeInto, SIZE }} from "{root}/src/lib/reader/normalize.ts";
const job = JSON.parse(Deno.readTextFileSync("{d}/job.json"));
const data = Deno.readFileSync("{d}/page.bin");
const out = new Float32Array(job.boxes.length * SIZE * SIZE);
job.boxes.forEach((b: number[], i: number) => normalizeInto({{ data, width: job.width, height: job.height }}, b, out, i * SIZE * SIZE));
Deno.writeFileSync("{d}/out.bin", new Uint8Array(out.buffer));
""")
    deno = os.environ.get("DENO", "deno")
    subprocess.run([deno, "run", "--allow-read", "--allow-write", "--sloppy-imports", script], check=True)
    got = np.fromfile(os.path.join(d, "out.bin"), dtype=np.float32).reshape(len(boxes), 32, 32)

diff = max(float(np.abs(g - e).max()) for g, e in zip(got, expected))
nonblank = sum(1 for e in expected if e.max() > 0)
assert diff < 1e-6, f"phone and training differ by {diff}"
assert nonblank > 50, f"only {nonblank} crops had writing"
print(f"normaliser: phone and training agree on {len(boxes)} crops ({nonblank} with writing), max difference {diff:.1e}")

# The model's classes, in order, must be the ones the app expects (src/lib/reader/classes.ts).
from train import CLASSES  # noqa: E402

ts = open(os.path.join(os.path.dirname(__file__), "..", "..", "src", "lib", "reader", "classes.ts")).read()
assert "[...'0123456789ABCDE', 'other', 'crossed']" in ts and CLASSES == list("0123456789ABCDE") + ["other", "crossed"], CLASSES
print("model classes: training and the app agree")

# A small training set from typed fonts, built the way training builds the real one (no TensorFlow
# needed): catches mistakes in emnist.py, synth.py and train.py before a run on GitHub does.
import emnist  # noqa: E402
from train import build_set  # noqa: E402

fx, fy, _, _ = emnist.fake(per_char=4)
bx, by = build_set(fx, fy, per_class=6, n_other=8, n_crossed=4, seed=1, workers=1)
assert bx.shape == (len(by), 32, 32, 1) and bx.dtype == np.uint8 and set(by) == set(range(len(CLASSES))), (bx.shape, set(by))
print(f"training set: {len(by)} examples built, every class present")
