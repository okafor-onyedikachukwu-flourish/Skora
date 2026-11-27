# Skora

An Android app that helps a teacher mark objective exam scripts with her phone. She enters the answer key once, scans each script, checks the score, then saves it under the student's name or discards it.

- **For teachers only.** No log-in, no school accounts. Heads of department use it like any other teacher.
- **Scripts:** Skora-printed bubble sheets (read on the phone, no AI) and handwritten answers on any paper, such as foolscap (ML Kit on the phone first; only unclear scripts go to Gemini).
- **Data stays on the phone** in a SQLite database. Scores export to a spreadsheet; a backup file restores everything on a new phone.
- **Supabase** (project "Zelvo") does one job: the `read-handwriting` Edge Function passes unclear handwriting to Gemini, so the Gemini key never sits in the APK.

Built with Expo (SDK 58) and Expo Router. The APK is built by GitHub Actions when started by hand (Actions → Build APK → Run workflow) and published under Releases; the app offers new builds itself.

## Build stages

1. **Done:** phone database (tables, checks, marking triggers, report views)
2. **Done:** Supabase clean-up, Gemini request limits, `read-handwriting` Edge Function
3. **Done:** first-run screen, classes and class lists (typed, pasted, CSV or Excel), settings, backup and restore
4. **Done:** exams, answer keys with marks per question, printable Skora answer sheets (no code on them)
5. **Done:** scanning Skora sheets: camera or gallery, bubble reader on the phone, result screen with unclear answers to check, Save (name, subject, date) or Discard
6. **Done:** handwritten scripts on any paper (up to 4 pages, camera, gallery or Google's page scanner): ML Kit on the phone finds answers like "12. B", Gemini reads the ones it is not sure of, and scripts wait in a list when there is no internet
7. Scores: class summary, question analysis, spreadsheet export
8. Test with real scripts, adjust the reading thresholds, release

## Where things are

| Path | What |
| --- | --- |
| `src/app/` | Screens (Expo Router) |
| `src/lib/db/` | Phone database: schema, settings, classes, exams and keys, saved scripts, the waiting list, backup |
| `src/lib/sheet/` | Answer sheet layout and printing (see `docs/answer-sheet-layout.md`) |
| `src/lib/nameMatch.ts` | Matches the name read from a script to the class list (forgiving of misreadings) |
| `src/lib/handwriting/` | Finds answers in the text ML Kit reads (`parse.ts`) and runs a handwritten script through the phone and Gemini (`script.ts`) |
| `src/lib/readHandwriting.ts` | Calls `read-handwriting` and combines Gemini's answers with ML Kit's |
| `modules/skora-text/` | Small native module: ML Kit text recognition (with word and character boxes), fast greyscale photos, and Skora's own reader model (LiteRT) |
| `src/lib/reader/` | Prepares cut-outs of letters and digits for Skora's own model and runs it |
| `tools/model/` | Trains Skora's own reader model (see tools/model/README.md) |
| `src/lib/config.ts` | Supabase URL and publishable key (safe in the app) |
| `supabase/` | Migration, Edge Function and `config.toml` |
| `tools/` | Tests, and the script that draws the app icons |

## Checks

```bash
npx tsc --noEmit                       # typecheck
npx eslint src modules                 # lint
python3 tools/test/phone_db_test.py    # phone database rules
deno test --allow-env supabase/functions/read-handwriting/handler_test.ts tools/test/readHandwriting_test.ts
deno test --sloppy-imports tools/test/sheet_test.ts tools/test/handwriting_test.ts tools/test/nameMatch_test.ts
```

## Gemini

Add `GEMINI_API_KEY` under Supabase → Edge Functions → Secrets. Optional secrets: `GEMINI_MODELS` (models to try in order, default `gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.8-flash`), `GEMINI_MODEL` (one model to try first), `SKORA_PER_PHONE_DAILY` (default 100), `SKORA_ALL_PHONES_DAILY` (default 200; keep it under the free daily limit Google AI Studio shows). Teachers can turn Gemini off in Settings.

When a model is overloaded, out of free quota or slow, the helper moves on to the next one and puts the busy model at the back of the line for three minutes. Thinking is set to the lowest level each model allows, and all tries together stop after 45 seconds. A request no model answered does not count against the daily limit. In the app, the result screen opens straight away with the phone's reading; Gemini checks the unclear answers in the background, and the teacher can fix or save without waiting.

## Handwritten scripts

Students write each answer as a number and a letter, for example `1. B`, `1) b`, `1-B` or `1B`, in one or more columns or several on a line. On the phone, ML Kit reads the writing and `src/lib/handwriting/parse.ts` finds the answers. An answer counts as clear only when it was read plainly, its number sits in order between the numbers around it and nothing else claims that question; everything else is checked by Gemini (when it is on) or by the teacher. The rule the tests hold it to: an answer Skora calls clear is never wrong.

The thresholds (`MIN_CONFIDENCE`, the order checks) were set on made-up scripts and need tuning with photos of real ones.

## Names

Skora reads the student's name, class and subject from the script: the boxes on a Skora sheet, or lines such as `Name: Ada Obi  Class: JSS 2A` at the top of a handwritten script. A name that clearly matches one student in the exam's class lists (or a name saved before) fills in the Save form; a close call is offered as names to tap. Settings → How well Skora reads shows how many of the answers it read the teacher had to change.
