import type { SQLiteDatabase } from 'expo-sqlite';
import { MAX_QUESTIONS } from '../exams';
import { cleanName } from './index';

export type ExamValues = {
  title: string;
  classIds: number[];
  questionCount: number;
  optionCount: 4 | 5;
};

export type Exam = {
  id: number;
  title: string;
  questionCount: number;
  optionCount: 4 | 5;
  totalMarks: number;
  createdAt: string;
  classes: { id: number; name: string }[];
  /** Questions with a correct answer set. */
  keySet: number;
  /** Saved scripts, all classes. */
  saved: number;
};

type ExamRow = {
  id: number;
  title: string;
  question_count: number;
  option_count: 4 | 5;
  total_marks: number;
  created_at: string;
  key_set: number;
  saved: number;
};

const SELECT = `
  SELECT e.id, e.title, e.question_count, e.option_count, e.total_marks, e.created_at,
         (SELECT count(*) FROM answer_keys k WHERE k.exam_id = e.id) AS key_set,
         (SELECT count(*) FROM saved_scripts s WHERE s.exam_id = e.id) AS saved
    FROM exams e`;

async function withClasses(db: SQLiteDatabase, rows: ExamRow[]): Promise<Exam[]> {
  if (rows.length === 0) return [];
  const links = await db.getAllAsync<{ exam_id: number; id: number; name: string }>(
    `SELECT ec.exam_id, c.id, c.name FROM exam_classes ec JOIN classes c ON c.id = ec.class_id
      WHERE ec.exam_id IN (${rows.map(() => '?').join(',')})`,
    rows.map((r) => r.id),
  );
  const byExam = new Map<number, { id: number; name: string }[]>();
  for (const l of links) byExam.set(l.exam_id, [...(byExam.get(l.exam_id) ?? []), { id: l.id, name: l.name }]);
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    questionCount: r.question_count,
    optionCount: r.option_count,
    totalMarks: r.total_marks,
    createdAt: r.created_at,
    classes: (byExam.get(r.id) ?? []).sort(byName),
    keySet: r.key_set,
    saved: r.saved,
  }));
}

/** Newest first. */
export async function listExams(db: SQLiteDatabase): Promise<Exam[]> {
  return withClasses(db, await db.getAllAsync<ExamRow>(`${SELECT} WHERE e.archived = 0 ORDER BY e.created_at DESC, e.id DESC`));
}

export async function getExam(db: SQLiteDatabase, id: number): Promise<Exam | null> {
  const row = await db.getFirstAsync<ExamRow>(`${SELECT} WHERE e.id = ?`, id);
  return row ? (await withClasses(db, [row]))[0] : null;
}

function check(values: ExamValues) {
  const title = cleanName(values.title);
  if (title.length < 2) throw new Error('Give the exam a title, e.g. "First Term Examination".');
  if (title.length > 120) throw new Error('The title can be 120 letters at most.');
  if (values.classIds.length === 0) throw new Error('Choose at least one class.');
  if (!Number.isInteger(values.questionCount) || values.questionCount < 1 || values.questionCount > MAX_QUESTIONS) {
    throw new Error(`Enter the number of questions (1 to ${MAX_QUESTIONS}).`);
  }
  if (values.optionCount !== 4 && values.optionCount !== 5) throw new Error('Choose A–D or A–E.');
  return title;
}

export async function createExam(db: SQLiteDatabase, values: ExamValues): Promise<number> {
  const title = check(values);
  let id = 0;
  await db.withTransactionAsync(async () => {
    const r = await db.runAsync(
      'INSERT INTO exams (title, question_count, option_count) VALUES (?, ?, ?)',
      title,
      values.questionCount,
      values.optionCount,
    );
    id = r.lastInsertRowId;
    for (const classId of values.classIds) await db.runAsync('INSERT INTO exam_classes (exam_id, class_id) VALUES (?, ?)', id, classId);
  });
  return id;
}

/** Saved scripts per class for one exam, to warn before a class is taken off it. */
export async function savedByClass(db: SQLiteDatabase, examId: number): Promise<Map<number, number>> {
  const rows = await db.getAllAsync<{ class_id: number; n: number }>(
    'SELECT class_id, count(*) AS n FROM saved_scripts WHERE exam_id = ? GROUP BY class_id',
    examId,
  );
  return new Map(rows.map((r) => [r.class_id, r.n]));
}

/**
 * Changes an exam. The database refuses to change the number of questions or options once a score
 * is saved. Taking a class off the exam also deletes that class's saved scripts for it, so warn first.
 */
export async function updateExam(db: SQLiteDatabase, id: number, values: ExamValues) {
  const title = check(values);
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'UPDATE exams SET title = ?, question_count = ?, option_count = ? WHERE id = ?',
      title,
      values.questionCount,
      values.optionCount,
      id,
    );
    const now = await db.getAllAsync<{ class_id: number }>('SELECT class_id FROM exam_classes WHERE exam_id = ?', id);
    const want = new Set(values.classIds);
    for (const { class_id } of now) {
      if (!want.has(class_id)) await db.runAsync('DELETE FROM exam_classes WHERE exam_id = ? AND class_id = ?', id, class_id);
    }
    const have = new Set(now.map((r) => r.class_id));
    for (const classId of values.classIds) {
      if (!have.has(classId)) await db.runAsync('INSERT INTO exam_classes (exam_id, class_id) VALUES (?, ?)', id, classId);
    }
  });
}

/** Deletes the exam with its key and every saved score. */
export async function deleteExam(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM exams WHERE id = ?', id);
}

export type KeyRow = { q: number; option: string; marks: number };

export async function getKey(db: SQLiteDatabase, examId: number): Promise<KeyRow[]> {
  return db.getAllAsync<KeyRow>(
    'SELECT question_no AS q, correct_option AS option, marks FROM answer_keys WHERE exam_id = ? ORDER BY question_no',
    examId,
  );
}

/**
 * Saves changed questions of the key in one go. `option: null` clears a question.
 * The database re-marks every saved script of the exam for each changed question.
 */
export async function saveKeyChanges(db: SQLiteDatabase, examId: number, changes: { q: number; option: string | null; marks: number }[]) {
  if (changes.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const c of changes) {
      if (c.option === null) {
        await db.runAsync('DELETE FROM answer_keys WHERE exam_id = ? AND question_no = ?', examId, c.q);
      } else {
        await db.runAsync(
          `INSERT INTO answer_keys (exam_id, question_no, correct_option, marks) VALUES (?, ?, ?, ?)
           ON CONFLICT (exam_id, question_no) DO UPDATE SET correct_option = excluded.correct_option, marks = excluded.marks
           WHERE correct_option IS NOT excluded.correct_option OR marks IS NOT excluded.marks`,
          examId,
          c.q,
          c.option,
          c.marks,
        );
      }
    }
  });
}
