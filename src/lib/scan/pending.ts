import { Directory, File, Paths } from 'expo-file-system';

/**
 * The script just scanned, waiting on the result screen for Save or Discard.
 * Kept in memory only: if the app closes before Save, the teacher scans the sheet again.
 */
export type PendingScript = {
  examId: number;
  /** One character per question, see src/lib/scan/read.ts. */
  answers: string;
  /** Straightened photo of the page, deleted on Save or Discard. */
  imageUri: string;
  sheetType: 'omr' | 'handwritten';
};

let pending: PendingScript | null = null;

export function setPending(p: PendingScript) {
  if (pending && pending.imageUri !== p.imageUri) deletePhoto(pending.imageUri);
  pending = p;
}

export function getPending(examId: number): PendingScript | null {
  return pending && pending.examId === examId ? pending : null;
}

/** Forgets the scan and deletes its photo. */
export function clearPending() {
  if (pending) deletePhoto(pending.imageUri);
  pending = null;
}

function deletePhoto(uri: string) {
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

/** The last script saved, shown on the camera screen when the teacher comes back to it. */
let lastSaved: { examId: number; name: string; score: number; maxScore: number } | null = null;

export function setLastSaved(s: typeof lastSaved) {
  lastSaved = s;
}

export function takeLastSaved(examId: number) {
  const s = lastSaved && lastSaved.examId === examId ? lastSaved : null;
  lastSaved = null;
  return s;
}

/** Deletes scan photos left behind (the app closed, or the teacher went back without Save or Discard). */
export function tidyScanPhotos() {
  try {
    const dir = new Directory(Paths.document, 'scans');
    if (!dir.exists) return;
    for (const item of dir.list()) {
      if (item instanceof File && item.uri !== pending?.imageUri) item.delete();
    }
  } catch {
    // Not important enough to bother the teacher.
  }
}
