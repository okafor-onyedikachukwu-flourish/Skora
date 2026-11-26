import { OPTION_LETTERS } from './sheet/layout';

export const MAX_QUESTIONS = 100;

export function lettersFor(optionCount: number): string[] {
  return OPTION_LETTERS.slice(0, optionCount);
}

export function optionsLabel(optionCount: number): string {
  const l = lettersFor(optionCount);
  return `${l[0]}–${l[l.length - 1]}`;
}

/**
 * Reads a typed or pasted key such as "ABDC CADB", "1A 2C 3B" or "1. a, 2. c".
 * Keeps only option letters, in order.
 */
export function parseTypedKey(text: string, optionCount: number): string[] {
  const allowed = new Set(lettersFor(optionCount));
  // Drop question numbers first, so "10 B" doesn't leave stray characters.
  const letters: string[] = [];
  for (const ch of text.toUpperCase().replace(/\d+/g, ' ')) if (allowed.has(ch)) letters.push(ch);
  return letters;
}

/** Reads a typed number of marks: "2", "0.5" or "0,5". Returns null if it isn't a sensible mark. */
export function parseMarks(text: string): number | null {
  const v = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(v) || v <= 0 || v > 100) return null;
  return Math.round(v * 100) / 100;
}

export function formatMarks(n: number): string {
  const v = Math.round(n * 100) / 100;
  return `${v} ${v === 1 ? 'mark' : 'marks'}`;
}

/** Today as YYYY-MM-DD in the phone's time zone. */
export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
