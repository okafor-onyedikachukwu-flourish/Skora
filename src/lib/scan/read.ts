import { MARKERS, ORIENTATION, PAGE, bubbleCentre, gridShape } from '../sheet/layout';
import { homography, project, sample, type Gray, type Homography, type Point } from './geometry';
import { findCornerMarkers } from './markers';

/**
 * Answer characters, one per question:
 *  A–E  a confident answer
 *  a–e  Skora's best guess, but the teacher should check it (faint, partly rubbed out…)
 *  -    left blank
 *  #    more than one bubble shaded
 */
export type SheetRead = {
  answers: string;
  /** Page millimetres → photo pixels. */
  toImage: Homography;
};

export type ReadFailure = { reason: 'no-markers' } | { reason: 'no-orientation' };

export type ReadOutcome = ({ ok: true } & SheetRead) | ({ ok: false } & ReadFailure);

/** Reads a photo of a Skora answer sheet. The exam is known: the teacher picked it before scanning. */
export function readSheet(g: Gray, exam: { questionCount: number; optionCount: number }): ReadOutcome {
  const found = findCornerMarkers(g);
  if (!found) return { ok: false, reason: 'no-markers' };
  const [tl, tr, bl, br] = found;
  const pageCorners = MARKERS.centres.map(([x, y]) => [x, y] as Point);

  // The page may be upright, upside down or sideways in the photo. The small square beside the
  // top-left corner is dark only when the page is mapped the right way round.
  const turns: Point[][] = [
    [tl, tr, bl, br], // upright
    [br, bl, tr, tl], // upside down
    [tr, br, tl, bl], // top of the page on the right of the photo
    [bl, tl, br, tr], // top of the page on the left of the photo
  ];
  const scored = turns
    .map((t) => {
      const h = homography(pageCorners, t);
      return { h, score: orientationScore(g, h) };
    })
    .sort((a, b) => b.score - a.score);
  const [best, second] = scored;
  if (best.score < 0.4 || best.score - second.score < 0.2) return { ok: false, reason: 'no-orientation' };

  const count = Math.min(exam.questionCount, gridShape(exam.optionCount).perPage);
  return { ok: true, answers: classify(bubbleDarkness(g, best.h, count, exam.optionCount)), toImage: best.h };
}

/** How dark the orientation square looks for this mapping, from 0 (paper) to 1 (black). */
export function orientationScore(g: Gray, toImage: Homography): number {
  const { x, y, size } = ORIENTATION;
  const cx = x + size / 2;
  const cy = y + size / 2;
  let inside = 0;
  let n = 0;
  for (let dy = -1.2; dy <= 1.2; dy += 0.4) {
    for (let dx = -1.2; dx <= 1.2; dx += 0.4) {
      const [px, py] = project(toImage, cx + dx, cy + dy);
      inside += sample(g, px, py);
      n++;
    }
  }
  inside /= n;
  // Plain paper around it: above, below, and in the gap between it and the corner square.
  const paperPoints: Point[] = [
    [cx - 1.5, 6],
    [cx, 6],
    [cx + 1.5, 6],
    [cx - 1.5, 17.5],
    [cx, 17.5],
    [cx + 1.5, 17.5],
    [17.5, cy - 1],
    [17.5, cy + 1],
  ];
  const paper = paperPoints.map(([px, py]) => sample(g, ...project(toImage, px, py))).sort((a, b) => a - b);
  const level = Math.max(paper[Math.floor(paper.length * 0.75)], 1);
  return Math.min(1, Math.max(0, 1 - inside / level));
}

// Sample points inside a bubble (radius 1.5 mm) and on a ring of paper around it (radius 3 mm).
const INSIDE: Point[] = [];
for (let dy = -1.5; dy <= 1.5; dy += 0.375) {
  for (let dx = -1.5; dx <= 1.5; dx += 0.375) if (dx * dx + dy * dy <= 1.5 * 1.5) INSIDE.push([dx, dy]);
}
const RING: Point[] = Array.from({ length: 16 }, (_, i) => {
  const a = (i / 16) * Math.PI * 2;
  return [Math.cos(a) * 3, Math.sin(a) * 3] as Point;
});

/** How dark each bubble is, from 0 (empty paper) to 1 (black). */
export function bubbleDarkness(g: Gray, toImage: Homography, count: number, optionCount: number): number[][] {
  const shape = gridShape(optionCount);
  const out: number[][] = [];
  for (let i = 0; i < count; i++) {
    const row: number[] = [];
    for (let o = 0; o < optionCount; o++) {
      const c = bubbleCentre(i, o, shape);
      let inside = 0;
      for (const [dx, dy] of INSIDE) {
        const [px, py] = project(toImage, c.x + dx, c.y + dy);
        inside += sample(g, px, py);
      }
      inside /= INSIDE.length;
      const ring = RING.map(([dx, dy]) => {
        const [px, py] = project(toImage, c.x + dx, c.y + dy);
        return sample(g, px, py);
      }).sort((a, b) => a - b);
      const paper = Math.max(ring[Math.floor(ring.length * 0.75)], 1);
      row.push(Math.min(1, Math.max(0, 1 - inside / paper)));
    }
    out.push(row);
  }
  return out;
}

/** Turns bubble darkness into answer characters, using levels measured on this page. */
export function classify(darkness: number[][]): string {
  // The lightest bubble of a question is almost always empty; the darkest is usually the answer.
  const mins = darkness.map((r) => Math.min(...r)).sort((a, b) => a - b);
  const empty = mins[Math.floor(mins.length * 0.5)] ?? 0;
  const maxes = darkness.map((r) => Math.max(...r)).sort((a, b) => a - b);
  const filled = maxes[Math.floor(maxes.length * 0.8)] ?? 0;
  // If almost nothing is shaded on the page, fall back to fixed levels.
  const span = filled - empty >= 0.25 ? filled - empty : 0.55;
  const low = empty + span * 0.35; // below this: not shaded
  const high = empty + span * 0.6; // above this: clearly shaded

  let out = '';
  for (const row of darkness) {
    const order = row.map((d, i) => [d, i] as const).sort((a, b) => b[0] - a[0]);
    const [d1, i1] = order[0];
    const d2 = order[1]?.[0] ?? 0;
    const letter = String.fromCharCode(65 + i1);
    if (d1 < low) out += '-';
    else if (d2 >= high) out += '#';
    else if (d1 >= high && d2 < low) out += letter;
    else out += letter.toLowerCase(); // faint mark, or a second mark that isn't clear: ask the teacher
  }
  return out;
}

/** The page, straightened and cropped, at `ppm` pixels per millimetre (for checking answers on the result screen). */
export function straighten(g: Gray, toImage: Homography, ppm = 4): Gray {
  const width = Math.round(PAGE.width * ppm);
  const height = Math.round(PAGE.height * ppm);
  const data = new Uint8Array(width * height);
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      const [px, py] = project(toImage, (i + 0.5) / ppm, (j + 0.5) / ppm);
      data[j * width + i] = sample(g, px, py);
    }
  }
  return { data, width, height };
}

export const READ_HINTS: Record<ReadFailure['reason'], string> = {
  'no-markers': "Couldn't find the four black squares. Fit the whole sheet in the photo, on a plain surface, with good light.",
  'no-orientation':
    "Found the sheet, but couldn't tell which way up it is. Make sure the small square beside the top-left corner isn't covered or in shadow.",
};
