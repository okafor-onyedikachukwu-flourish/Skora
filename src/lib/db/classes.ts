import type { SQLiteDatabase } from 'expo-sqlite';
import { cleanName } from './index';

export type ClassRow = { id: number; name: string; students: number; exams: number };
export type ClassName = { id: number; fullName: string };

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

/** Every class, with the size of its class list and how many exams use it. */
export async function listClasses(db: SQLiteDatabase): Promise<ClassRow[]> {
  const rows = await db.getAllAsync<ClassRow>(
    `SELECT c.id, c.name,
            (SELECT count(*) FROM class_names n WHERE n.class_id = c.id) AS students,
            (SELECT count(*) FROM exam_classes e WHERE e.class_id = c.id) AS exams
       FROM classes c`,
  );
  return rows.sort(byName);
}

export async function getClass(db: SQLiteDatabase, id: number): Promise<ClassRow | null> {
  return db.getFirstAsync<ClassRow>(
    `SELECT c.id, c.name,
            (SELECT count(*) FROM class_names n WHERE n.class_id = c.id) AS students,
            (SELECT count(*) FROM exam_classes e WHERE e.class_id = c.id) AS exams
       FROM classes c WHERE c.id = ?`,
    id,
  );
}

/** Adds classes by name, skipping any that already exist (ignoring capitals). Returns how many were added. */
export async function addClasses(db: SQLiteDatabase, names: string[]): Promise<number> {
  let added = 0;
  await db.withTransactionAsync(async () => {
    for (const raw of names) {
      const name = cleanName(raw);
      if (!name) continue;
      if (name.length > 40) throw new Error(`"${name.slice(0, 20)}…" is too long for a class name (40 letters at most).`);
      const r = await db.runAsync('INSERT OR IGNORE INTO classes (name) VALUES (?)', name);
      added += r.changes;
    }
  });
  return added;
}

export async function renameClass(db: SQLiteDatabase, id: number, name: string) {
  const clean = cleanName(name);
  if (!clean) throw new Error('Enter a class name.');
  if (clean.length > 40) throw new Error('A class name can be 40 letters at most.');
  await db.runAsync('UPDATE classes SET name = ? WHERE id = ?', clean, id);
}

/** Deletes a class and its class list. Refused by the database while an exam uses the class. */
export async function deleteClass(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM classes WHERE id = ?', id);
}

export async function listClassNames(db: SQLiteDatabase, classId: number): Promise<ClassName[]> {
  return db.getAllAsync<ClassName>(
    'SELECT id, full_name AS fullName FROM class_names WHERE class_id = ? ORDER BY full_name COLLATE NOCASE',
    classId,
  );
}

/** Adds names to a class list, skipping ones already there. Returns how many were added. */
export async function addClassNames(db: SQLiteDatabase, classId: number, names: string[]): Promise<number> {
  let added = 0;
  await db.withTransactionAsync(async () => {
    for (const raw of names) {
      const fullName = cleanName(raw);
      if (fullName.length < 2) continue;
      const r = await db.runAsync('INSERT OR IGNORE INTO class_names (class_id, full_name) VALUES (?, ?)', classId, fullName);
      added += r.changes;
    }
  });
  return added;
}

export async function deleteClassName(db: SQLiteDatabase, id: number) {
  await db.runAsync('DELETE FROM class_names WHERE id = ?', id);
}
