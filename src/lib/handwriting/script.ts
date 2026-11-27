import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { canReadText, readText } from '../../../modules/skora-text';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { getExam } from '../db/exams';
import { listQueue, removeFromQueue, setGeminiFailed, setGeminiRead, type QueueEntry } from '../db/queue';
import type { Settings } from '../db/settings';
import { readHandwriting, type Photo } from '../readHandwriting';
import { handwrittenAnswers } from '../scan/answers';
import { deletePhoto, scansDir, type GeminiOutcome, type PendingScript, type ScriptPage } from '../scan/pending';
import { classifyBoxes, hasReader, loadGray } from '../reader/reader';
import { answerBoxes, boxKey, findAnswers, writtenFields, type Judge, type PageIn, type PhoneAnswer, type ReadFields } from './parse';

/** Pages are kept at this many pixels on their longest side: sharp enough for the phone to read handwriting. */
const PAGE_SIDE = 2000;
/** Gemini gets smaller copies, so they upload quickly on a slow connection. */
const GEMINI_SIDE = 1600;
export const MAX_PAGES = 4;

export type PreparedPage = ScriptPage;

/** Saves an upright, reduced copy of a page photo in Skora's scans folder. */
export async function preparePage(uri: string): Promise<PreparedPage> {
  const image = await ImageManipulator.manipulate(uri, { maxWidth: PAGE_SIDE, maxHeight: PAGE_SIDE }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.85 });
  const target = new File(scansDir(), `${randomUUID()}.jpg`);
  new File(saved.uri).moveSync(target);
  return { uri: target.uri, width: saved.width, height: saved.height };
}

/**
 * Skora's own model reads every letter and digit of the answers the text reader found, so each
 * answer is checked by two readers. Undefined when the app has no model (it then works as before).
 */
async function modelJudge(pages: ScriptPage[], read: PageIn[], questionCount: number): Promise<Judge | undefined> {
  if (!(await hasReader())) return undefined;
  const wanted = answerBoxes(read, questionCount);
  const probs = new Map<string, number[]>();
  for (let p = 0; p < pages.length; p++) {
    const boxes = wanted.filter((w) => w.page === p);
    if (boxes.length === 0) continue;
    const gray = await loadGray(pages[p].uri);
    if (!gray) return undefined;
    const out = await classifyBoxes(gray, boxes.map((b) => b.box));
    if (!out) return undefined;
    boxes.forEach((b, i) => probs.set(boxKey(p, b.box), out[i]));
  }
  return (page, box) => probs.get(boxKey(page, box));
}

/** Reads the pages with the phone's own readers. Null when this phone cannot read text. */
async function readOnPhone(pages: ScriptPage[], questionCount: number, optionCount: 4 | 5) {
  if (!canReadText) return null;
  try {
    const read: PageIn[] = [];
    for (const p of pages) {
      const t = await readText(p.uri);
      if (!t) return null;
      read.push(t);
    }
    const judge = await modelJudge(pages, read, questionCount).catch(() => undefined);
    return { ...findAnswers(read, questionCount, optionCount, judge), fields: writtenFields(read[0]) as ReadFields };
  } catch {
    return null;
  }
}

async function photosFor(pages: ScriptPage[]): Promise<Photo[]> {
  const photos: Photo[] = [];
  for (const p of pages) {
    const image = await ImageManipulator.manipulate(p.uri, { maxWidth: GEMINI_SIDE, maxHeight: GEMINI_SIDE }).renderAsync();
    const small = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.7, base64: true });
    deletePhoto(small.uri);
    if (!small.base64) throw new Error('Skora could not prepare the photo for Gemini.');
    photos.push({ mime_type: 'image/jpeg', data: small.base64 });
  }
  return photos;
}

/** Asks Gemini to read the pages of a script (through the read-handwriting helper). */
export async function askGemini(settings: Settings, pages: ScriptPage[], questionCount: number, optionCount: 4 | 5, signal?: AbortSignal) {
  return readHandwriting({
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    deviceId: settings.deviceId,
    questionCount,
    optionCount,
    photos: await photosFor(pages),
    signal,
  });
}

export type HandwrittenResult =
  | { ok: true; pending: PendingScript }
  | { ok: false; message: string };

/**
 * Reads a handwritten script on the phone. When some answers are unclear and Gemini is on, the
 * result screen asks Gemini while the teacher already sees the score (state "asking"), so she
 * never waits for it.
 */
export async function readHandwrittenScript(opts: {
  examId: number;
  questionCount: number;
  optionCount: 4 | 5;
  pages: PreparedPage[];
  settings: Settings;
}): Promise<HandwrittenResult> {
  const { examId, questionCount, optionCount, pages, settings } = opts;
  const phoneRead = await readOnPhone(pages, questionCount, optionCount);
  const phone: PhoneAnswer[] =
    phoneRead?.answers ?? Array.from({ length: questionCount }, (_, i) => ({ q: i + 1, chosen: null, clear: false, why: 'not-found' as const }));
  const phoneFound = phoneRead?.found ?? 0;
  const unclear = phone.filter((a) => !a.clear).length;

  // Nothing on the photo looks like answers, and Gemini is off: say so straight away.
  if (phoneFound === 0 && !settings.geminiOn) {
    for (const p of pages) deletePhoto(p.uri);
    return {
      ok: false,
      message:
        'Skora found no answers like "1. B" on this photo. Photograph the answers closer, flat and in good light. ' +
        'Turning on Gemini in Settings helps with hard-to-read writing.',
    };
  }

  const outcome: GeminiOutcome | undefined = unclear === 0 ? undefined : settings.geminiOn ? { state: 'asking' } : { state: 'off' };
  return {
    ok: true,
    pending: {
      examId,
      sheetType: 'handwritten',
      pages,
      answers: handwrittenAnswers(phone, null, questionCount),
      phone,
      readBy: 'phone',
      gemini: outcome,
      fields: phoneRead?.fields,
    },
  };
}

/** How a script was read, for the saved record. */
export function readByOf(phone: PhoneAnswer[], gemini: unknown[] | null): PendingScript['readBy'] {
  if (!gemini) return 'phone';
  return phone.some((a) => a.why !== 'not-found') ? 'both' : 'gemini';
}

/** A script from the waiting list, ready for the result screen. */
export function pendingFromQueue(entry: QueueEntry, questionCount: number): PendingScript {
  return {
    examId: entry.examId,
    sheetType: 'handwritten',
    pages: entry.pages,
    answers: handwrittenAnswers(entry.phone, entry.gemini, questionCount),
    phone: entry.phone,
    readBy: readByOf(entry.phone, entry.gemini),
    gemini:
      entry.status === 'read'
        ? { state: 'used' }
        : entry.status === 'failed'
          ? { state: 'failed', message: entry.lastError ?? undefined }
          : { state: 'later', message: entry.lastError ?? 'Waiting for Gemini.' },
    queueId: entry.id,
  };
}

/**
 * Asks Gemini about every script in the waiting list that is still waiting, one at a time.
 * Stops at the first "try later" (no internet, busy, limit used up) and returns its message.
 */
export async function askGeminiForWaiting(
  db: SQLiteDatabase,
  settings: Settings,
  onProgress?: (done: number, total: number) => void,
): Promise<{ read: number; stopped?: string }> {
  const waiting = (await listQueue(db)).filter((e) => e.status === 'waiting');
  let read = 0;
  for (let i = 0; i < waiting.length; i++) {
    onProgress?.(i, waiting.length);
    const entry = waiting[i];
    const exam = await getExam(db, entry.examId);
    if (!exam) {
      await removeFromQueue(db, entry.id);
      continue;
    }
    if (!entry.pages.every((p) => new File(p.uri).exists)) {
      await setGeminiFailed(db, entry.id, 'The photos of this script are missing. Fix the answers by hand or discard it.', false);
      continue;
    }
    const r = await askGemini(settings, entry.pages, exam.questionCount, exam.optionCount as 4 | 5);
    if (r.ok) {
      await setGeminiRead(db, entry.id, r.answers);
      read++;
    } else {
      await setGeminiFailed(db, entry.id, r.message, r.retryLater);
      if (r.retryLater) return { read, stopped: r.message };
    }
  }
  onProgress?.(waiting.length, waiting.length);
  return { read };
}
