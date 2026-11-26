import re, sqlite3, sys
from pathlib import Path

# Runs the phone schema from src/lib/db/schema.ts through every rule. Run: python3 tools/test/phone_db_test.py
SCHEMA = Path(__file__).resolve().parents[2] / "src/lib/db/schema.ts"
sql = re.search(r"SCHEMA_V1 = `(.*?)`;", SCHEMA.read_text(), re.S).group(1)
print("sqlite", sqlite3.sqlite_version)
db = sqlite3.connect(":memory:")
db.execute("PRAGMA foreign_keys = ON")
db.executescript(sql)
q = lambda s, *a: db.execute(s, a).fetchall()
assert q("PRAGMA user_version")[0][0] == 1
print("settings:", q("select key, length(value) from settings"))

def expect_fail(sql, *a, contains=""):
    try:
        db.execute(sql, a); db.commit()
    except sqlite3.Error as e:
        assert contains in str(e), str(e); print("  refused ok:", e); return
    raise AssertionError("should have failed: " + sql)

q("insert into classes(name) values ('SS2A'),('SS2B')")
expect_fail("insert into classes(name) values (' ss2a ')", contains="UNIQUE")
q("insert into exams(title, subject, question_count, option_count, exam_date) values ('First Term Exam','Mathematics',5,4,'2026-12-01')")
expect_fail("insert into exams(title, subject, question_count, option_count, exam_date) values ('Bad','Maths',5,4,'2026-13-01')", contains="CHECK")
ex = q("select id, sheet_code from exams")[0]; print("exam", ex)
q("insert into exam_classes values (1,1),(1,2)")
# key: Q1 A, Q2 B, Q3 C, Q4 D (2 marks), Q5 A
db.executemany("insert into answer_keys(exam_id, question_no, correct_option, marks) values (1,?,?,?)",
               [(1,'A',1),(2,'B',1),(3,'C',1),(4,'D',2),(5,'A',1)])
assert q("select total_marks from exams where id=1")[0][0] == 6
expect_fail("insert into answer_keys values (1,6,'A',1)", contains="beyond")
expect_fail("update answer_keys set correct_option='E' where exam_id=1 and question_no=1", contains="A to D")

# save a script: A, B, D, D, several  -> correct Q1,Q2,Q4 = 1+1+2 = 4
q("insert into saved_scripts(exam_id, class_id, student_name, sheet_type, read_by) values (1,1,'Ada Obi','omr','phone')")
db.executemany("insert into saved_answers(script_id, question_no, chosen, source) values (1,?,?,?)",
               [(1,'A','omr'),(2,'B','omr'),(3,'D','omr'),(4,'D','omr'),(5,'several','omr')])
print("script 1:", q("select score, max_score from saved_scripts where id=1"))
assert q("select score, max_score from saved_scripts where id=1")[0] == (4.0, 6.0)
expect_fail("insert into saved_scripts(exam_id, class_id, student_name, sheet_type, read_by) values (1,1,'ada obi','omr','phone')", contains="UNIQUE")
expect_fail("insert into saved_answers(script_id, question_no, chosen, source) values (1,6,'A','omr')", contains="beyond")

# second script in SS2B: all A -> Q1, Q5 = 2
q("insert into saved_scripts(exam_id, class_id, student_name, sheet_type, read_by) values (1,2,'Chidi Okeke','handwritten','both')")
db.executemany("insert into saved_answers(script_id, question_no, chosen, source) values (2,?,?,?)",
               [(i,'A','mlkit') for i in range(1,6)])
assert q("select score from saved_scripts where id=2")[0][0] == 2

# class not on the exam is refused
q("insert into classes(name) values ('JSS1A')")
expect_fail("insert into saved_scripts(exam_id, class_id, student_name, sheet_type, read_by) values (1,3,'Bola','omr','phone')", contains="FOREIGN KEY")

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
q("insert into exams(title, subject, question_count, option_count) values ('Test 1','Maths',4,5)")
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
print("ALL PHONE DB TESTS PASSED")
