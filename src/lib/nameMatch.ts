/**
 * Matching what Skora read from a script (the student's name, class or subject, often with
 * reading mistakes) to the names Skora already knows. Only a clear match fills in the Save form;
 * anything less is offered as a suggestion the teacher taps.
 */

export type KnownName = { name: string; classId: number };
export type NameMatch = KnownName & { score: number };

/** A read name counts as the same student only above this score, and clearly ahead of the next one. */
export const SURE_SCORE = 0.86;
const SURE_LEAD = 0.06;

// Digits and marks the text reader gives for handwritten letters.
const LOOKS_LIKE: Record<string, string> = { '0': 'o', '1': 'l', '5': 's', '8': 'b', '6': 'b', '|': 'l', '!': 'l', '$': 's', '@': 'a' };

/** Lower case, lookalike digits turned into letters, everything else that is not a letter dropped. */
export function nameTokens(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0-9|!$@]/g, (c) => LOOKS_LIKE[c] ?? ' ')
    .replace(/[^a-z\s'-]/g, ' ')
    .replace(/['-]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

/** Jaro-Winkler similarity, 0 (nothing alike) to 1 (the same). Forgiving of small misreadings. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aHit = new Array(a.length).fill(false);
  const bHit = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(b.length - 1, i + range);
    for (let j = lo; j <= hi; j++) {
      if (bHit[j] || a[i] !== b[j]) continue;
      aHit[i] = bHit[j] = true;
      matches++;
      break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  let swaps = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aHit[i]) continue;
    while (!bHit[k]) k++;
    if (a[i] !== b[k]) swaps++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - swaps / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

function bestTokenScore(token: string, others: string[]): number {
  let best = 0;
  for (const o of others) best = Math.max(best, similarity(token, o));
  return best;
}

/**
 * How alike a read name and a known name are, 0 to 1. Word order does not matter
 * ("Okafor Ada" = "Ada Okafor"), and a missing middle name costs a little, not everything.
 */
export function nameScore(read: string, known: string): number {
  const r = nameTokens(read).filter((t) => t.length > 1);
  const k = nameTokens(known).filter((t) => t.length > 1);
  if (r.length === 0 || k.length === 0) return 0;
  const readSide = r.reduce((s, t) => s + bestTokenScore(t, k), 0) / r.length;
  const knownSide = k.reduce((s, t) => s + bestTokenScore(t, r), 0) / k.length;
  // Words run together ("AdaOkafor") still match the whole name, in either order.
  const joined = r.join('');
  const together = Math.max(similarity(joined, k.join('')), similarity(joined, [...k].reverse().join('')));
  return Math.max(readSide * 0.6 + knownSide * 0.4, together * 0.97);
}

/** The known names closest to what was read, best first. */
export function matchNames(read: string, known: KnownName[], limit = 3): NameMatch[] {
  if (nameTokens(read).join('').length < 3) return [];
  const seen = new Set<string>();
  const scored: NameMatch[] = [];
  for (const k of known) {
    const key = `${k.classId}:${k.name.trim().toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    scored.push({ ...k, score: nameScore(read, k.name) });
  }
  return scored
    .filter((m) => m.score >= 0.7)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** The one match good enough to fill in by itself, if there is one. */
export function sureMatch(matches: NameMatch[]): NameMatch | null {
  const [best, next] = matches;
  if (!best || best.score < SURE_SCORE) return null;
  if (!next || next.name.trim().toLowerCase() === best.name.trim().toLowerCase()) return best;
  // Read exactly as written in the class list: that student, unless another reads exactly the same.
  if (best.score >= 0.99) return next.score >= 0.99 ? null : best;
  return best.score - next.score >= SURE_LEAD ? best : null;
}

/** The option a short read text (a class such as "JSS 2A", or a subject) stands for, if it is clear. */
export function matchOption(read: string, options: string[]): string | null {
  const plain = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const digits = (s: string) => s.replace(/[^0-9]/g, '');
  const r = plain(read);
  if (r.length < 2) return null;
  let best: string | null = null;
  let bestScore = 0;
  let second = 0;
  for (const o of options) {
    let score = Math.max(similarity(r, plain(o)), similarity(nameTokens(read).join(''), nameTokens(o).join('')) * 0.95);
    // In a class name the numbers matter most: JSS 1A is not JSS 2A.
    if (digits(o) !== digits(read)) score *= digits(o) && digits(read) ? 0.6 : 0.9;
    if (score > bestScore) {
      second = bestScore;
      best = o;
      bestScore = score;
    } else if (score > second) {
      second = score;
    }
  }
  return best && bestScore >= 0.88 && bestScore - second >= 0.04 ? best : null;
}
