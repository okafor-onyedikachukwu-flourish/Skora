import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { randomUUID } from 'expo-crypto';
import type { SQLiteDatabase } from 'expo-sqlite';
import { canReadText, readText } from '../../../modules/skora-text';
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../config';
import { getExam } from '../db/exams';
import { listQueue, removeFromQueue, setGeminiFailed, setGeminiRead, type QueueEntry } from '../db/queue';
import type { Settings } from '../db/settings';
import { readHandwriting, type Chosen as GeminiChosen, type Photo } from '../readHandwriting';
import { handwrittenAnswers } from '../scan/answers';
import { deletePhoto, scansDir, type GeminiOutcome, type PendingScript, type ScriptPage } from '../scan/pending';
import { findAnswers, type PageIn, type PhoneAnswer } from './parse';

/** Pages are reduced to this many pixels on their longest side: sharp enough for handwriting, small enough to send. */
const PAGE_SIDE = 2000;
export const MAX_PAGES = 4;

/** A page photo saved in Skora's scans folder, upright, with its JPEG as base64 for Gemini. */
export type PreparedPage = ScriptPage & { base64?: string };

export async function preparePage(uri: string): Promise<PreparedPage> {
  const image = await ImageManipulator.manipulate(uri, { maxWidth: PAGE_SIDE, maxHeight: PAGE_SIDE }).renderAsync();
  const saved = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.8, base64: true });
  const target = new File(scansDir(), `${randomUUID()}.jpg`);
  new File(saved.uri).moveSync(target);
  return { uri: target.uri, width: saved.width, height: saved.height, base64: saved.base64 };
}

/** Reads the pages with the phone's own text reader. Null when this phone cannot read text. */
async function readOnPhone(pages: ScriptPage[], questionCount: number, optionCount: 4 | 5) {
  if (!canReadText) return null;
  try {
    const read: PageIn[] = [];
    for (const p of pages) {
      const t = await readText(p.uri);
      if (!t) return null;
      read.push(t);
    }
    return findAnswers(read, questionCount, optionCount);
  } catch {
    return null;
  }
}

async function photosFor(pages: PreparedPage[]): Promise<Photo[]> {
  return Promise.all(
    pages.map(async (p) => ({ mime_type: 'image/jpeg' as const, data: p.base64 ?? (await new File(p.uri).base64()) })),
  );
}

async function askGemini(settings: Settings, pages: PreparedPage[], questionCount: number, optionCount: 4 | 5) {
  return readHandwriting({
    supabaseUrl: SUPABASE_URL,
    publishableKey: SUPABASE_PUBLISHABLE_KEY,
    deviceId: settings.deviceId,
    questionCount,
    optionCount,
    photos: await photosFor(pages),
  });
}

function readByOf(phoneFound: number, gemini: unknown[] | null): PendingScript['readBy'] {
  if (!gemini) return 'phone';
  return phoneFound > 0 ? 'both' : 'gemini';
}

export type HandwrittenResult =
  | { ok: true; pending: PendingScript }
  | { ok: false; message: string };

/**
 * Reads a handwritten script: the phone first, then Gemini for the answers the phone could not
 * read clearly (when Gemini is on). `onStep` reports progress for the busy screen.
 */
export async function readHandwrittenScript(opts: {
  examId: number;
  questionCount: number;
  optionCount: 4 | 5;
  pages: PreparedPage[];
  settings: Settings;
  onStep?: (text: string) => void;
}): Promise<HandwrittenResult> {
  const { examId, questionCount, optionCount, pages, settings } = opts;
  opts.onStep?.('Reading the writing…');
  const phoneRead = await readOnPhone(pages, questionCount, optionCount);
  const phone: PhoneAnswer[] =
    phoneRead?.answers ?? Array.from({ length: questionCount }, (_, i) => ({ q: i + 1, chosen: null, clear: false, why: 'not-found' as const }));
  const phoneFound = phoneRead?.found ?? 0;
  const unclear = phone.filter((a) => !a.clear).length;

  let gemini: { q: number; chosen: GeminiChosen }[] | null = null;
  let outcome: GeminiOutcome | undefined;
  if (unclear > 0) {
    if (!settings.geminiOn) {
      outcome = { state: 'off' };
    } else {
      opts.onStep?.(unclear === questionCount ? 'Asking Gemini to read the script…' : `Asking Gemini about ${unclear} ${unclear === 1 ? 'answer' : 'answers'}…`);
      const r = await askGemini(settings, pages, questionCount, optionCount);
      if (r.ok) {
        gemini = r.answers;
        outcome = { state: 'used' };
      } else {
        outcome = { state: r.retryLater ? 'later' : 'failed', message: r.message };
      }
    }
  }

  const geminiFound = (gemini ?? []).filter((a) => a.chosen !== 'unclear').length;
  // Nothing on the photo looks like answers, and nobody can look again later: say so.
  if (phoneFound === 0 && geminiFound === 0 && outcome?.state !== 'later') {
    for (const p of pages) deletePhoto(p.uri);
    return {
      ok: false,
      message:
        outcome?.state === 'used'
          ? 'Neither the phone nor Gemini found answers on this photo. Photograph the answers closer, flat and in good light.'
          : 'Skora found no answers like "1. B" on this photo. Photograph the answers closer, flat and in good light.' +
            (outcome?.state === 'off' ? ' Turning on Gemini in Settings helps with hard-to-read writing.' : ''),
    };
  }

  return {
    ok: true,
    pending: {
      examId,
      sheetType: 'handwritten',
      pages: pages.map(({ uri, width, height }) => ({ uri, width, height })),
      answers: handwrittenAnswers(phone, gemini, questionCount),
      phone,
      readBy: readByOf(phoneFound, gemini),
      gemini: outcome,
    },
  };
}

/** A script from the waiting list, ready for the result screen. */
export function pendingFromQueue(entry: QueueEntry, questionCount: number): PendingScript {
  const phoneFound = entry.phone.filter((a) => a.why !== 'not-found').length;
  return {
    examId: entry.examId,
    sheetType: 'handwritten',
    pages: entry.pages,
    answers: handwrittenAnswers(entry.phone, entry.gemini, questionCount),
    phone: entry.phone,
    readBy: readByOf(phoneFound, entry.gemini),
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
