// Skora phone database (SQLite). Current version: 2.
//   SCHEMA          creates everything on a new phone (PRAGMA user_version 0).
//   MIGRATE_1_TO_2  upgrades a phone that ran the first test build.
// Tested by tools/test/phone_db_test.py. Never change a released version:
// add the next MIGRATE_n_TO_m instead.

const BASE = `
-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------

-- Teacher's own settings, one row per setting.
--   teacher_name       printed on Skora sheets (optional)
--   school_name        printed on Skora sheets (optional)
--   pass_mark_percent  used for pass rates; starts at 50
--   gemini_on          1 = send unclear handwriting to Gemini, 0 = never
--   device_id          random id sent with Gemini requests (daily limit)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO settings (key, value) VALUES
  ('pass_mark_percent', '50'),
  ('gemini_on',         '1'),
  ('device_id',         lower(hex(randomblob(16))));

-- The classes this teacher marks for, e.g. SS2A, JSS1B.
CREATE TABLE classes (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 40),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE UNIQUE INDEX classes_name_unique ON classes (lower(trim(name)));

-- Optional class list (typed in or read from a spreadsheet).
-- Used only to suggest names while the teacher types on Save.
CREATE TABLE class_names (
  id         INTEGER PRIMARY KEY,
  class_id   INTEGER NOT NULL REFERENCES classes (id) ON DELETE CASCADE,
  full_name  TEXT NOT NULL CHECK (length(trim(full_name)) BETWEEN 2 AND 120)
);
CREATE UNIQUE INDEX class_names_unique ON class_names (class_id, lower(trim(full_name)));
`;

const EXAMS = `
-- One row per exam paper: its answer key and the classes that write it.
-- Subject and date are typed by the teacher on each saved script.
--   question_count  1 to 100 (always one printed page)
--   option_count    4 = A to D, 5 = A to E
--   total_marks     kept equal to the sum of the key's marks (section 3)
CREATE TABLE exams (
  id              INTEGER PRIMARY KEY,
  title           TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 2 AND 120),
  question_count  INTEGER NOT NULL CHECK (question_count BETWEEN 1 AND 100),
  option_count    INTEGER NOT NULL CHECK (option_count IN (4, 5)),
  total_marks     REAL NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Which classes wrote each exam (one paper can go to several classes).
CREATE TABLE exam_classes (
  exam_id   INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  class_id  INTEGER NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  PRIMARY KEY (exam_id, class_id)
) WITHOUT ROWID;

-- The answer key: one row per question, with its marks.
CREATE TABLE answer_keys (
  exam_id         INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  question_no     INTEGER NOT NULL CHECK (question_no BETWEEN 1 AND 100),
  correct_option  TEXT NOT NULL CHECK (correct_option IN ('A', 'B', 'C', 'D', 'E')),
  marks           REAL NOT NULL DEFAULT 1 CHECK (marks > 0),
  PRIMARY KEY (exam_id, question_no)
) WITHOUT ROWID;

-- One row per script the teacher chose to save.
--   student_name  typed by the teacher; the app trims it and turns
--                 runs of spaces into one space before saving
--   name_key      lower-case copy, so "Ada Obi" and "ada obi" match
--   subject       typed by the teacher on Save, e.g. Mathematics
--   written_on    the date of the exam, chosen on Save (YYYY-MM-DD)
--   read_by       phone, gemini, or both
--   score         set by the marking triggers, never by the app
-- Removing a class from an exam also removes that class's saved
-- scripts for the exam, so the app must warn before doing it.
CREATE TABLE saved_scripts (
  id             INTEGER PRIMARY KEY,
  exam_id        INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  class_id       INTEGER NOT NULL REFERENCES classes (id) ON DELETE RESTRICT,
  student_name   TEXT NOT NULL CHECK (length(trim(student_name)) BETWEEN 2 AND 120),
  name_key       TEXT GENERATED ALWAYS AS (lower(trim(student_name))) STORED,
  subject        TEXT NOT NULL CHECK (length(trim(subject)) BETWEEN 1 AND 80),
  written_on     TEXT NOT NULL CHECK (date(written_on) IS written_on),
  sheet_type     TEXT NOT NULL CHECK (sheet_type IN ('omr', 'handwritten')),
  read_by        TEXT NOT NULL CHECK (read_by IN ('phone', 'gemini', 'both')),
  score          REAL NOT NULL DEFAULT 0,
  max_score      REAL NOT NULL DEFAULT 0,
  teacher_fixes  INTEGER NOT NULL DEFAULT 0 CHECK (teacher_fixes >= 0),
  saved_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (exam_id, class_id, name_key),
  FOREIGN KEY (exam_id, class_id) REFERENCES exam_classes (exam_id, class_id) ON DELETE CASCADE
);
CREATE INDEX saved_scripts_class ON saved_scripts (class_id);
CREATE INDEX saved_scripts_subject ON saved_scripts (lower(subject));

-- What was read for each question of a saved script.
--   chosen  a letter, 'blank' (nothing chosen) or 'several' (more than one)
--   source  omr, mlkit, gemini, or teacher (the teacher picked it)
-- Kept so every score re-marks itself if the key changes.
CREATE TABLE saved_answers (
  script_id      INTEGER NOT NULL REFERENCES saved_scripts (id) ON DELETE CASCADE,
  question_no    INTEGER NOT NULL CHECK (question_no BETWEEN 1 AND 100),
  chosen         TEXT NOT NULL CHECK (chosen IN ('A', 'B', 'C', 'D', 'E', 'blank', 'several')),
  source         TEXT NOT NULL CHECK (source IN ('omr', 'mlkit', 'gemini', 'teacher')),
  is_correct     INTEGER NOT NULL DEFAULT 0 CHECK (is_correct IN (0, 1)),
  marks_awarded  REAL NOT NULL DEFAULT 0,
  PRIMARY KEY (script_id, question_no)
) WITHOUT ROWID;

-- Scans waiting for Gemini or for internet. Photos stay as files on
-- the phone until the teacher saves or discards the script; then the
-- app deletes the photos and this row.
--   photo_uris      JSON list of 1 or 2 photo files (front, back)
--   phone_answers   JSON, what the phone read: [{"q":1,"chosen":"B","clear":true}, ...]
--   gemini_answers  JSON, what Gemini read, once it comes back
CREATE TABLE scan_queue (
  id              INTEGER PRIMARY KEY,
  exam_id         INTEGER NOT NULL REFERENCES exams (id) ON DELETE CASCADE,
  sheet_type      TEXT NOT NULL CHECK (sheet_type IN ('omr', 'handwritten')),
  photo_uris      TEXT NOT NULL CHECK (json_valid(photo_uris)),
  phone_answers   TEXT NOT NULL CHECK (json_valid(phone_answers)),
  gemini_answers  TEXT CHECK (gemini_answers IS NULL OR json_valid(gemini_answers)),
  status          TEXT NOT NULL DEFAULT 'waiting'
                    CHECK (status IN ('waiting', 'sending', 'read', 'failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX scan_queue_status ON scan_queue (status, created_at);

-- ---------------------------------------------------------------------
-- 2. Checks
-- ---------------------------------------------------------------------

-- A key row must fit the exam's questions and options.
CREATE TRIGGER answer_keys_check_insert
BEFORE INSERT ON answer_keys
BEGIN
  SELECT RAISE(ABORT, 'Question number is beyond this exam''s questions')
   WHERE NEW.question_no > (SELECT question_count FROM exams WHERE id = NEW.exam_id);
  SELECT RAISE(ABORT, 'This exam uses options A to D only')
   WHERE NEW.correct_option = 'E'
     AND (SELECT option_count FROM exams WHERE id = NEW.exam_id) = 4;
END;

CREATE TRIGGER answer_keys_check_update
BEFORE UPDATE ON answer_keys
BEGIN
  SELECT RAISE(ABORT, 'Question number is beyond this exam''s questions')
   WHERE NEW.question_no > (SELECT question_count FROM exams WHERE id = NEW.exam_id);
  SELECT RAISE(ABORT, 'This exam uses options A to D only')
   WHERE NEW.correct_option = 'E'
     AND (SELECT option_count FROM exams WHERE id = NEW.exam_id) = 4;
END;

-- A saved answer must fit the exam's questions and options.
CREATE TRIGGER saved_answers_check
BEFORE INSERT ON saved_answers
BEGIN
  SELECT RAISE(ABORT, 'Question number is beyond this exam''s questions')
   WHERE NEW.question_no > (
     SELECT e.question_count FROM exams e
       JOIN saved_scripts s ON s.exam_id = e.id
      WHERE s.id = NEW.script_id);
  SELECT RAISE(ABORT, 'This exam uses options A to D only')
   WHERE NEW.chosen = 'E' AND (
     SELECT e.option_count FROM exams e
       JOIN saved_scripts s ON s.exam_id = e.id
      WHERE s.id = NEW.script_id) = 4;
END;

-- Once scores are saved, the number of questions and options is fixed.
CREATE TRIGGER exams_lock_shape
BEFORE UPDATE OF question_count, option_count ON exams
WHEN (NEW.question_count <> OLD.question_count OR NEW.option_count <> OLD.option_count)
 AND EXISTS (SELECT 1 FROM saved_scripts WHERE exam_id = OLD.id)
BEGIN
  SELECT RAISE(ABORT, 'Scores are already saved for this exam, so its questions and options cannot change');
END;

-- Before any score is saved, shrinking the exam tidies its key.
CREATE TRIGGER exams_trim_key
AFTER UPDATE OF question_count, option_count ON exams
BEGIN
  DELETE FROM answer_keys
   WHERE exam_id = NEW.id
     AND (question_no > NEW.question_count
          OR (NEW.option_count = 4 AND correct_option = 'E'));
END;

-- ---------------------------------------------------------------------
-- 3. Marking
-- ---------------------------------------------------------------------
-- The app shows a preview score before Save. These triggers work the
-- score out again in the database, so a saved score always matches
-- the current key.

-- A new answer is marked against the key, then the script's score is
-- added up again.
CREATE TRIGGER saved_answers_mark_insert
AFTER INSERT ON saved_answers
BEGIN
  UPDATE saved_answers
     SET is_correct = EXISTS (
           SELECT 1 FROM answer_keys k JOIN saved_scripts s ON s.exam_id = k.exam_id
            WHERE s.id = NEW.script_id AND k.question_no = NEW.question_no
              AND k.correct_option = NEW.chosen),
         marks_awarded = coalesce((
           SELECT k.marks FROM answer_keys k JOIN saved_scripts s ON s.exam_id = k.exam_id
            WHERE s.id = NEW.script_id AND k.question_no = NEW.question_no
              AND k.correct_option = NEW.chosen), 0)
   WHERE script_id = NEW.script_id AND question_no = NEW.question_no;

  UPDATE saved_scripts
     SET score     = (SELECT coalesce(sum(marks_awarded), 0) FROM saved_answers WHERE script_id = NEW.script_id),
         max_score = (SELECT e.total_marks FROM exams e WHERE e.id = saved_scripts.exam_id)
   WHERE id = NEW.script_id;
END;

-- The teacher changes a saved answer later.
CREATE TRIGGER saved_answers_mark_update
AFTER UPDATE OF chosen ON saved_answers
BEGIN
  UPDATE saved_answers
     SET is_correct = EXISTS (
           SELECT 1 FROM answer_keys k JOIN saved_scripts s ON s.exam_id = k.exam_id
            WHERE s.id = NEW.script_id AND k.question_no = NEW.question_no
              AND k.correct_option = NEW.chosen),
         marks_awarded = coalesce((
           SELECT k.marks FROM answer_keys k JOIN saved_scripts s ON s.exam_id = k.exam_id
            WHERE s.id = NEW.script_id AND k.question_no = NEW.question_no
              AND k.correct_option = NEW.chosen), 0)
   WHERE script_id = NEW.script_id AND question_no = NEW.question_no;

  UPDATE saved_scripts
     SET score = (SELECT coalesce(sum(marks_awarded), 0) FROM saved_answers WHERE script_id = NEW.script_id)
   WHERE id = NEW.script_id;
END;

-- A key row is added: update the exam total, re-mark that question in
-- every saved script of the exam, then add the scores up again.
CREATE TRIGGER answer_keys_remark_insert
AFTER INSERT ON answer_keys
BEGIN
  UPDATE exams
     SET total_marks = (SELECT coalesce(sum(marks), 0) FROM answer_keys WHERE exam_id = NEW.exam_id)
   WHERE id = NEW.exam_id;

  UPDATE saved_answers
     SET is_correct    = (chosen = NEW.correct_option),
         marks_awarded = CASE WHEN chosen = NEW.correct_option THEN NEW.marks ELSE 0 END
   WHERE question_no = NEW.question_no
     AND script_id IN (SELECT id FROM saved_scripts WHERE exam_id = NEW.exam_id);

  UPDATE saved_scripts
     SET score     = (SELECT coalesce(sum(a.marks_awarded), 0) FROM saved_answers a WHERE a.script_id = saved_scripts.id),
         max_score = (SELECT e.total_marks FROM exams e WHERE e.id = NEW.exam_id)
   WHERE exam_id = NEW.exam_id;
END;

-- A key row is changed (a corrected answer or new marks).
CREATE TRIGGER answer_keys_remark_update
AFTER UPDATE ON answer_keys
BEGIN
  UPDATE exams
     SET total_marks = (SELECT coalesce(sum(marks), 0) FROM answer_keys WHERE exam_id = NEW.exam_id)
   WHERE id = NEW.exam_id;

  UPDATE saved_answers
     SET is_correct    = (chosen = NEW.correct_option),
         marks_awarded = CASE WHEN chosen = NEW.correct_option THEN NEW.marks ELSE 0 END
   WHERE question_no = NEW.question_no
     AND script_id IN (SELECT id FROM saved_scripts WHERE exam_id = NEW.exam_id);

  UPDATE saved_scripts
     SET score     = (SELECT coalesce(sum(a.marks_awarded), 0) FROM saved_answers a WHERE a.script_id = saved_scripts.id),
         max_score = (SELECT e.total_marks FROM exams e WHERE e.id = NEW.exam_id)
   WHERE exam_id = NEW.exam_id;
END;

-- A key row is removed: nobody gets marks for that question.
CREATE TRIGGER answer_keys_remark_delete
AFTER DELETE ON answer_keys
BEGIN
  UPDATE exams
     SET total_marks = (SELECT coalesce(sum(marks), 0) FROM answer_keys WHERE exam_id = OLD.exam_id)
   WHERE id = OLD.exam_id;

  UPDATE saved_answers
     SET is_correct = 0, marks_awarded = 0
   WHERE question_no = OLD.question_no
     AND script_id IN (SELECT id FROM saved_scripts WHERE exam_id = OLD.exam_id);

  UPDATE saved_scripts
     SET score     = (SELECT coalesce(sum(a.marks_awarded), 0) FROM saved_answers a WHERE a.script_id = saved_scripts.id),
         max_score = (SELECT e.total_marks FROM exams e WHERE e.id = OLD.exam_id)
   WHERE exam_id = OLD.exam_id;
END;

-- ---------------------------------------------------------------------
-- 4. Report views
-- ---------------------------------------------------------------------

-- Every saved script with its percentage and position in the class.
CREATE VIEW script_results AS
SELECT s.id, s.exam_id, s.class_id, c.name AS class_name, s.student_name,
       s.subject, s.written_on, s.score, s.max_score,
       round(100.0 * s.score / nullif(s.max_score, 0), 1) AS percent,
       rank() OVER (PARTITION BY s.exam_id, s.class_id ORDER BY s.score DESC) AS position,
       s.sheet_type, s.read_by, s.teacher_fixes, s.saved_at
  FROM saved_scripts s
  JOIN classes c ON c.id = s.class_id;

-- One row per exam and class: the class summary on the Scores screen.
CREATE VIEW exam_class_summary AS
SELECT s.exam_id, s.class_id, c.name AS class_name,
       count(*) AS scripts_saved,
       round(avg(100.0 * s.score / nullif(s.max_score, 0)), 1) AS average_percent,
       round(max(100.0 * s.score / nullif(s.max_score, 0)), 1) AS highest_percent,
       round(min(100.0 * s.score / nullif(s.max_score, 0)), 1) AS lowest_percent,
       round(100.0 * sum(CASE WHEN s.max_score > 0
                               AND 100.0 * s.score / s.max_score >=
                                   (SELECT CAST(value AS REAL) FROM settings WHERE key = 'pass_mark_percent')
                              THEN 1 ELSE 0 END) / count(*), 1) AS pass_rate_percent
  FROM saved_scripts s
  JOIN classes c ON c.id = s.class_id
 GROUP BY s.exam_id, s.class_id;

-- One row per exam and question: how many got it right, and the wrong
-- letter chosen most. A question almost everyone "got wrong" with the
-- same letter often means the key is wrong.
CREATE VIEW question_summary AS
SELECT s.exam_id, a.question_no,
       count(*) AS answered,
       round(100.0 * sum(a.is_correct) / count(*), 1) AS percent_correct,
       (SELECT a2.chosen
          FROM saved_answers a2
          JOIN saved_scripts s2 ON s2.id = a2.script_id
         WHERE s2.exam_id = s.exam_id
           AND a2.question_no = a.question_no
           AND a2.is_correct = 0
           AND a2.chosen IN ('A', 'B', 'C', 'D', 'E')
         GROUP BY a2.chosen
         ORDER BY count(*) DESC, a2.chosen
         LIMIT 1) AS most_chosen_wrong
  FROM saved_answers a
  JOIN saved_scripts s ON s.id = a.script_id
 GROUP BY s.exam_id, a.question_no;

-- Name suggestions for the Save screen: the class list plus names saved
-- before in that class. The app filters with:
--   SELECT full_name FROM name_suggestions
--    WHERE class_id = ? AND name_key LIKE '%' || lower(?) || '%'
--    ORDER BY full_name LIMIT 10;
CREATE VIEW name_suggestions AS
SELECT class_id, full_name, lower(trim(full_name)) AS name_key FROM class_names
UNION
SELECT class_id, student_name, name_key FROM saved_scripts;
`;

export const SCHEMA = BASE + EXAMS + `
PRAGMA user_version = 2;
`;

export const MIGRATE_1_TO_2 = `
-- Version 1 was only in the first test build, which had no exam screens, so
-- its exam tables are empty. Rebuild them in the version 2 shape; settings,
-- classes and class lists are kept.
DROP VIEW IF EXISTS name_suggestions;
DROP VIEW IF EXISTS question_summary;
DROP VIEW IF EXISTS exam_class_summary;
DROP VIEW IF EXISTS script_results;
DROP TABLE IF EXISTS scan_queue;
DROP TABLE IF EXISTS saved_answers;
DROP TABLE IF EXISTS saved_scripts;
DROP TABLE IF EXISTS answer_keys;
DROP TABLE IF EXISTS exam_classes;
DROP TABLE IF EXISTS exams;
` + EXAMS + `
PRAGMA user_version = 2;
`;
