/**
 * The one way Skora turns a cut-out of handwriting into its own model's 32 × 32 input. Training
 * does exactly the same in tools/model/normalize.py; tools/test/normalize_test checks they agree.
 * Change both together, then train again.
 */

export const SIZE = 32;
const SUB = 4; // samples per output pixel along each side
const MARGIN = 1.25; // the square is this much bigger than the writing
const MIN_CONTRAST = 24;
const INK_LEVEL = 0.4;

/** A greyscale picture: one byte per pixel, row by row. */
export type GrayImage = { data: Uint8Array; width: number; height: number };

function percentile(hist: Int32Array, total: number, frac: number): number {
  const need = frac * total;
  let run = 0;
  for (let v = 0; v < 256; v++) {
    run += hist[v];
    if (run >= need) return v;
  }
  return 255;
}

/**
 * The model's input for the box (left, top, right, bottom, in pixels) of a page, written into
 * `out` at `offset` (SIZE × SIZE floats, 0 = paper, 1 = ink, the writing centred).
 */
export function normalizeInto(page: GrayImage, box: number[], out: Float32Array, offset = 0): void {
  const x0 = Math.max(0, Math.floor(box[0]));
  const y0 = Math.max(0, Math.floor(box[1]));
  const x1 = Math.min(page.width, Math.ceil(box[2]));
  const y1 = Math.min(page.height, Math.ceil(box[3]));
  out.fill(0, offset, offset + SIZE * SIZE);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w < 2 || h < 2) return;

  const hist = new Int32Array(256);
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * page.width + x0;
    for (let x = 0; x < w; x++) hist[page.data[row + x]]++;
  }
  const paper = percentile(hist, w * h, 0.9);
  const ink = percentile(hist, w * h, 0.02);
  if (paper - ink < MIN_CONTRAST) return;

  const t = new Float64Array(w * h);
  const range = paper - ink;
  for (let y = 0; y < h; y++) {
    const row = (y0 + y) * page.width + x0;
    let inked = 0;
    let sum = 0;
    for (let x = 0; x < w; x++) {
      let v = (paper - page.data[row + x]) / range;
      v = v < 0 ? 0 : v > 1 ? 1 : v;
      t[y * w + x] = v;
      sum += v;
      if (v >= INK_LEVEL) inked++;
    }
    // A rule line (most of a row inked, but lighter than the writing) is not part of the
    // character: drop it, so the letter, not the line, is centred. Crossings-out stay.
    if (w >= 12 && inked >= 0.75 * w && sum / w < 0.75) t.fill(0, y * w, (y + 1) * w);
  }
  let bx0 = w;
  let by0 = h;
  let bx1 = -1;
  let by1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (t[y * w + x] >= INK_LEVEL) {
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
    }
  }
  if (bx1 < 0) return;

  const side = Math.max(bx1 - bx0 + 1, by1 - by0 + 1) * MARGIN;
  const left = (bx0 + bx1 + 1) / 2 - side / 2;
  const top = (by0 + by1 + 1) / 2 - side / 2;
  const n = SIZE * SUB;
  const step = side / n;
  const px = new Int32Array(n);
  const py = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    px[k] = Math.floor(left + (k + 0.5) * step);
    py[k] = Math.floor(top + (k + 0.5) * step);
  }
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      let sum = 0;
      for (let b = 0; b < SUB; b++) {
        const y = py[j * SUB + b];
        if (y < 0 || y >= h) continue;
        for (let a = 0; a < SUB; a++) {
          const x = px[i * SUB + a];
          if (x >= 0 && x < w) sum += t[y * w + x];
        }
      }
      out[offset + j * SIZE + i] = sum / (SUB * SUB);
    }
  }
}
