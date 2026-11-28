"""Trains Skora's reader: a small model that reads one handwritten character from a script.

  python tools/model/train.py --out modules/skora-text/android/src/main/assets/skora-reader.tflite \
                              --report tools/model/report.json

Classes: the digits 0-9 (to check question numbers), the answer letters A-E (capital and small
count the same), "other" (any other letter, a mark, or nothing) and "crossed" (a crossed-out
character). The answer letters are read best by asking only about the letters an exam allows,
so the report gives accuracy for A-E and A-D separately.

The model only ships if it passes the bar on characters it never saw while training
(--min-letters-a-to-e, --min-letters for A-D, --min-digits); otherwise this exits with code 2 and
writes nothing.
"""
import argparse
import json
import multiprocessing as mp
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.path.dirname(__file__))
import emnist  # noqa: E402
from synth import sample  # noqa: E402

CLASSES = list("0123456789ABCDE") + ["other", "crossed"]
LETTERS = [CLASSES.index(c) for c in "ABCDE"]
DIGITS = list(range(10))
OTHER, CROSSED = CLASSES.index("other"), CLASSES.index("crossed")
# Letters too like a digit or an answer letter to teach as "other": O 0, I l 1, S 5, Z 2, G 6, q 9.
CONFUSABLE = set("OoQIilSsZzGgq")


def target(label: int) -> int | None:
    ch = emnist.CHARS[label]
    if ch.isdigit():
        return int(ch)
    if ch.upper() in "ABCDE":
        return CLASSES.index(ch.upper())
    if ch in CONFUSABLE:
        return None
    return OTHER


def _work(job):
    glyphs, seed, crossed = job
    return np.stack([sample(g, seed + i, crossed) for i, g in enumerate(glyphs)])


def set_jobs(x, y, per_class: int, n_other: int, n_crossed: int, seed: int):
    """The work for one set of augmented examples: per_class of each digit and letter, plus
    "other" and "crossed". Returns (jobs for _work, the label of each example, the EMNIST
    character each example was made from: "a" or "A" for an A, "" for a blank)."""
    rng = np.random.default_rng(seed)
    t = np.array([-1 if (v := target(int(l))) is None else v for l in y])
    jobs, labels, src = [], [], []

    def add(idx, label, crossed=False):
        glyphs = [None] * idx if isinstance(idx, int) else list(x[idx])
        chars = [""] * idx if isinstance(idx, int) else [emnist.CHARS[int(l)] for l in y[idx]]
        for start in range(0, len(glyphs), 500):
            part = glyphs[start:start + 500]
            jobs.append((part, int(rng.integers(0, 2**31)), crossed))
            labels.append(np.full(len(part), label))
            src.extend(chars[start:start + 500])

    for c in DIGITS + LETTERS:
        pool = np.nonzero(t == c)[0]
        add(rng.choice(pool, per_class, replace=len(pool) < per_class), c)
    other_pool = np.nonzero(t == OTHER)[0]
    n_blank = n_other // 8
    add(rng.choice(other_pool, n_other - n_blank), OTHER)
    add(n_blank, OTHER)
    answer_pool = np.nonzero(t >= 0)[0]
    answer_pool = answer_pool[t[answer_pool] != OTHER]
    add(rng.choice(answer_pool, n_crossed), CROSSED, crossed=True)
    return jobs, np.concatenate(labels), np.array(src)


def finish_set(parts, labels, seed: int, src=None):
    xs = np.concatenate(parts)[..., None]
    order = np.random.default_rng(seed).permutation(len(labels))
    return (xs[order], labels[order]) if src is None else (xs[order], labels[order], src[order])


def build_set(x, y, per_class: int, n_other: int, n_crossed: int, seed: int, workers: int):
    """One set of augmented examples, made now (used by tools/test/normalize_test.py)."""
    jobs, labels, _ = set_jobs(x, y, per_class, n_other, n_crossed, seed)
    with mp.Pool(workers) as pool:
        parts = pool.map(_work, jobs, chunksize=1)
    return finish_set(parts, labels, seed)


class Maker:
    """Makes sets of examples in worker processes that stay open for the whole training run.
    Start it before TensorFlow is imported (the workers are forked)."""

    def __init__(self, workers: int):
        self.pool = mp.Pool(workers)

    def start(self, x, y, per_class, n_other, n_crossed, seed):
        jobs, labels, src = set_jobs(x, y, per_class, n_other, n_crossed, seed)
        return self.pool.map_async(_work, jobs, chunksize=1), labels, src, seed

    @staticmethod
    def get(started, with_src: bool = False):
        job, labels, src, seed = started
        return finish_set(job.get(), labels, seed, src if with_src else None)

    def close(self):
        self.pool.close()
        self.pool.join()


def build_model(n_classes: int):
    import tensorflow as tf
    from tensorflow import keras
    from tensorflow.keras import layers

    inp = keras.Input((32, 32, 1))
    x = layers.Rescaling(1 / 255.0)(inp)
    # Wider at the small 8 x 8 and 4 x 4 stages, which are cheap to train: with a fresh set every
    # round the 24-48-96-128 model no longer learnt by heart, it ran out of room (95% right on
    # both its own sets and the test set).
    for filters in (24, 48, 128):
        for _ in range(2):
            x = layers.Conv2D(filters, 3, padding="same", use_bias=False)(x)
            x = layers.BatchNormalization()(x)
            x = layers.ReLU()(x)
        x = layers.MaxPooling2D()(x)
    x = layers.Conv2D(192, 3, padding="same", use_bias=False)(x)
    x = layers.BatchNormalization()(x)
    x = layers.ReLU()(x)
    x = layers.GlobalAveragePooling2D()(x)
    x = layers.Dropout(0.3)(x)
    out = layers.Dense(n_classes, activation="softmax")(x)
    return keras.Model(inp, out), tf


def metrics(probs: np.ndarray, y: np.ndarray) -> dict:
    """Accuracy the way Skora uses the model."""
    out = {"all_classes": float((probs.argmax(1) == y).mean())}
    for name, allowed in (("letters_A_to_E", "ABCDE"), ("letters_A_to_D", "ABCD")):
        idx = [CLASSES.index(c) for c in allowed]
        m = np.isin(y, idx)
        pick = np.array(idx)[probs[m][:, idx].argmax(1)]
        out[name] = float((pick == y[m]).mean())
    m = y < 10
    out["digits"] = float((probs[m][:, DIGITS].argmax(1) == y[m]).mean())
    # When the model is sure (90% or more), how often it is right, and how often it is sure.
    m = np.isin(y, LETTERS)
    p = probs[m]
    sure = p.max(1) >= 0.9
    out["letters_when_sure"] = float((p[sure].argmax(1) == y[m][sure]).mean()) if sure.any() else 0.0
    out["letters_sure_share"] = float(sure.mean())
    out["per_class"] = {c: float((probs[y == i].argmax(1) == i).mean()) for i, c in enumerate(CLASSES) if (y == i).any()}
    return out


def letter_mixups(probs: np.ndarray, y: np.ndarray, src: np.ndarray) -> dict:
    """Which answer letters are misread, the way Skora reads an A-E exam: for each capital and
    small letter, how often it is read right, and the most common mix-ups ("b read as D")."""
    idx = [CLASSES.index(c) for c in "ABCDE"]
    m = np.isin(y, idx)
    pick = np.array(idx)[probs[m][:, idx].argmax(1)]
    truth, chars = y[m], src[m]
    by_char = {}
    for ch in sorted(set(chars), key=lambda c: (c.upper(), c.islower())):
        k = chars == ch
        by_char[ch] = {"right": float((pick[k] == truth[k]).mean()), "examples": int(k.sum())}
    wrong = pick != truth
    pairs = {}
    for ch, p in zip(chars[wrong], pick[wrong]):
        key = f"{ch} read as {CLASSES[p]}"
        pairs[key] = pairs.get(key, 0) + 1
    top = dict(sorted(pairs.items(), key=lambda kv: -kv[1])[:10])
    return {"by_character": by_char, "mixups": top, "wrong": int(wrong.sum()), "letters": int(m.sum())}


def print_mixups(mx: dict) -> None:
    print(f"Letters A-E: {mx['letters'] - mx['wrong']} of {mx['letters']} right. By letter (capital / small):")
    for ch, v in mx["by_character"].items():
        print(f"  {ch}: {v['right']:.1%} right ({v['examples']} test letters)")
    print("Most common mix-ups:")
    for k, n in mx["mixups"].items():
        print(f"  {k}: {n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--report", required=True)
    ap.add_argument("--info", help="a short summary for the app to show (src/lib/reader/modelInfo.json)")
    ap.add_argument("--cache", default=os.path.expanduser("~/.cache/skora-emnist"))
    ap.add_argument("--fake", action="store_true", help="typed fonts instead of EMNIST, to test the code quickly")
    ap.add_argument("--per-class", type=int, default=14000)
    ap.add_argument("--test-per-class", type=int, default=1500)
    ap.add_argument("--epochs", type=int, default=12)
    ap.add_argument("--min-letters", type=float, default=0.98, help="bar for letters A-D")
    ap.add_argument("--min-letters-a-to-e", type=float, default=0.975,
                    help="bar for letters A-E (lower: some handwritten letters in EMNIST stay ambiguous)")
    ap.add_argument("--min-digits", type=float, default=0.98)
    ap.add_argument("--workers", type=int, default=os.cpu_count() or 2)
    args = ap.parse_args()
    started = time.time()

    trx, try_, tex, tey = emnist.fake() if args.fake else emnist.load(args.cache)
    print(f"characters: {len(try_)} to learn from, {len(tey)} kept apart for testing", flush=True)
    maker = Maker(args.workers)  # before TensorFlow, so its workers are forked without it
    n = args.per_class
    train_set = lambda r: maker.start(trx, try_, n, int(n * 1.5), n, seed=1 + 1000 * r)  # noqa: E731
    k = args.test_per_class
    vx, vy, vsrc = Maker.get(maker.start(tex, tey, k, k, k, seed=2), with_src=True)
    x, y = Maker.get(train_set(0))
    print(f"examples: {len(y)} for training each round, {len(vy)} for testing ({time.time() - started:.0f} s)", flush=True)

    model, tf = build_model(len(CLASSES))
    steps = int(np.ceil(len(y) / 256)) * args.epochs
    lr = tf.keras.optimizers.schedules.CosineDecay(2e-3, steps, alpha=0.02)
    model.compile(
        optimizer=tf.keras.optimizers.Adam(lr),
        loss=tf.keras.losses.SparseCategoricalCrossentropy(),
        metrics=["accuracy"],
    )
    # Every round learns from a fresh set: other characters from EMNIST, and new paper, pens,
    # blur and cut-outs. With one set seen ten times the model learnt those exact pictures by
    # heart (98% right on them, but 95% on the test characters). Each set is made between rounds:
    # making it while the model trains slows both down (they share the same few CPU cores).
    for r in range(args.epochs):
        t0 = time.time()
        if r > 0:
            x, y = Maker.get(train_set(r))
        t1 = time.time()
        h = model.fit(x, y, batch_size=256, initial_epoch=r, epochs=r + 1, validation_data=(vx, vy), verbose=0).history
        print(f"Round {r + 1}/{args.epochs} - new set {t1 - t0:.0f}s, training {time.time() - t1:.0f}s"
              f" - accuracy: {h['accuracy'][-1]:.4f} - val_accuracy: {h['val_accuracy'][-1]:.4f}"
              f" - val_loss: {h['val_loss'][-1]:.4f}", flush=True)
    maker.close()

    keras_metrics = metrics(model.predict(vx, batch_size=1024, verbose=0), vy)
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite = converter.convert()

    # Check the file the phone will run, not just the model in memory.
    interp = tf.lite.Interpreter(model_content=tflite)
    inp = interp.get_input_details()[0]
    interp.resize_tensor_input(inp["index"], [len(vy), 32, 32, 1])
    interp.allocate_tensors()
    interp.set_tensor(inp["index"], vx.astype(np.float32))
    interp.invoke()
    probs = interp.get_tensor(interp.get_output_details()[0]["index"])
    m = metrics(probs, vy)
    m["letters_A_to_E_detail"] = letter_mixups(probs, vy, vsrc)

    report = {
        "model": "skora-reader",
        "version": time.strftime("%Y%m%d%H%M", time.gmtime()),
        "classes": CLASSES,
        "input": [32, 32, 1],
        "input_scale": "0 to 255, 0 = paper, 255 = ink (see tools/model/normalize.py)",
        "data": "fake (typed fonts)" if args.fake else "EMNIST byclass (NIST)",
        "train_examples": int(len(y)),
        "test_examples": int(len(vy)),
        "epochs": args.epochs,
        "size_bytes": len(tflite),
        "seconds": round(time.time() - started),
        "test": m,
        "test_before_tflite": keras_metrics,
    }
    print(json.dumps({k: v for k, v in m.items() if k not in ("per_class", "letters_A_to_E_detail")}, indent=2))
    print_mixups(m["letters_A_to_E_detail"])
    ok = (m["letters_A_to_E"] >= args.min_letters_a_to_e and m["letters_A_to_D"] >= args.min_letters
          and m["digits"] >= args.min_digits)
    report["passed"] = bool(ok)
    os.makedirs(os.path.dirname(os.path.abspath(args.report)), exist_ok=True)
    with open(args.report, "w") as f:
        json.dump(report, f, indent=2)
    if not ok:
        print(f"Below the bar (letters A-E {args.min_letters_a_to_e:.1%}, A-D {args.min_letters:.1%},"
              f" digits {args.min_digits:.1%}): the model is not saved.")
        sys.exit(2)
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "wb") as f:
        f.write(tflite)
    if args.info:
        with open(args.info, "w") as f:
            json.dump({
                "version": report["version"],
                "trainedOn": time.strftime("%Y-%m-%d", time.gmtime()),
                "data": report["data"],
                "lettersAtoE": round(m["letters_A_to_E"], 4),
                "lettersAtoD": round(m["letters_A_to_D"], 4),
                "digits": round(m["digits"], 4),
                "testExamples": int(len(vy)),
            }, f, indent=2)
            f.write("\n")
    print(f"Saved {args.out} ({len(tflite) / 1024:.0f} KB) in {time.time() - started:.0f} s")


if __name__ == "__main__":
    main()
