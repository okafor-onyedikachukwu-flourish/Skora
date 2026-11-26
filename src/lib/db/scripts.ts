import type { SQLiteDatabase } from 'expo-sqlite';
import { cleanName } from './index';

export type Chosen = 'A' | 'B' | 'C' | 'D' | 'E' | 'blank' | 'several';
export type AnswerSource = 'omr' | 'mlkit' | 'gemini' | 'teacher';

export type NewScript = {
  examId: number;
  classId: number;
  studentName: string;
  subject: string;
  /** YYYY-MM-DD */
  writtenOn: string;
  sheetType: 'omr' | 'handwritten';
  readBy: 'phone' | 'gemini' | 'both';
  teacherFixes: number;
  answers: { q: number; chosen: Chosen; source: AnswerSource }[];
  /** Replace a script already saved under this name, class and exam. */
  replace?: boolean;
};

/** Thrown when a script is already saved under this name for the class and exam. */
export class AlreadySaved extends Error {
  constructor(name: string) {
    super(`A score is already saved for ${name} in this class.`);
    this.name = 'AlreadySaved';
  }
}

/** Saves a script. The database marks every answer against the key and works out the score. */
export async function saveScript(db: SQLiteDatabase, s: NewScript): Promise<{ score: number; maxScore: number }> {
  const studentName = cleanName(s.studentName);
  const subject = cleanName(s.subject);
  if (studentName.length < 2) throw new Error("Type the student's name.");
  if (!subject) throw new Error('Type the subject.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.writtenOn)) throw new Error('Choose the date.');

  let id = 0;
  await db.withTransactionAsync(async () => {
    const existing = await db.getFirstAsync<{ id: number }>(
      'SELECT id FROM saved_scripts WHERE exam_id = ? AND class_id = ? AND name_key = lower(trim(?))',
      s.examId,
      s.classId,
      studentName,
    );
    if (existing) {
      if (!s.replace) throw new AlreadySaved(studentName);
      await db.runAsync('DELETE FROM saved_scripts WHERE id = ?', existing.id);
    }
    const r = await db.runAsync(
      `INSERT INTO saved_scripts (exam_id, class_id, student_name, subject, written_on, sheet_type, read_by, teacher_fixes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      s.examId,
      s.classId,
      studentName,
      subject,
      s.writtenOn,
      s.sheetType,
      s.readBy,
      s.teacherFixes,
    );
    id = r.lastInsertRowId;
    for (const a of s.answers) {
      await db.runAsync('INSERT INTO saved_answers (script_id, question_no, chosen, source) VALUES (?, ?, ?, ?)', id, a.q, a.chosen, a.source);
    }
  });
  const saved = await db.getFirstAsync<{ score: number; max_score: number }>('SELECT score, max_score FROM saved_scripts WHERE id = ?', id);
  return { score: saved?.score ?? 0, maxScore: saved?.max_score ?? 0 };
}

/** Names to suggest as the teacher types: the class list and names saved before in that class. */
export async function suggestNames(db: SQLiteDatabase, classId: number, typed: string): Promise<string[]> {
  const q = cleanName(typed).toLowerCase();
  if (q.length < 1) return [];
  const rows = await db.getAllAsync<{ full_name: string }>(
    `SELECT full_name FROM name_suggestions
      WHERE class_id = ? AND name_key LIKE '%' || ? || '%'
      GROUP BY name_key ORDER BY instr(name_key, ?) , full_name COLLATE NOCASE LIMIT 6`,
    classId,
    q,
    q,
  );
  return rows.map((r) => r.full_name);
}

/** Subjects typed on earlier saves, most recent first. */
export async function recentSubjects(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ subject: string }>(
    `SELECT subject FROM saved_scripts GROUP BY lower(subject) ORDER BY max(saved_at) DESC LIMIT 8`,
  );
  return rows.map((r) => r.subject);
}
