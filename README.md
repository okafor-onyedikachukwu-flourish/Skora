# Skora

An Android app that helps a teacher mark objective exam scripts with her phone. She enters the answer key once, scans each script, checks the score, then saves it under the student's name or discards it.

- **For teachers only.** No log-in, no school accounts. Heads of department use it like any other teacher.
- **Scripts:** Skora-printed bubble sheets (read on the phone, no AI) and handwritten answers on any paper, such as foolscap (ML Kit on the phone first; only unclear scripts go to Gemini).
- **Data stays on the phone** in a SQLite database. Scores export to a spreadsheet; a backup file restores everything on a new phone.
- **Supabase** (project "Zelvo") does one job: the `read-handwriting` Edge Function passes unclear handwriting to Gemini, so the Gemini key never sits in the APK.

Built with Expo (SDK 58) and Expo Router. The APK is built by GitHub Actions and published under Releases; the app offers new builds itself.

## Build stages

1. **Done:** phone database (tables, checks, marking triggers, report views)
2. **Done:** Supabase clean-up, Gemini request limits, `read-handwriting` Edge Function
3. **Done:** first-run screen, classes and class lists (typed, pasted, CSV or Excel), settings, backup and restore
4. Exams, answer keys with marks per question, printable Skora answer sheets
5. Scanning Skora sheets: camera, bubble reader, result screen, Save or Discard
6. Handwriting: ML Kit reader, Gemini for unclear scripts, the waiting queue
7. Scores: class summary, question analysis, spreadsheet export
8. Test with real scripts, adjust the reading thresholds, release

## Where things are

| Path | What |
| --- | --- |
| `src/app/` | Screens (Expo Router) |
| `src/lib/db/` | Phone database: schema, settings, classes, backup |
| `src/lib/readHandwriting.ts` | Calls `read-handwriting` and combines Gemini's answers with ML Kit's |
| `src/lib/config.ts` | Supabase URL and publishable key (safe in the app) |
| `supabase/` | Migration, Edge Function and `config.toml` |
| `tools/` | Tests, and the script that draws the app icons |

## Checks

```bash
npx tsc --noEmit                       # typecheck
npx eslint src                         # lint
python3 tools/test/phone_db_test.py    # phone database rules
deno test --allow-env supabase/functions/read-handwriting/handler_test.ts tools/test/readHandwriting_test.ts
```

## Gemini

Add `GEMINI_API_KEY` under Supabase → Edge Functions → Secrets. Optional secrets: `GEMINI_MODEL` (default `gemini-3.8-flash`), `SKORA_PER_PHONE_DAILY` (default 100), `SKORA_ALL_PHONES_DAILY` (default 200; keep it under the free daily limit Google AI Studio shows). Teachers can turn Gemini off in Settings.
