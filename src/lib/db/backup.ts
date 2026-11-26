import * as DocumentPicker from 'expo-document-picker';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { backupDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';
import { prepareDatabase } from './index';
import { writeSettings } from './settings';

/** Every SQLite file starts with these 16 bytes. */
const SQLITE_HEADER = 'SQLite format 3\u0000';

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/**
 * Copies all of Skora's data into one file and opens the share sheet,
 * so the teacher can keep it in Google Drive, send it on WhatsApp, and so on.
 */
export async function backUp(db: SQLiteDatabase): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error("This phone can't share files.");
  const name = `skora-backup-${stamp()}.db`;
  const old = new File(Paths.cache, name);
  if (old.exists) old.delete();

  const copy = await openDatabaseAsync(name, { useNewConnection: true }, Paths.cache.uri);
  try {
    await backupDatabaseAsync({ sourceDatabase: db, destDatabase: copy });
  } finally {
    await copy.closeAsync();
  }

  const file = new File(Paths.cache, name);
  await writeSettings(db, { lastBackupAt: new Date().toISOString() });
  await Sharing.shareAsync(file.uri, {
    mimeType: 'application/octet-stream',
    dialogTitle: 'Save your Skora backup',
  });
}

export type RestoreCheck = { file: File; exams: number; scripts: number; classes: number };

/** Lets the teacher pick a backup file and checks it is a Skora backup. Returns null if she cancels. */
export async function pickBackup(): Promise<RestoreCheck | null> {
  const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  if (res.canceled) return null;
  const file = new File(res.assets[0].uri);

  const head = (await file.bytes()).slice(0, 16);
  if (String.fromCharCode(...head) !== SQLITE_HEADER) {
    throw new Error("That file isn't a Skora backup. Pick the file that starts with skora-backup.");
  }

  const picked = await openDatabaseAsync(file.name, { useNewConnection: true }, file.parentDirectory.uri);
  try {
    const tables = await picked.getAllAsync<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('settings', 'classes', 'exams', 'saved_scripts')",
    );
    if (tables.length < 4) throw new Error("That file isn't a Skora backup. Pick the file that starts with skora-backup.");
    const count = async (table: string) =>
      (await picked.getFirstAsync<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))?.n ?? 0;
    return { file, exams: await count('exams'), scripts: await count('saved_scripts'), classes: await count('classes') };
  } finally {
    await picked.closeAsync();
  }
}

/** Replaces everything on this phone with the backup. Call only after the teacher has confirmed. */
export async function restore(db: SQLiteDatabase, backup: RestoreCheck): Promise<void> {
  const picked = await openDatabaseAsync(backup.file.name, { useNewConnection: true }, backup.file.parentDirectory.uri);
  try {
    await backupDatabaseAsync({ sourceDatabase: picked, destDatabase: db });
  } finally {
    await picked.closeAsync();
  }
  // A backup from an older version of Skora is brought up to date here.
  await prepareDatabase(db);
}
