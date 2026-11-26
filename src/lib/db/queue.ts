import { File } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { PhoneAnswer } from '../handwriting/parse';
import type { Chosen as GeminiChosen } from '../readHandwriting';
import { scansDir, type ScriptPage } from '../scan/pending';

/**
 * The waiting list: handwritten scripts kept for later because Gemini could not be reached
 * (no internet, Gemini busy or today's limit used up). Their photos stay in the scans folder,
 * named in photo_uris, until the script is saved or discarded.
 */

export type QueueStatus = 'waiting' | 'read' | 'failed';
type StoredPage = { name: string; width: number; height: number };

export type QueueItem = {
  id: number;
  examId: number;
  examTitle: string;
  status: QueueStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  pages: ScriptPage[];
  /** Answers the phone could not read. */
  unclear: number;
};

export type QueueEntry = QueueItem & { phone: PhoneAnswer[]; gemini: { q: number; chosen: GeminiChosen }[] | null };

type Row = {
  id: number;
  exam_id: number;
  exam_title: string;
  status: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  photo_uris: string;
  phone_answers: string;
  gemini_answers: string | null;
};

function pagesOf(json: string): ScriptPage[] {
  const dir = scansDir();
  return (JSON.parse(json) as StoredPage[]).map((p) => ({ uri: new File(dir, p.name).uri, width: p.width, height: p.height }));
}

function toEntry(r: Row): QueueEntry {
  const phone = JSON.parse(r.phone_answers) as PhoneAnswer[];
  return {
    id: r.id,
    examId: r.exam_id,
    examTitle: r.exam_title,
    status: (r.status === 'sending' ? 'waiting' : r.status) as QueueStatus,
    attempts: r.attempts,
    lastError: r.last_error,
    createdAt: r.created_at,
    pages: pagesOf(r.photo_uris),
    unclear: phone.filter((a) => !a.clear).length,
    phone,
    gemini: r.gemini_answers ? JSON.parse(r.gemini_answers) : null,
  };
}

const SELECT = `
  SELECT q.id, q.exam_id, e.title AS exam_title, q.status, q.attempts, q.last_error, q.created_at,
         q.photo_uris, q.phone_answers, q.gemini_answers
    FROM scan_queue q JOIN exams e ON e.id = q.exam_id`;

export async function addToQueue(db: SQLiteDatabase, examId: number, pages: ScriptPage[], phone: PhoneAnswer[], lastError?: string): Promise<number> {
  const stored: StoredPage[] = pages.map((p) => ({ name: new File(p.uri).name, width: p.width, height: p.height }));
  const r = await db.runAsync(
    `INSERT INTO scan_queue (exam_id, sheet_type, photo_uris, phone_answers, last_error) VALUES (?, 'handwritten', ?, ?, ?)`,
    examId,
    JSON.stringify(stored),
    JSON.stringify(phone),
    lastError ?? null,
  );
  return r.lastInsertRowId;
}

export async function listQueue(db: SQLiteDatabase): Promise<QueueEntry[]> {
  const rows = await db.getAllAsync<Row>(`${SELECT} ORDER BY q.created_at, q.id`);
  return rows.map(toEntry);
}

export async function getQueueEntry(db: SQLiteDatabase, id: number): Promise<QueueEntry | null> {
  const row = await db.getFirstAsync<Row>(`${SELECT} WHERE q.id = ?`, id);
  return row ? toEntry(row) : null;
}

export async function queueCount(db: SQLiteDatabase): Promise<{ total: number; waiting: number }> {
  const r = await db.getFirstAsync<{ total: number; waiting: number }>(
    `SELECT count(*) AS total, coalesce(sum(status IN ('waiting', 'sending')), 0) AS waiting FROM scan_queue`,
  );
  return { total: r?.total ?? 0, waiting: r?.waiting ?? 0 };
}

export async function setGeminiRead(db: SQLiteDatabase, id: number, answers: { q: number; chosen: GeminiChosen }[]) {
  await db.runAsync(
    `UPDATE scan_queue SET status = 'read', gemini_answers = ?, attempts = attempts + 1, last_error = NULL WHERE id = ?`,
    JSON.stringify(answers),
    id,
  );
}

/** A try that did not work. `later` keeps it waiting; otherwise the teacher fixes it by hand. */
export async function setGeminiFailed(db: SQLiteDatabase, id: number, message: string, later: boolean) {
  await db.runAsync(
    `UPDATE scan_queue SET status = ?, attempts = attempts + 1, last_error = ? WHERE id = ?`,
    later ? 'waiting' : 'failed',
    message,
    id,
  );
}

/** Removes a script from the waiting list and deletes its photos. */
export async function removeFromQueue(db: SQLiteDatabase, id: number) {
  const row = await db.getFirstAsync<{ photo_uris: string }>('SELECT photo_uris FROM scan_queue WHERE id = ?', id);
  await db.runAsync('DELETE FROM scan_queue WHERE id = ?', id);
  if (!row) return;
  for (const p of pagesOf(row.photo_uris)) {
    try {
      const f = new File(p.uri);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}

/** File names of the photos the waiting list still needs. */
export async function queuedPhotoNames(db: SQLiteDatabase): Promise<string[]> {
  const rows = await db.getAllAsync<{ photo_uris: string }>('SELECT photo_uris FROM scan_queue');
  return rows.flatMap((r) => (JSON.parse(r.photo_uris) as StoredPage[]).map((p) => p.name));
}
