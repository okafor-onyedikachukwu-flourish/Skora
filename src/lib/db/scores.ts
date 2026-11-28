import type { SQLiteDatabase } from 'expo-sqlite';
import { cleanName } from './index';
import type { Chosen } from './scripts';

/** Separates class names in one SQL column (a class name never contains it). */
const SEP = '\u001f';

function percentOf(score: number, max: number): number | null {
  return max > 0 ? (100 * score) / max : null;
}

/** Rounds a percentage for display: 64.25 → "64%". */
export function formatPercent(p: number | null): string {
  return p === null ? '–' : `${Math.round(p)}%`;
}

/** A score for display: 25.5 → "25.5", 31 → "31". */
export function formatScore(n: number): string {
  return String(Math.round(n * 100) / 100);
}

export function passes(percent: number | null, passMark: number): boolean {
  return percent !== null && percent >= passMark;
}

// ---------------------------------------------------------------------
// Each exam at a glance: the Exams, Scan and Scores tabs
// ---------------------------------------------------------------------

export type ExamSummary = {
  examId: number;
  title: string;
  classNames: string[];
  /** Saved scripts, all classes. */
  scripts: number;
  averagePercent: number | null;
  /** Scripts at or above the pass mark. */
  passed: number;
  highestPercent: number | null;
  /** ISO time of the newest saved script, or null. */
  lastSavedAt: string | null;
  /** Names on the class lists of the exam's classes (0 when no lists were added). */
  listSize: number;
};

type SummaryRow = {
  id: number;
  title: string;
  class_names: string | null;
  scripts: number;
  average_percent: number | null;
  passed: number | null;
  highest_percent: number | null;
  last_saved_at: string | null;
  list_size: number;
};

/** Every exam (not archived) with its scores so far, most recently scanned first. */
export async function examSummaries(db: SQLiteDatabase, passMark: number): Promise<ExamSummary[]> {
  const rows = await db.getAllAsync<SummaryRow>(
    `SELECT e.id, e.title,
            (SELECT group_concat(c.name, '${SEP}') FROM exam_classes ec JOIN classes c ON c.id = ec.class_id
              WHERE ec.exam_id = e.id) AS class_names,
            count(s.id) AS scripts,
            avg(CASE WHEN s.max_score > 0 THEN 100.0 * s.score / s.max_score END) AS average_percent,
            sum(CASE WHEN s.max_score > 0 AND 100.0 * s.score / s.max_score >= ? THEN 1 ELSE 0 END) AS passed,
            max(CASE WHEN s.max_score > 0 THEN 100.0 * s.score / s.max_score END) AS highest_percent,
            max(s.saved_at) AS last_saved_at,
            (SELECT count(*) FROM class_names n JOIN exam_classes ec ON ec.class_id = n.class_id
              WHERE ec.exam_id = e.id) AS list_size
       FROM exams e
       LEFT JOIN saved_scripts s ON s.exam_id = e.id
      WHERE e.archived = 0
      GROUP BY e.id
      ORDER BY last_saved_at IS NULL, last_saved_at DESC, e.created_at DESC, e.id DESC`,
    passMark,
  );
  const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  return rows.map((r) => ({
    examId: r.id,
    title: r.title,
    classNames: (r.class_names ? r.class_names.split(SEP) : []).sort(byName),
    scripts: r.scripts,
    averagePercent: r.average_percent,
    passed: r.passed ?? 0,
    highestPercent: r.highest_percent,
    lastSavedAt: r.last_saved_at,
    listSize: r.list_size,
  }));
}

// ---------------------------------------------------------------------
// One exam's scores
// ---------------------------------------------------------------------

export type ScriptRow = {
  id: number;
  studentName: string;
  classId: number;
  className: string;
  score: number;
  maxScore: number;
  percent: number | null;
  subject: string;
  writtenOn: string;
  savedAt: string;
};

type ScriptDbRow = {
  id: number;
  student_name: string;
  class_id: number;
  class_name: string;
  score: number;
  max_score: number;
  subject: string;
  written_on: string;
  saved_at: string;
};

function toScriptRow(r: ScriptDbRow): ScriptRow {
  return {
    id: r.id,
    studentName: r.student_name,
    classId: r.class_id,
    className: r.class_name,
    score: r.score,
    maxScore: r.max_score,
    percent: percentOf(r.score, r.max_score),
    subject: r.subject,
    writtenOn: r.written_on,
    savedAt: r.saved_at,
  };
}

/** The exam's saved scripts, highest score first. `classId` null = every class. */
export async function listScripts(db: SQLiteDatabase, examId: number, classId: number | null = null): Promise<ScriptRow[]> {
  const rows = await db.getAllAsync<ScriptDbRow>(
    `SELECT s.id, s.student_name, s.class_id, c.name AS class_name, s.score, s.max_score, s.subject, s.written_on, s.saved_at
       FROM saved_scripts s JOIN classes c ON c.id = s.class_id
      WHERE s.exam_id = ? AND (? IS NULL OR s.class_id = ?)
      ORDER BY s.score DESC, s.student_name COLLATE NOCASE`,
    examId,
    classId,
    classId,
  );
  return rows.map(toScriptRow);
}

/** The score bands of the spread chart, in percent. The last one includes 100. */
export const BANDS: { from: number; to: number; label: string }[] = [
  { from: 0, to: 40, label: '0–39%' },
  { from: 40, to: 50, label: '40–49%' },
  { from: 50, to: 60, label: '50–59%' },
  { from: 60, to: 70, label: '60–69%' },
  { from: 70, to: 80, label: '70–79%' },
  { from: 80, to: 101, label: '80%+' },
];

export type ExamStats = {
  scripts: number;
  averagePercent: number | null;
  averageScore: number | null;
  /** The exam's total marks, as saved on the scripts. */
  maxScore: number;
  passed: number;
  highest: ScriptRow | null;
  lowest: ScriptRow | null;
  /** How many scripts fall in each of BANDS. */
  spread: number[];
};

/** Class average, pass count, highest, lowest and spread, from a list of scripts. */
export function examStats(scripts: ScriptRow[], passMark: number): ExamStats {
  const marked = scripts.filter((s) => s.percent !== null);
  const spread = BANDS.map(() => 0);
  for (const s of marked) {
    const i = BANDS.findIndex((b) => s.percent! >= b.from && s.percent! < b.to);
    if (i >= 0) spread[i] += 1;
  }
  const byScore = [...marked].sort((a, b) => b.percent! - a.percent!);
  return {
    scripts: scripts.length,
    averagePercent: marked.length ? marked.reduce((t, s) => t + s.percent!, 0) / marked.length : null,
    averageScore: marked.length ? marked.reduce((t, s) => t + s.score, 0) / marked.length : null,
    maxScore: marked[0]?.maxScore ?? 0,
    passed: marked.filter((s) => passes(s.percent, passMark)).length,
    highest: byScore[0] ?? null,
    lowest: byScore.length > 1 ? byScore[byScore.length - 1] : null,
    spread,
  };
}

export type MissedQuestion = {
  q: number;
  key: string;
  answered: number;
  wrong: number;
  /** The wrong answer given most, and by how many. */
  commonWrong: { chosen: Chosen; count: number } | null;
};

/**
 * The questions most students got wrong (at most `limit`), with the wrong answer given most.
 * Questions without a key are left out: nobody can get them right.
 */
export async function missedQuestions(db: SQLiteDatabase, examId: number, classId: number | null = null, limit = 5): Promise<MissedQuestion[]> {
  const rows = await db.getAllAsync<{ q: number; key: string; answered: number; wrong: number }>(
    `SELECT a.question_no AS q, k.correct_option AS key, count(*) AS answered, sum(1 - a.is_correct) AS wrong
       FROM saved_answers a
       JOIN saved_scripts s ON s.id = a.script_id
       JOIN answer_keys k ON k.exam_id = s.exam_id AND k.question_no = a.question_no
      WHERE s.exam_id = ? AND (? IS NULL OR s.class_id = ?)
      GROUP BY a.question_no
     HAVING wrong > 0
      ORDER BY wrong DESC, a.question_no
      LIMIT ?`,
    examId,
    classId,
    classId,
    limit,
  );
  if (rows.length === 0) return [];
  const choices = await db.getAllAsync<{ q: number; chosen: Chosen; n: number }>(
    `SELECT a.question_no AS q, a.chosen, count(*) AS n
       FROM saved_answers a JOIN saved_scripts s ON s.id = a.script_id
      WHERE s.exam_id = ? AND (? IS NULL OR s.class_id = ?) AND a.is_correct = 0
        AND a.question_no IN (${rows.map(() => '?').join(',')})
      GROUP BY a.question_no, a.chosen
      ORDER BY n DESC, a.chosen`,
    examId,
    classId,
    classId,
    ...rows.map((r) => r.q),
  );
  return rows.map((r) => {
    const top = choices.find((c) => c.q === r.q);
    return { ...r, commonWrong: top ? { chosen: top.chosen, count: top.n } : null };
  });
}

// ---------------------------------------------------------------------
// One saved script
// ---------------------------------------------------------------------

export type SavedAnswer = { q: number; chosen: Chosen; source: string; isCorrect: boolean; key: string | null };

export type SavedScript = ScriptRow & {
  examId: number;
  examTitle: string;
  optionCount: 4 | 5;
  questionCount: number;
  readBy: 'phone' | 'gemini' | 'both';
  sheetType: 'omr' | 'handwritten';
  /** 1 = highest score in the exam (all classes); ties share a place. */
  position: number;
  /** Saved scripts in the exam, all classes. */
  outOf: number;
  answers: SavedAnswer[];
};

export async function getScript(db: SQLiteDatabase, id: number): Promise<SavedScript | null> {
  const r = await db.getFirstAsync<
    ScriptDbRow & {
      exam_id: number;
      exam_title: string;
      option_count: 4 | 5;
      question_count: number;
      read_by: 'phone' | 'gemini' | 'both';
      sheet_type: 'omr' | 'handwritten';
      position: number;
      out_of: number;
    }
  >(
    `SELECT s.id, s.student_name, s.class_id, c.name AS class_name, s.score, s.max_score, s.subject, s.written_on, s.saved_at,
            s.exam_id, e.title AS exam_title, e.option_count, e.question_count, s.read_by, s.sheet_type,
            1 + (SELECT count(*) FROM saved_scripts o WHERE o.exam_id = s.exam_id AND o.score > s.score) AS position,
            (SELECT count(*) FROM saved_scripts o WHERE o.exam_id = s.exam_id) AS out_of
       FROM saved_scripts s
       JOIN classes c ON c.id = s.class_id
       JOIN exams e ON e.id = s.exam_id
      WHERE s.id = ?`,
    id,
  );
  if (!r) return null;
  const answers = await db.getAllAsync<{ q: number; chosen: Chosen; source: string; is_correct: number; key: string | null }>(
    `SELECT a.question_no AS q, a.chosen, a.source, a.is_correct, k.correct_option AS key
       FROM saved_answers a
       LEFT JOIN answer_keys k ON k.exam_id = ? AND k.question_no = a.question_no
      WHERE a.script_id = ?
      ORDER BY a.question_no`,
    r.exam_id,
    id,
  );
  return {
    ...toScriptRow(r),
    examId: r.exam_id,
    examTitle: r.exam_title,
    optionCount: r.option_count,
    questionCount: r.question_count,
    readBy: r.read_by,
    sheetType: r.sheet_type,
    position: r.position,
    outOf: r.out_of,
    answers: answers.map((a) => ({ q: a.q, chosen: a.chosen, source: a.source, isCorrect: a.is_correct === 1, key: a.key })),
  };
}

/** The teacher changes one answer of a saved script. The database marks it again and updates the score. */
export async function changeAnswer(db: SQLiteDatabase, scriptId: number, q: number, chosen: Chosen): Promise<void> {
  await db.runAsync(
    `INSERT INTO saved_answers (script_id, question_no, chosen, source) VALUES (?, ?, ?, 'teacher')
     ON CONFLICT (script_id, question_no) DO UPDATE SET chosen = excluded.chosen, source = 'teacher'`,
    scriptId,
    q,
    chosen,
  );
}

export async function renameScript(db: SQLiteDatabase, scriptId: number, name: string): Promise<void> {
  const studentName = cleanName(name);
  if (studentName.length < 2) throw new Error("Type the student's name.");
  if (studentName.length > 120) throw new Error('The name can be 120 letters at most.');
  await db.runAsync('UPDATE saved_scripts SET student_name = ? WHERE id = ?', studentName, scriptId);
}

/** Deletes a saved script and its answers. */
export async function deleteScript(db: SQLiteDatabase, scriptId: number): Promise<void> {
  await db.runAsync('DELETE FROM saved_scripts WHERE id = ?', scriptId);
}

// ---------------------------------------------------------------------
// Spreadsheet
// ---------------------------------------------------------------------

export type ExportData = {
  key: { q: number; option: string }[];
  scripts: (ScriptRow & { answers: Map<number, Chosen> })[];
};

/** Everything the spreadsheet needs: the key, and each script with its answers. */
export async function exportData(db: SQLiteDatabase, examId: number, classId: number | null): Promise<ExportData> {
  const scripts = await listScripts(db, examId, classId);
  const key = await db.getAllAsync<{ q: number; option: string }>(
    'SELECT question_no AS q, correct_option AS option FROM answer_keys WHERE exam_id = ? ORDER BY question_no',
    examId,
  );
  const answers = await db.getAllAsync<{ script_id: number; q: number; chosen: Chosen }>(
    `SELECT a.script_id, a.question_no AS q, a.chosen FROM saved_answers a JOIN saved_scripts s ON s.id = a.script_id
      WHERE s.exam_id = ? AND (? IS NULL OR s.class_id = ?)`,
    examId,
    classId,
    classId,
  );
  const byScript = new Map<number, Map<number, Chosen>>();
  for (const a of answers) {
    if (!byScript.has(a.script_id)) byScript.set(a.script_id, new Map());
    byScript.get(a.script_id)!.set(a.q, a.chosen);
  }
  return { key, scripts: scripts.map((s) => ({ ...s, answers: byScript.get(s.id) ?? new Map() })) };
}
