import { Directory, File, Paths } from 'expo-file-system';
import type { PhoneAnswer } from '../handwriting/parse';
import type { ReadAnswer } from './answers';

/** A photo of one page, kept in Skora's scans folder until the script is saved or discarded. */
export type ScriptPage = { uri: string; width: number; height: number };

/** What happened when Skora needed Gemini for a handwritten script. */
export type GeminiOutcome = {
  state: 'used' | 'off' | 'later' | 'failed';
  message?: string;
};

/**
 * The script just scanned (or opened from the waiting list), on the result screen until Save or
 * Discard. Kept in memory only: if the app closes before Save, the teacher scans the sheet again.
 */
export type PendingScript = {
  examId: number;
  sheetType: 'omr' | 'handwritten';
  /** Skora sheets: one straightened page. Handwritten scripts: 1 to 4 page photos. */
  pages: ScriptPage[];
  answers: ReadAnswer[];
  /** Handwritten scripts: the phone's own reading, kept so Gemini can be asked later. */
  phone?: PhoneAnswer[];
  readBy: 'phone' | 'gemini' | 'both';
  /** Only for handwritten scripts that needed Gemini. */
  gemini?: GeminiOutcome;
  /** Set when the script came from the waiting list, which then owns the photos. */
  queueId?: number;
};

let pending: PendingScript | null = null;

export function scansDir(): Directory {
  const dir = new Directory(Paths.document, 'scans');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export function setPending(p: PendingScript) {
  if (pending && pending.queueId === undefined) {
    const keep = new Set(p.pages.map((x) => x.uri));
    for (const page of pending.pages) if (!keep.has(page.uri)) deletePhoto(page.uri);
  }
  pending = p;
}

export function getPending(examId: number): PendingScript | null {
  return pending && pending.examId === examId ? pending : null;
}

/** Forgets the scan and deletes its photos (unless the waiting list owns them). */
export function clearPending() {
  if (pending && pending.queueId === undefined) for (const page of pending.pages) deletePhoto(page.uri);
  pending = null;
}

/** Forgets the scan but keeps its photos, for example once it is in the waiting list. */
export function releasePending() {
  pending = null;
}

export function deletePhoto(uri: string) {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone: nothing to do.
  }
}

/** What the teacher typed last time, so a pile of scripts from one class needs less typing. */
export type SaveDefaults = { classId: number | null; subject: string; writtenOn: string | null };
const defaults = new Map<number, SaveDefaults>();

export function getSaveDefaults(examId: number): SaveDefaults {
  return defaults.get(examId) ?? { classId: null, subject: '', writtenOn: null };
}

export function rememberSaveDefaults(examId: number, d: SaveDefaults) {
  defaults.set(examId, d);
}

/** Skora sheet or any paper, as the teacher last chose for each exam. */
export type ScanMode = 'omr' | 'handwritten';
const modes = new Map<number, ScanMode>();
let lastMode: ScanMode = 'omr';

export function getScanMode(examId: number): ScanMode {
  return modes.get(examId) ?? lastMode;
}

export function setScanMode(examId: number, mode: ScanMode) {
  modes.set(examId, mode);
  lastMode = mode;
}

/** The last script saved or put aside, shown on the camera screen when the teacher comes back to it. */
type LastDone = { examId: number; name: string; score: number; maxScore: number; kept?: false } | { examId: number; kept: true };
let lastDone: LastDone | null = null;

export function setLastSaved(s: LastDone) {
  lastDone = s;
}

export function takeLastSaved(examId: number) {
  const s = lastDone && lastDone.examId === examId ? lastDone : null;
  lastDone = null;
  return s;
}

/**
 * Deletes scan photos left behind (the app closed, or the teacher went back without Save or
 * Discard). Photos of the script on screen and of scripts in the waiting list are kept.
 */
export function tidyScanPhotos(keepNames: Iterable<string> = [], keepUris: Iterable<string> = []) {
  try {
    const dir = new Directory(Paths.document, 'scans');
    if (!dir.exists) return;
    const names = new Set(keepNames);
    const uris = new Set(keepUris);
    for (const page of pending?.pages ?? []) uris.add(page.uri);
    for (const item of dir.list()) {
      if (item instanceof File && !names.has(item.name) && !uris.has(item.uri)) item.delete();
    }
  } catch {
    // Not important enough to bother the teacher.
  }
}
