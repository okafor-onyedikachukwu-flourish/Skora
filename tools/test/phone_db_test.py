import re, sqlite3, sys
from pathlib import Path

# Runs the phone schema from src/lib/db/schema.ts through every rule. Run: python3 tools/test/phone_db_test.py
SCHEMA_TS = Path(__file__).resolve().parents[2] / "src/lib/db/schema.ts"
src = SCHEMA_TS.read_text()
part = lambda name: re.search(name + r" = `(.*?)`;", src, re.S).group(1)
BASE, EXAMS = part("const BASE"), part("const EXAMS")
SCHEMA = BASE + EXAMS + "\nPRAGMA user_version = 2;\n"
MIGRATE_1_TO_2 = re.search(r"MIGRATE_1_TO_2 = `(.*?)` \+ EXAMS", src, re.S).group(1) + EXAMS + "\nPRAGMA user_version = 2;\n"
assert "SCHEMA = BASE + EXAMS" in src and "` + EXAMS + `" in src
sql = SCHEMA
print("sqlite", sqlite3.sqlite_version)
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(sql)
q = lambda s, *a: db.execute(s, a).fetchall()
assert q("PRAGMA user_version")[0][0] == 2
print("settings:", q("select key, length(value) from settings"))

def expect_fail(sql, *a, contains=""):
    try:
        db.execute(sql, a); db.commit()
    except sqlite3.Error as e:
        assert contains in str(e), str(e); print("  refused ok:", e); return
    raise AssertionError("should have failed: " + sql)

q("insert into classes(name) values ('SS2A'),('SS2B')")
expect_fail("insert into classes(name) values (' ss2a ')", contains="UNIQUE")
q("insert into exams(title, question_count, option_count) values ('First Term Exam',5,4)")
print("exam", q("select * from exams")[0])
q("insert into exam_classes values (1,1),(1,2)")
# key: Q1 A, Q2 B, Q3 C, Q4 D (2 marks), Q5 A
db.executemany("insert into answer_keys(exam_id, question_no, correct_option, marks) values (1,?,?,?)",
               [(1,'A',1),(2,'B',1),(3,'C',1),(4,'D',2),(5,'A',1)])
assert q("select total_marks from exams where id=1")[0][0] == 6
expect_fail("insert into answer_keys values (1,6,'A',1)", contains="beyond")
expect_fail("update answer_keys set correct_option='E' where exam_id=1 and question_no=1", contains="A to D")

# save a script: A, B, D, D, several  -> correct Q1,Q2,Q4 = 1+1+2 = 4
q("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by) values (1,1,'Ada Obi','Mathematics','2026-12-01','omr','phone')")
db.executemany("insert into saved_answers(script_id, question_no, chosen, source) values (1,?,?,?)",
               [(1,'A','omr'),(2,'B','omr'),(3,'D','omr'),(4,'D','omr'),(5,'several','omr')])
print("script 1:", q("select score, max_score from saved_scripts where id=1"))
assert q("select score, max_score from saved_scripts where id=1")[0] == (4.0, 6.0)
expect_fail("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by) values (1,1,'ada obi','Mathematics','2026-12-01','omr','phone')", contains="UNIQUE")
expect_fail("insert into saved_answers(script_id, question_no, chosen, source) values (1,6,'A','omr')", contains="beyond")

# second script in SS2B: all A -> Q1, Q5 = 2
q("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by) values (1,2,'Chidi Okeke','Maths','2026-12-02','handwritten','both')")
db.executemany("insert into saved_answers(script_id, question_no, chosen, source) values (2,?,?,?)",
               [(i,'A','mlkit') for i in range(1,6)])
assert q("select score from saved_scripts where id=2")[0][0] == 2

# class not on the exam is refused
q("insert into classes(name) values ('JSS1A')")
expect_fail("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by) values (1,3,'Bola','Maths','2026-12-02','omr','phone')", contains="FOREIGN KEY")

# fix key: Q3 should be D -> script 1 gains 1 (5), script 2 unchanged (2)
q("update answer_keys set correct_option='D' where exam_id=1 and question_no=3")
assert q("select score from saved_scripts order by id") == [(5.0,), (2.0,)], q("select score from saved_scripts")
# Q4 marks 2 -> 3: total 7, script1 = 6
q("update answer_keys set marks=3 where exam_id=1 and question_no=4")
assert q("select score, max_score from saved_scripts where id=1")[0] == (6.0, 7.0)
# teacher changes a saved answer: script 2 Q2 A -> B  => 3
q("update saved_answers set chosen='B', source='teacher' where script_id=2 and question_no=2")
assert q("select score from saved_scripts where id=2")[0][0] == 3
# remove Q5 from key: nobody gets it; total 6
q("delete from answer_keys where exam_id=1 and question_no=5")
assert q("select score, max_score from saved_scripts order by id") == [(6.0, 6.0), (2.0, 6.0)], q("select score, max_score from saved_scripts")
q("insert into answer_keys values (1,5,'A',1)")
assert q("select score, max_score from saved_scripts order by id") == [(6.0, 7.0), (3.0, 7.0)], q("select score, max_score from saved_scripts")

# shape locked once scores exist
expect_fail("update exams set question_count=10 where id=1", contains="cannot change")
# exam without scores: shrinking trims the key
q("insert into exams(title, question_count, option_count) values ('Test 1',4,5)")
q("insert into answer_keys values (2,1,'E',1),(2,2,'B',1),(2,3,'C',1),(2,4,'A',1)")
q("update exams set question_count=3, option_count=4 where id=2")
print("trimmed key:", q("select question_no, correct_option from answer_keys where exam_id=2"), q("select total_marks from exams where id=2"))
assert q("select total_marks from exams where id=2")[0][0] == 2

print("script_results:", q("select student_name, class_name, score, percent, position from script_results"))
print("exam_class_summary:", q("select * from exam_class_summary"))
print("question_summary:", q("select * from question_summary"))
q("insert into class_names(class_id, full_name) values (1,'Adaeze Nwosu'),(1,'Ada Obi')")
print("suggest 'ada':", q("select full_name from name_suggestions where class_id=1 and name_key like '%'||lower('ada')||'%' order by full_name limit 10"))

# scan queue json checks
q("insert into scan_queue(exam_id, sheet_type, photo_uris, phone_answers) values (1,'handwritten','[\"file:///a.jpg\"]','[{\"q\":1,\"chosen\":\"A\",\"clear\":true}]')")
expect_fail("insert into scan_queue(exam_id, sheet_type, photo_uris, phone_answers) values (1,'handwritten','not json','[]')", contains="CHECK")

# removing a class from the exam removes its saved scripts; deleting the class itself is refused while used
expect_fail("delete from classes where id=2", contains="FOREIGN KEY")
q("delete from exam_classes where exam_id=1 and class_id=2")
assert q("select count(*) from saved_scripts where class_id=2")[0][0] == 0
assert q("select count(*) from saved_answers where script_id=2")[0][0] == 0
# deleting the exam removes everything under it
q("delete from exams where id=1")
assert q("select count(*) from saved_scripts")[0][0] == 0 and q("select count(*) from answer_keys where exam_id=1")[0][0] == 0 and q("select count(*) from scan_queue")[0][0] == 0
print("integrity:", q("PRAGMA integrity_check"), "fk:", q("PRAGMA foreign_key_check"))
expect_fail("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by) values (2,1,'Bad Date','Maths','2026-02-30','omr','phone')", contains="")
print("script_results columns:", [d[1] for d in db.execute("pragma table_info(script_results)").fetchall()][:8])

# Upgrade from the first test build (version 1): classes and settings stay, exam tables get the new shape.
import subprocess
old_ts = subprocess.run(["git", "show", "dc9494c:src/lib/db/schema.ts"], cwd=SCHEMA_TS.parents[3], capture_output=True, text=True, check=True).stdout
old = sqlite3.connect(":memory:"); old.execute("PRAGMA foreign_keys = ON")
old.executescript(re.search(r"SCHEMA_V1 = `(.*?)`;", old_ts, re.S).group(1))
old.execute("insert into classes(name) values ('JSS3A')"); old.execute("insert into class_names(class_id, full_name) values (1, 'Ada Obi')")
old.execute("update settings set value='Mrs Okafor' where key='pass_mark_percent'") if False else None
old.execute("insert into settings(key, value) values ('teacher_name', 'Mrs Okafor')")
device = old.execute("select value from settings where key='device_id'").fetchone()[0]
assert old.execute("PRAGMA user_version").fetchone()[0] == 1
old.executescript("BEGIN;" + MIGRATE_1_TO_2 + "COMMIT;")
assert old.execute("PRAGMA user_version").fetchone()[0] == 2
assert old.execute("select name from classes").fetchall() == [("JSS3A",)]
assert old.execute("select full_name from class_names").fetchall() == [("Ada Obi",)]
assert old.execute("select value from settings where key='device_id'").fetchone()[0] == device
cols = [r[1] for r in old.execute("pragma table_info(saved_scripts)").fetchall()]
assert "subject" in cols and "written_on" in cols, cols
assert "sheet_code" not in [r[1] for r in old.execute("pragma table_info(exams)").fetchall()]
old.execute("insert into exams(title, question_count, option_count) values ('After upgrade', 3, 4)")
old.execute("insert into exam_classes values (1, 1)")
old.executemany("insert into answer_keys values (1,?,?,1)", [(1, 'A'), (2, 'B'), (3, 'C')])
old.execute("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by) values (1,1,'Ada Obi','English','2026-12-03','omr','phone')")
old.executemany("insert into saved_answers(script_id, question_no, chosen, source) values (1,?,?,'omr')", [(1, 'A'), (2, 'C'), (3, 'C')])
assert old.execute("select score, max_score from saved_scripts").fetchone() == (2.0, 3.0)
assert old.execute("PRAGMA foreign_key_check").fetchall() == [] and old.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
print("upgrade from version 1: ok")

# The answer-key upsert used by saveKeyChanges in src/lib/db/exams.ts.
UPSERT = """INSERT INTO answer_keys (exam_id, question_no, correct_option, marks) VALUES (?, ?, ?, ?)
           ON CONFLICT (exam_id, question_no) DO UPDATE SET correct_option = excluded.correct_option, marks = excluded.marks
           WHERE correct_option IS NOT excluded.correct_option OR marks IS NOT excluded.marks"""
k = sqlite3.connect(":memory:"); k.execute("PRAGMA foreign_keys = ON"); k.executescript(SCHEMA)
k.execute("insert into classes(name) values ('SS1A')")
k.execute("insert into exams(title, question_count, option_count) values ('Key test', 3, 4)"); k.execute("insert into exam_classes values (1,1)")
for q_, o_, m_ in [(1, 'A', 1), (2, 'B', 2), (3, 'C', 1)]: k.execute(UPSERT, (1, q_, o_, m_))
assert k.execute("select total_marks from exams").fetchone()[0] == 4
k.execute("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by) values (1,1,'Ada','Maths','2026-12-01','omr','phone')")
k.executemany("insert into saved_answers(script_id, question_no, chosen, source) values (1,?,?,'omr')", [(1, 'A'), (2, 'D'), (3, 'C')])
assert k.execute("select score from saved_scripts").fetchone()[0] == 2
k.execute(UPSERT, (1, 2, 'D', 2))       # key fixed: Q2 is D
assert k.execute("select score, max_score from saved_scripts").fetchone() == (4.0, 4.0)
k.execute(UPSERT, (1, 2, 'D', 3))       # Q2 now 3 marks
assert k.execute("select score, max_score from saved_scripts").fetchone() == (5.0, 5.0)
k.execute(UPSERT, (1, 2, 'D', 3))       # same again: no change
k.execute("DELETE FROM answer_keys WHERE exam_id = ? AND question_no = ?", (1, 3))
assert k.execute("select score, max_score from saved_scripts").fetchone() == (4.0, 4.0)
print("answer-key upsert and re-marking: ok")

# The statements used by saveScript, suggestNames and recentSubjects in src/lib/db/scripts.ts.
EXISTING = "SELECT id FROM saved_scripts WHERE exam_id = ? AND class_id = ? AND name_key = lower(trim(?))"
assert k.execute(EXISTING, (1, 1, "  ADA ")).fetchone() is not None, "finds Ada however it is typed"
assert k.execute(EXISTING, (1, 1, "Bola")).fetchone() is None
k.execute("insert into class_names(class_id, full_name) values (1,'Adaeze Nwosu'),(1,'Bola Ade'),(1,'Chidi Ada')")
SUGGEST = """SELECT full_name FROM name_suggestions
      WHERE class_id = ? AND name_key LIKE '%' || ? || '%'
      GROUP BY name_key ORDER BY instr(name_key, ?) , full_name COLLATE NOCASE LIMIT 6"""
got = [r[0] for r in k.execute(SUGGEST, (1, "ada", "ada")).fetchall()]
assert got[:2] == ["Ada", "Adaeze Nwosu"] and "Chidi Ada" in got and "Bola Ade" not in got, got
k.execute("insert into saved_scripts(exam_id, class_id, student_name, subject, written_on, sheet_type, read_by, saved_at) values (1,1,'Bola Ade','English','2026-12-01','omr','phone','2099-01-01T00:00:00.000Z')")
RECENT = "SELECT subject FROM saved_scripts GROUP BY lower(subject) ORDER BY max(saved_at) DESC LIMIT 8"
assert [r[0] for r in k.execute(RECENT).fetchall()] == ["English", "Maths"], k.execute(RECENT).fetchall()
print("save, duplicate check, name suggestions, recent subjects: ok")
# The statements used by the waiting list in src/lib/db/queue.ts.
import json
qsrc = open("src/lib/db/queue.ts").read()
INSERT = "INSERT INTO scan_queue (exam_id, sheet_type, photo_uris, phone_answers, last_error) VALUES (?, 'handwritten', ?, ?, ?)"
COUNT = "SELECT count(*) AS total, coalesce(sum(status IN ('waiting', 'sending')), 0) AS waiting FROM scan_queue"
READ = "UPDATE scan_queue SET status = 'read', gemini_answers = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?"
FAILED = "UPDATE scan_queue SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?"
for stmt in (INSERT, COUNT, READ, FAILED):
    assert stmt in qsrc.replace("`", ""), "queue.ts statement changed: " + stmt[:40]
assert k.execute(COUNT).fetchone() == (0, 0)
pages = json.dumps([{"name": "a.jpg", "width": 1500, "height": 2000}])
phone = json.dumps([{"q": 1, "chosen": None, "clear": False, "why": "not-found"}])
a = k.execute(INSERT, (1, pages, phone, "No internet.")).lastrowid
b = k.execute(INSERT, (1, pages, phone, None)).lastrowid
assert k.execute(COUNT).fetchone() == (2, 2)
k.execute(READ, (json.dumps([{"q": 1, "chosen": "B"}]), a))
k.execute(FAILED, ("waiting", "Gemini is busy.", b))
assert k.execute(COUNT).fetchone() == (2, 1)
assert k.execute("select status, attempts, last_error from scan_queue where id=?", (b,)).fetchone() == ("waiting", 1, "Gemini is busy.")
k.execute(FAILED, ("failed", "Gemini could not read it.", b))
assert k.execute(COUNT).fetchone() == (2, 0)
k.execute("delete from exams where id = 1")
assert k.execute(COUNT).fetchone() == (0, 0), "deleting the exam empties its waiting list"
print("waiting list statements: ok")
print("ALL PHONE DB TESTS PASSED")
