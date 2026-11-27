# Skora's reader model

A small model (about 300 KB) that reads one handwritten character from an answer script, on the
phone and without internet. It reads the digits 0–9 and the letters A–E (capital or small), and
it also says when a cut-out is something else, or is crossed out.

On a handwritten script, ML Kit finds where each answer is ("12. B"); then this model reads each
letter and digit again. When both agree, the answer is clear. When they disagree, or the model
sees a crossed-out letter or a doubtful question number, Gemini (if it is on) and then the
teacher decide. See `judgeCandidate` in `src/lib/handwriting/parse.ts`.

## Training

Actions → **Train reader model** → Run workflow. On GitHub's computers it:

1. downloads EMNIST (NIST's handwritten characters, about 800,000 of them) the first time;
2. turns each character into what a phone photo of a script looks like (`synth.py`): any paper
   shade, shadows, foolscap rule lines, blue or black ink, thick or thin pens, slant, blur, phone
   JPEG, loose or tight cut-outs, a full stop beside it, crossings-out;
3. trains the model (`train.py`) and tests it on characters it never saw;
4. only if letters (A–E and A–D) and digits are each at least 98% right, saves it into the app
   (`modules/skora-text/android/src/main/assets/skora-reader.tflite`, with `report.json` and
   `src/lib/reader/modelInfo.json`) and commits it.

Then run **Build APK** to put it in the app. Without the model file the app still works: ML Kit
and Gemini read handwriting as before.

## Keeping the phone and training the same

`normalize.py` (training) and `src/lib/reader/normalize.ts` (phone) turn a cut-out into the
model's 32 × 32 input in exactly the same way; `tools/test/normalize_test.py` checks that they
agree, and that the class list matches `src/lib/reader/classes.ts`. Change them together.

## Trying it here

`python tools/model/train.py --fake ...` runs everything on typed fonts instead of EMNIST, to
test the code quickly; the model it makes is not useful.
