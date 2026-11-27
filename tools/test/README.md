# Tests

| Test | Run |
| --- | --- |
| Phone database rules, re-marking and upgrades | `python3 tools/test/phone_db_test.py` |
| Printed sheet | `deno test --sloppy-imports tools/test/sheet_test.ts` |
| Handwriting reader (made-up ML Kit output, 400 made-up scripts) | `deno test --sloppy-imports tools/test/handwriting_test.ts` |
| Phone and training prepare the model's input the same way (needs numpy and deno) | `python3 tools/test/normalize_test.py` |
| Names read from scripts, matched to the class list | `deno test --sloppy-imports tools/test/nameMatch_test.ts` |
| Handwriting helper in the app | `deno test --allow-env tools/test/readHandwriting_test.ts` |
| Gemini Edge Function | `deno test --allow-env supabase/functions/read-handwriting/handler_test.ts` |
| Sheet scanner on realistic photos | see below |

## Scanner

Checks the on-phone sheet reader (`src/lib/scan`) against realistic photos of filled Skora sheets: skewed, small in the frame, upside down, sideways, uneven light, clutter on the table, faint marks, rubbed-out answers and double marks.

```bash
mkdir -p /tmp/skora-sheet
# 1. Draw a sheet (100 questions, A–D) and turn it into a PNG
deno run --sloppy-imports --allow-write tools/test/render_sheet.ts 100 4 /tmp/skora-sheet/base.svg
rsvg-convert -d 200 -p 200 -b white -f png -o /tmp/skora-sheet/base.png /tmp/skora-sheet/base.svg
# 2. Fill it in and photograph it five ways (W = photo width in pixels)
W=1131 python3 tools/test/make_photos.py /tmp/skora-sheet/base.png /tmp/skora-sheet/ph 100 4 200
# 3. Read the photos with the app's own code and compare with the true answers
node tools/test/test_scan.mjs /tmp/skora-sheet/ph-manifest.json 100 4
```

Needs Deno, Node, Python 3 with OpenCV and NumPy, and `rsvg-convert`.
