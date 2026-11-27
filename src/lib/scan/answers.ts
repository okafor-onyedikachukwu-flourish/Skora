import type { AnswerSource, Chosen } from '../db/scripts';
import type { PhoneAnswer, Where, Why } from '../handwriting/parse';
import { mergeReads, type Chosen as GeminiChosen } from '../readHandwriting';

/** One question as the result screen shows it, whichever reader read it. */
export type ReadAnswer = {
  /** The answer Skora offers; null when it has none and the teacher must pick. */
  chosen: Chosen | null;
  /** Highlighted for the teacher to check before Save. */
  unsure: boolean;
  source: Exclude<AnswerSource, 'teacher'>;
  /** Why it needs checking, in words for the teacher. */
  note?: string;
  /** Handwritten scripts: where the answer is on which page. */
  where?: Where;
};

export const describeAnswer = (c: Chosen | null) => (c === null ? 'nothing' : c === 'blank' ? 'Blank' : c === 'several' ? 'Several' : c);

/** Turns the sheet reader's answer characters (see src/lib/scan/read.ts) into answers. */
export function omrAnswers(chars: string, count: number): ReadAnswer[] {
  return Array.from({ length: count }, (_, i) => {
    const a = chars[i] ?? '-';
    if (a >= 'A' && a <= 'E') return { chosen: a as Chosen, unsure: false, source: 'omr' };
    if (a >= 'a' && a <= 'e') return { chosen: a.toUpperCase() as Chosen, unsure: true, source: 'omr', note: 'Faint or rubbed-out shading.' };
    if (a === '#') return { chosen: 'several', unsure: true, source: 'omr', note: 'More than one bubble is shaded.' };
    return { chosen: 'blank', unsure: false, source: 'omr' };
  });
}

const WHY: Record<Why, string> = {
  'not-found': 'Skora could not find this number on the script.',
  lookalike: 'The letter is hard to read.',
  faint: 'The writing is faint or unclear.',
  'two-answers': 'More than one answer, or one crossed out.',
  'out-of-order': 'The number may be misread.',
  'repeated-number': 'This number is written twice on the script.',
  'not-an-option': 'Read as E, but this exam has options A to D only.',
  'readers-disagree': "The phone's two readers read different letters.",
  'crossed-out': 'The answer is crossed out.',
};

// A guess Gemini can confirm or overrule: the letter itself was read, only less surely.
const LETTER_GUESS = new Set<Why | undefined>(['lookalike', 'faint', 'two-answers', 'readers-disagree']);

/**
 * The phone's reading of a handwritten script, with Gemini's when it was asked (null when not),
 * as answers for the result screen.
 */
export function handwrittenAnswers(phone: PhoneAnswer[], gemini: { q: number; chosen: GeminiChosen }[] | null, count: number): ReadAnswer[] {
  const byQ = new Map(phone.map((a) => [a.q, a]));
  const merged = mergeReads(
    count,
    phone.map((a) => ({
      q: a.q,
      chosen: a.chosen !== null && (a.clear || LETTER_GUESS.has(a.why)) ? a.chosen : 'unclear',
      clear: a.clear,
    })),
    gemini,
  );
  return merged.map((m) => {
    const p = byQ.get(m.q);
    const chosen = m.chosen === 'unclear' ? null : m.chosen;
    const answer: ReadAnswer = { chosen, unsure: !m.clear, source: m.source, where: p?.where };
    if (!m.clear) {
      if (m.alsoRead) {
        const [phoneRead, geminiRead] = m.source === 'mlkit' ? [m.chosen, m.alsoRead] : [m.alsoRead, m.chosen];
        answer.note = `The phone read ${describeAnswer(phoneRead === 'unclear' ? null : phoneRead)}, Gemini read ${describeAnswer(geminiRead === 'unclear' ? null : geminiRead)}.`;
      } else {
        answer.note = (p?.why ? WHY[p.why] : 'Not read clearly.') + (gemini ? ' Gemini could not read it either.' : '');
      }
    }
    return answer;
  });
}
