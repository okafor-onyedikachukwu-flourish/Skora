import type { SQLiteDatabase } from 'expo-sqlite';

/** Everything in the settings table, with its type. */
export type Settings = {
  /** Printed on Skora sheets. Optional. */
  teacherName: string;
  /** Printed on Skora sheets. Optional. */
  schoolName: string;
  /** Pass rates count scores at or above this percentage. Starts at 50. */
  passMarkPercent: number;
  /** Send handwriting the phone can't read clearly to Gemini. */
  geminiOn: boolean;
  /** Random id sent with Gemini requests, for the daily limit. */
  deviceId: string;
  /** The first-run screen has been completed. */
  setUpDone: boolean;
  /** ISO time of the last backup, or '' if never. */
  lastBackupAt: string;
};

const KEYS: Record<keyof Settings, string> = {
  teacherName: 'teacher_name',
  schoolName: 'school_name',
  passMarkPercent: 'pass_mark_percent',
  geminiOn: 'gemini_on',
  deviceId: 'device_id',
  setUpDone: 'set_up_done',
  lastBackupAt: 'last_backup_at',
};

export async function readSettings(db: SQLiteDatabase): Promise<Settings> {
  const rows = await db.getAllAsync<{ key: string; value: string }>('SELECT key, value FROM settings');
  const v = new Map(rows.map((r) => [r.key, r.value]));
  const pass = Number(v.get(KEYS.passMarkPercent));
  return {
    teacherName: v.get(KEYS.teacherName) ?? '',
    schoolName: v.get(KEYS.schoolName) ?? '',
    passMarkPercent: Number.isFinite(pass) ? pass : 50,
    geminiOn: (v.get(KEYS.geminiOn) ?? '1') === '1',
    deviceId: v.get(KEYS.deviceId) ?? '',
    setUpDone: v.get(KEYS.setUpDone) === '1',
    lastBackupAt: v.get(KEYS.lastBackupAt) ?? '',
  };
}

function toText(value: Settings[keyof Settings]): string {
  if (typeof value === 'boolean') return value ? '1' : '0';
  return String(value);
}

export async function writeSettings(db: SQLiteDatabase, changes: Partial<Settings>) {
  const entries = Object.entries(changes) as [keyof Settings, Settings[keyof Settings]][];
  if (entries.length === 0) return;
  await db.withTransactionAsync(async () => {
    for (const [name, value] of entries) {
      if (name === 'deviceId') continue; // made once by the database, never changed by the app
      if (name === 'passMarkPercent' && !(typeof value === 'number' && value >= 0 && value <= 100)) {
        throw new Error('The pass mark must be between 0 and 100.');
      }
      await db.runAsync(
        'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
        KEYS[name],
        toText(value),
      );
    }
  });
}
