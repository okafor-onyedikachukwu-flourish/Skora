/**
 * Finds a student's answers on a handwritten script (foolscap or any paper) from the lines of
 * writing the phone's text reader (ML Kit) found. Students write answers in many ways:
 * "1. B", "1) b", "1-B", "1B", "(1) B", "Q1. B", in columns or several on one line.
 *
 * Every question gets one answer. An answer is "clear" only when the writing was read plainly,
 * fits the order of the numbers around it and no other answer claims the same question;
 * anything else is left for Gemini or the teacher to check.
 */

export type Letter = 'A' | 'B' | 'C' | 'D' | 'E';

/** The shapes the text reader returns (see modules/skora-text). Boxes are [left, top, right, bottom] in pixels. */
export type WordIn = { text: string; box: number[]; confidence?: number };
export type LineIn = { text: string; box: number[]; confidence?: number; words: WordIn[] };
export type PageIn = { width: number; height: number; lines: LineIn[] };

/** Where an answer is on a page, as fractions of the page's width and height. */
export type Where = { page: number; x: number; y: number; w: number; h: number };

export type Why =
  | 'not-found' // no answer for this number was found
  | 'lookalike' // read as something that looks like a letter, such as 8 for B
  | 'faint' // the text reader was not confident
  | 'two-answers' // more than one answer for this question
  | 'out-of-order' // the number does not fit the numbers around it, so it may be misread
  | 'repeated-number' // the same number is written somewhere else on the script too
  | 'not-an-option'; // E on an exam with options A to D

export type PhoneAnswer = {
  q: number;
  /** Best reading, or null when there is none. 'several' = more than one letter given. */
  chosen: Letter | 'several' | null;
  clear: boolean;
  why?: Why;
  where?: Where;
};

export type HandwritingRead = { answers: PhoneAnswer[]; found: number; clear: number };

/** ML Kit confidence below this makes an answer "check this". Tune with real scripts. */
export const MIN_CONFIDENCE = 0.5;

type Box = [number, number, number, number];

/** Something with a question number and a place on a page: an answer, or a number on its own. */
type Placed = {
  q: number;
  page: number;
  numLeft: number;
  cy: number;
  h: number;
  /** Strict, confident and in order. */
  sure: boolean;
  why?: Why;
  inOrder: boolean;
  /** The numbers just before and after it in reading order are lower and higher. */
  anchored: boolean;
};

type Candidate = Placed & {
  chosen: Letter | 'several';
  /** Read from plain digits and a plain letter. */
  strict: boolean;
  box: Box;
};

// Writing that is not an answer: the student's name, class, the date and so on. A number that
// follows one of these words on the same line is ignored (so "Class: JSS 2A" is not question 2).
const HEADER = /\b(name|class|subject|date|school|exam|examination|term|session|teacher|admission|reg|form|basic|primary|pry|nursery|grade|year|paper|section|page|time|duration|jss|sss|js|ss)\b/i;

// "12. B", "12)b", "(12) B", "12-B", "12·B", "12B", "12. A/B"
const STRICT = /(\(\s*)?([0-9]{1,3})(\s*\)?\s*[.,:;)\]}>=/·•_-]{0,2}\s*\(?)([A-Ea-e](?:\s*[/,&+]\s*[A-Ea-e])*)\s*\)?(?![A-Za-z])/g;

// The same with characters the text reader often gives for handwritten numbers and letters:
// l or I for 1, O for 0; 8 or 13 for B, ( or G for C, 0 or O for D, 4 for A.
const LOOSE = /(\(\s*)?([0-9lI|!][0-9lIOo|]{0,2})(\s*\)?\s*[.,:;)\]}>=/·•_-]{0,2}\s*\(?\s*)(13|[|lI]3|[A-Ea-e8€([{<0OQ6G4])\s*\)?(?![A-Za-z0-9])/g;

const LOOKALIKE: Record<string, Letter> = {
  '8': 'B', '13': 'B', '|3': 'B', l3: 'B', I3: 'B', '6': 'B',
  '(': 'C', '[': 'C', '{': 'C', '<': 'C', G: 'C',
  '0': 'D', O: 'D', Q: 'D',
  '4': 'A', '€': 'E',
};

const SECOND_LETTER = /^\s*\(?([A-Ea-e])\)?(?=\s*$|\s*[0-9(]|\s*[.,;:)\-])/;

const LONE_NUMBER = /^\(?\s*([0-9]{1,3})\s*[.):-]?$/;
const LONE_LETTER = /^\(?([A-Ea-e])[.)]?$/;

/** Reads the answers for questions 1 to questionCount from the pages of one script, in page order. */
export function findAnswers(pages: PageIn[], questionCount: number, optionCount: 4 | 5): HandwritingRead {
  const candidates: Candidate[] = [];
  const bare: Placed[] = []; // numbers with no answer beside them
  pages.forEach((page, p) => {
    const found = pageCandidates(page, p, questionCount);
    candidates.push(...found.candidates);
    bare.push(...found.bare);
  });
  // Numbers with no answer still show where questions are, so they help check the order.
  markOrder([...candidates, ...bare], pages);
  const bareQ = new Set(bare.map((b) => b.q));

  const byQ = new Map<number, Candidate[]>();
  for (const c of candidates) {
    const list = byQ.get(c.q) ?? [];
    list.push(c);
    byQ.set(c.q, list);
  }

  const answers: PhoneAnswer[] = [];
  for (let q = 1; q <= questionCount; q++) {
    let group = byQ.get(q) ?? [];
    if (group.length === 0) {
      answers.push({ q, chosen: null, clear: false, why: 'not-found' });
      continue;
    }
    // A plain reading beats a lookalike one for the same question.
    if (group.some((c) => c.strict)) group = group.filter((c) => c.strict);
    // Two answers side by side are a correction or two choices: the teacher decides. Otherwise a
    // second number far away is usually a misread one: keep the copy that sits between the numbers
    // just before and after it, when exactly one does.
    if (group.length > 1 && !sideBySide(group)) {
      const anchored = group.filter((c) => c.inOrder && c.anchored);
      if (anchored.length === 1) group = anchored;
    }
    const best = [...group].sort(rank)[0];
    const where = toWhere(best, pages[best.page]);
    const distinct = new Set(group.map((c) => c.chosen));

    let a: PhoneAnswer;
    if (distinct.size > 1) a = { q, chosen: best.chosen, clear: false, why: 'two-answers', where };
    else if (best.chosen === 'several') a = { q, chosen: 'several', clear: false, why: 'two-answers', where };
    else if (bareQ.has(q)) a = { q, chosen: best.chosen, clear: false, why: 'repeated-number', where };
    else if (best.sure) a = { q, chosen: best.chosen, clear: true, where };
    else a = { q, chosen: best.chosen, clear: false, why: best.why ?? 'faint', where };

    if (a.chosen === 'E' && optionCount === 4) a = { q, chosen: null, clear: false, why: 'not-an-option', where };
    answers.push(a);
  }

  const found = answers.filter((a) => a.why !== 'not-found').length;
  return { answers, found, clear: answers.filter((a) => a.clear).length };
}

function sideBySide(group: Candidate[]) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const a = group[i];
      const b = group[j];
      if (a.page === b.page && Math.abs(a.cy - b.cy) < Math.max(a.h, b.h) * 0.8) return true;
    }
  }
  return false;
}

function rank(a: Candidate, b: Candidate) {
  return Number(b.sure) - Number(a.sure) || Number(b.inOrder) - Number(a.inOrder) || Number(b.strict) - Number(a.strict);
}

function toWhere(c: Candidate, page: PageIn): Where {
  const [l, t, r, b] = c.box;
  return { page: c.page, x: l / page.width, y: t / page.height, w: (r - l) / page.width, h: (b - t) / page.height };
}

/** One line of text as a single string, remembering which word each character came from. */
type LineText = { s: string; word: number[]; pos: number[]; words: WordIn[]; box: number[]; matched: boolean };

function lineText(line: LineIn): LineText {
  const words = line.words.length > 0 ? line.words : [{ text: line.text, box: line.box, confidence: line.confidence }];
  let s = '';
  const word: number[] = [];
  const pos: number[] = [];
  words.forEach((w, wi) => {
    if (wi > 0) {
      s += ' ';
      word.push(-1);
      pos.push(0);
    }
    const t = w.text.replace(/[‐-―−]/g, '-').replace(/[\r\n\t]/g, ' ');
    for (let k = 0; k < t.length; k++) {
      s += t[k];
      word.push(wi);
      pos.push(k);
    }
  });
  // "Q12. B" and "q12 B": drop the Q.
  s = s.replace(/(^|[^A-Za-z0-9])[Qq](?=\s*\d)/g, (_m, before: string) => `${before} `);
  return { s, word, pos, words, box: line.box, matched: false };
}

/** The box around characters start..end of a line, sliced out of the word boxes. */
function spanBox(lt: LineText, start: number, end: number): Box | null {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  const first = new Map<number, number>();
  const last = new Map<number, number>();
  for (let i = start; i < end; i++) {
    const wi = lt.word[i];
    if (wi < 0) continue;
    if (!first.has(wi)) first.set(wi, lt.pos[i]);
    last.set(wi, lt.pos[i]);
  }
  for (const [wi, k0] of first) {
    const w = lt.words[wi];
    const box = w.box.length === 4 ? w.box : lt.box;
    if (box.length !== 4) continue;
    const len = Math.max(1, w.text.length);
    const k1 = (last.get(wi) ?? k0) + 1;
    const width = box[2] - box[0];
    l = Math.min(l, box[0] + (width * k0) / len);
    r = Math.max(r, box[0] + (width * k1) / len);
    t = Math.min(t, box[1]);
    b = Math.max(b, box[3]);
  }
  return Number.isFinite(l) ? [l, t, r, b] : null;
}

/** The lowest confidence of the words that characters start..end came from; 1 when unknown. */
function spanConfidence(lt: LineText, start: number, end: number): number {
  let c = 1;
  for (let i = start; i < end; i++) {
    const wi = lt.word[i];
    const conf = wi >= 0 ? lt.words[wi].confidence : undefined;
    if (typeof conf === 'number' && conf > 0) c = Math.min(c, conf);
  }
  return c;
}

function toNumber(raw: string): number {
  return Number(raw.replace(/[lI|!]/g, '1').replace(/[Oo]/g, '0'));
}

function pageCandidates(page: PageIn, p: number, questionCount: number): { candidates: Candidate[]; bare: Placed[] } {
  const out: Candidate[] = [];
  const usedWords = new Set<WordIn>();
  const lines = page.lines.map(lineText);

  for (const lt of lines) {
    const mask = lt.s.split('');
    for (const pass of [STRICT, LOOSE] as const) {
      const text = mask.join('');
      pass.lastIndex = 0;
      let prevEnd = -1;
      let m: RegExpExecArray | null;
      while ((m = pass.exec(text)) !== null) {
        const [whole, open = '', numRaw, gap, letterRaw] = m;
        const numStart = m.index + open.length;
        const numEnd = numStart + numRaw.length;
        const letterStart = numEnd + gap.length;
        const letterEnd = letterStart + letterRaw.length;
        const end = m.index + whole.length;
        const strictPass = pass === STRICT;

        const reject = () => {
          pass.lastIndex = m!.index + 1; // look again from the next character
        };
        // Part of a longer number ("1234. B"): not an answer.
        const before = numStart > 0 ? text[numStart - 1] : '';
        if (/[0-9]/.test(before) || (!strictPass && /[|!lI]/.test(before))) {
          reject();
          continue;
        }
        // A number straight after a letter is only an answer when it follows the last answer ("1.A2.B").
        if (/[A-Za-z]/.test(before) && numStart !== prevEnd) {
          reject();
          continue;
        }
        if (HEADER.test(text.slice(0, numStart))) {
          reject();
          continue;
        }
        // Lookalikes need something between the number and the letter: "1. 8" but not "18".
        if (!strictPass && gap.length === 0) {
          reject();
          continue;
        }

        const q = strictPass ? Number(numRaw) : toNumber(numRaw);
        if (!Number.isInteger(q) || q < 1 || q > questionCount) {
          reject();
          continue;
        }

        let chosen: Letter | 'several';
        let strict = strictPass;
        let why: Why | undefined;
        let matchEnd = letterEnd;
        if (strictPass) {
          const letters = letterRaw.toUpperCase().split(/[^A-E]+/).filter(Boolean);
          // "12. B A": a second letter on its own straight after the answer (a crossed-out letter
          // and a new one) makes it two answers. "12. B a gas" is option text, so it is not.
          const extra = SECOND_LETTER.exec(text.slice(end));
          if (extra) {
            letters.push(extra[1].toUpperCase());
            matchEnd = end + extra[0].length;
          }
          chosen = new Set(letters).size > 1 ? 'several' : (letters[0] as Letter);
        } else {
          const plain = /^[A-Ea-e]$/.test(letterRaw);
          const mapped = plain ? (letterRaw.toUpperCase() as Letter) : LOOKALIKE[letterRaw];
          if (!mapped) {
            reject();
            continue;
          }
          chosen = mapped;
          strict = false;
          why = 'lookalike';
        }

        const box = spanBox(lt, numStart, letterEnd);
        const numBox = spanBox(lt, numStart, numEnd);
        if (!box || !numBox) {
          reject();
          continue;
        }
        const confident = spanConfidence(lt, numStart, letterEnd) >= MIN_CONFIDENCE;
        if (strict && !confident) why = 'faint';

        out.push({
          q,
          chosen,
          strict,
          sure: strict && confident,
          why,
          page: p,
          box,
          numLeft: numBox[0],
          cy: (box[1] + box[3]) / 2,
          h: Math.max(1, box[3] - box[1]),
          inOrder: true,
      anchored: false,
        });
        for (let i = numStart; i < matchEnd; i++) {
          if (lt.word[i] >= 0) usedWords.add(lt.words[lt.word[i]]);
          mask[i] = '~';
        }
        lt.matched = true;
        prevEnd = Math.max(end, matchEnd);
        if (matchEnd > end) pass.lastIndex = matchEnd;
      }
    }
  }

  // Answers written as a table, with the numbers and the letters far apart, come back as separate
  // lines: pair each number left on its own with the nearest single letter to its right. Only
  // lines with no answers in them take part, so a stray letter beside an answer is never used.
  const loneNumbers: { q: number; box: Box; conf: number; word: WordIn }[] = [];
  const loneLetters: { letter: Letter; box: Box; conf: number; taken: boolean; word: WordIn }[] = [];
  for (const lt of lines) {
    if (lt.matched || HEADER.test(lt.s)) continue;
    for (const w of lt.words) {
      if (usedWords.has(w) || w.box.length !== 4) continue;
      const box = w.box as Box;
      const conf = typeof w.confidence === 'number' && w.confidence > 0 ? w.confidence : 1;
      const n = LONE_NUMBER.exec(w.text.trim());
      if (n) {
        const q = Number(n[1]);
        if (q >= 1 && q <= questionCount) loneNumbers.push({ q, box, conf, word: w });
        continue;
      }
      const l = LONE_LETTER.exec(w.text.trim());
      if (l) loneLetters.push({ letter: l[1].toUpperCase() as Letter, box, conf, taken: false, word: w });
    }
  }
  for (const n of loneNumbers) {
    const h = n.box[3] - n.box[1];
    const cy = (n.box[1] + n.box[3]) / 2;
    let best: (typeof loneLetters)[number] | null = null;
    let bestGap = Infinity;
    for (const l of loneLetters) {
      if (l.taken) continue;
      const lcy = (l.box[1] + l.box[3]) / 2;
      const gap = l.box[0] - n.box[2];
      if (gap < -h * 0.2 || gap > page.width * 0.3) continue;
      if (Math.abs(lcy - cy) > Math.max(h, l.box[3] - l.box[1]) * 0.6) continue;
      if (gap < bestGap) {
        best = l;
        bestGap = gap;
      }
    }
    if (!best) continue;
    best.taken = true;
    usedWords.add(n.word);
    usedWords.add(best.word);
    const box: Box = [n.box[0], Math.min(n.box[1], best.box[1]), best.box[2], Math.max(n.box[3], best.box[3])];
    const confident = Math.min(n.conf, best.conf) >= MIN_CONFIDENCE;
    out.push({
      q: n.q,
      chosen: best.letter,
      strict: true,
      sure: confident,
      why: confident ? undefined : 'faint',
      page: p,
      box,
      numLeft: n.box[0],
      cy: (box[1] + box[3]) / 2,
      h: Math.max(1, box[3] - box[1]),
      inOrder: true,
      anchored: false,
    });
  }

  // Numbers left with nothing beside them ("14." for a question the student skipped).
  const bare: Placed[] = [];
  for (const lt of lines) {
    lt.words.forEach((w, wi) => {
      if (usedWords.has(w) || w.box.length !== 4) return;
      const n = LONE_NUMBER.exec(w.text.trim());
      if (!n) return;
      const q = Number(n[1]);
      if (q < 1 || q > questionCount) return;
      const at = lt.word.indexOf(wi);
      if (HEADER.test(lt.s.slice(0, Math.max(0, at)))) return;
      bare.push({ q, page: p, numLeft: w.box[0], cy: (w.box[1] + w.box[3]) / 2, h: Math.max(1, w.box[3] - w.box[1]), sure: false, inOrder: true, anchored: false });
    });
  }
  return { candidates: out, bare };
}

/**
 * Numbers on a script run in order, down each column or along each line. Answers whose number
 * breaks that order (often a misread number, such as 18 for 13) are marked for checking.
 * Both reading orders are tried and the one that explains more answers is used.
 */
function markOrder(candidates: Placed[], pages: PageIn[]) {
  if (candidates.length < 3) return;
  const columns: Placed[] = [];
  const rows: Placed[] = [];
  pages.forEach((page, p) => {
    const onPage = candidates.filter((c) => c.page === p);
    if (onPage.length === 0) return;

    // Down the columns: group by where the numbers start.
    const byX = [...onPage].sort((a, b) => a.numLeft - b.numLeft);
    const groups: Placed[][] = [];
    let start = -Infinity;
    for (const c of byX) {
      if (c.numLeft - start > page.width * 0.08 || groups.length === 0) {
        groups.push([]);
        start = c.numLeft;
      }
      groups[groups.length - 1].push(c);
    }
    for (const g of groups) columns.push(...g.sort((a, b) => a.cy - b.cy));

    // Along the lines: group by height on the page.
    const heights = onPage.map((c) => c.h).sort((a, b) => a - b);
    const lineHeight = heights[Math.floor(heights.length / 2)];
    const byY = [...onPage].sort((a, b) => a.cy - b.cy);
    let row: Placed[] = [];
    let rowTop = -Infinity;
    for (const c of byY) {
      if (c.cy - rowTop > lineHeight * 0.7) {
        rows.push(...row.sort((a, b) => a.numLeft - b.numLeft));
        row = [];
        rowTop = c.cy;
      }
      row.push(c);
    }
    rows.push(...row.sort((a, b) => a.numLeft - b.numLeft));
  });

  // Score each reading order by how many numbers sit in order between their neighbours.
  const score = (order: Placed[]) => {
    const keep = longestIncreasing(order);
    const anchored = new Set<Placed>();
    order.forEach((c, i) => {
      const before = order[i - 1];
      const after = order[i + 1];
      const ordered = (!before || before.q < c.q) && (!after || c.q < after.q);
      // At least one neighbour is the next number up or down, so the number itself is not a misread
      // one that happens to fit (13 read as 18 between 12 and 20 would fit, but not between 17 and 19).
      const next = (before?.q === c.q - 1) || (after?.q === c.q + 1);
      if (keep.has(c) && ordered && next) anchored.add(c);
    });
    return { keep, anchored };
  };
  const byColumns = score(columns);
  const byRows = score(rows);
  const useRows =
    byRows.anchored.size > byColumns.anchored.size ||
    (byRows.anchored.size === byColumns.anchored.size && byRows.keep.size >= byColumns.keep.size);
  const { keep, anchored } = useRows ? byRows : byColumns;
  for (const c of candidates) c.anchored = anchored.has(c);
  for (const c of candidates) {
    c.inOrder = keep.has(c);
    if (c.sure && !(c.inOrder && c.anchored)) {
      c.sure = false;
      c.why = 'out-of-order';
    }
  }
}

/** The longest run of candidates, in the given order, whose question numbers keep going up. */
function longestIncreasing(seq: Placed[]): Set<Placed> {
  const tails: number[] = []; // index into seq of the last item of the best run of each length
  const prev: number[] = new Array(seq.length).fill(-1);
  for (let i = 0; i < seq.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (seq[tails[mid]].q < seq[i].q) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const out = new Set<Placed>();
  let k = tails.length ? tails[tails.length - 1] : -1;
  while (k >= 0) {
    out.add(seq[k]);
    k = prev[k];
  }
  return out;
}
