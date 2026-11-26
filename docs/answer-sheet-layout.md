# Skora answer sheet, layout 1

The printed sheet and the scanner must agree on where everything is. The source of truth is `src/lib/sheet/layout.ts`; this page explains it. Never change layout 1 in place: make layout 2 instead, so sheets that were already printed keep working.

All measurements are in **millimetres on an A4 page (210 × 297)**, origin top-left. There is **no code on the sheet**: the teacher picks the exam before scanning, and types the student's name, subject and date when saving.

## Finding the page

- Four solid black squares, 7 × 7 mm, centred at (12, 12), (198, 12), (12, 285) and (198, 285).
- One smaller solid square, 4 × 4 mm, at x 19.5–23.5, y 10–14: just right of the **top-left** square only. It tells the scanner which way up the page is.
- Map the four square centres in the photo onto those points (perspective transform) to straighten the page. Scaling by the printer ("fit to page") doesn't matter, because everything is relative to the squares.

## Boxes the student writes in

Skora doesn't read these; they are for the teacher.

| Box | x | y | width | height |
| --- | --- | --- | --- | --- |
| Full name | 12 | 50 | 118 | 12 |
| Date | 134 | 50 | 64 | 12 |
| Class | 12 | 66 | 70 | 11 |
| Subject | 88 | 66 | 110 | 11 |

## Bubble grid

| Setting | Value |
| --- | --- |
| Top of first row | 96 |
| Usable width | 12 to 198 |
| Rows per column | 25 (in blocks of 5, 2.6 mm gap between blocks) |
| Row height | 6.6 |
| Question number width | 9 |
| Bubble pitch / diameter | 6.2 / 4.6 |
| Gap between columns | 4 |

Columns are centred in the usable width. A–D fits 5 columns (125 questions) and A–E fits 4 (100 questions), so every Skora exam (at most 100 questions) is **one page**. Question *i* (0-based) is in column ⌊i / 25⌋, row i mod 25; see `rowPosition` and `bubbleCentre`.
