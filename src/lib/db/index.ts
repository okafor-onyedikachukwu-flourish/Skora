import type { SQLiteDatabase } from 'expo-sqlite';
import { MIGRATE_1_TO_2, SCHEMA } from './schema';

/** Skora's one database file, in the app's private SQLite folder. */
export const DB_NAME = 'skora.db';

/** The newest schema version this build of the app knows. */
export const SCHEMA_VERSION = 2;

/**
 * Runs every time the database opens (SQLiteProvider onInit), and again after a restore.
 * Turns on foreign keys for this connection, then brings an older database up to date.
 */
export async function prepareDatabase(db: SQLiteDatabase) {
  await db.execAsync('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  const version = (await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  if (version > SCHEMA_VERSION) {
    throw new Error('This data comes from a newer version of Skora. Update the app, then try again.');
  }
  if (version === SCHEMA_VERSION) return;
  await db.withTransactionAsync(async () => {
    if (version === 0) await db.execAsync(SCHEMA);
    else if (version === 1) await db.execAsync(MIGRATE_1_TO_2);
    // Later versions: else if (version === 2) await db.execAsync(MIGRATE_2_TO_3);
  });
}

/** Turns a typed name into the form Skora stores: trimmed, with single spaces. */
export function cleanName(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
