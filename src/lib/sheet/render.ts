import { GRID, MARKERS, OPTION_LETTERS, ORIENTATION, PAGE, WRITE_BOXES, bubbleCentre, gridShape, rowPosition } from './layout';

export type SheetExam = {
  title: string;
  questionCount: number;
  optionCount: number;
  /** Sum of the key's marks, or 0 while the key is empty (then left off the sheet). */
  totalMarks: number;
  /** The classes that write the paper, e.g. "SS2A, SS2B". */
  classNames: string;
  schoolName: string;
  teacherName: string;
};

const FONT = "Roboto, 'Helvetica Neue', Arial, sans-serif";
const INK = '#111827';
const MUTED = '#4B5563';
const FAINT = '#9CA3AF';

/** Complete HTML for printing: `copies` identical A4 pages, each drawn as an SVG in millimetres. */
export function sheetsHtml(exam: SheetExam, copies = 1): string {
  const page = pageSvg(exam, false);
  // Bubble shapes are defined once and reused, which keeps a big batch small.
  const defs = `<svg width="0" height="0" style="position:absolute">${bubbleDefs(exam.optionCount)}</svg>`;
  const pages = Array.from({ length: Math.max(1, copies) }, () => `<div class="page">${page}</div>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: A4; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .page { width: 210mm; height: 297mm; overflow: hidden; page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  svg { display: block; width: 210mm; height: 297mm; }
</style></head>
<body>${defs}${pages}</body></html>`;
}

/** The answer sheet as an SVG whose units are millimetres. Exported for previews and tests. */
export function pageSvg(exam: SheetExam, standalone = true): string {
  const out: string[] = [];
  if (standalone) out.push(bubbleDefs(exam.optionCount));
  const shape = gridShape(exam.optionCount);
  const count = Math.min(exam.questionCount, shape.perPage);

  // Corner squares, and the orientation square beside the top-left one.
  const h = MARKERS.size / 2;
  for (const [cx, cy] of MARKERS.centres) {
    out.push(`<rect x="${n(cx - h)}" y="${n(cy - h)}" width="${MARKERS.size}" height="${MARKERS.size}" fill="#000"/>`);
  }
  out.push(`<rect x="${ORIENTATION.x}" y="${ORIENTATION.y}" width="${ORIENTATION.size}" height="${ORIENTATION.size}" fill="#000"/>`);

  // Header.
  const letters = OPTION_LETTERS.slice(0, exam.optionCount);
  const by = [exam.schoolName, exam.teacherName].map((t) => t.trim()).filter(Boolean).join('  ·  ');
  const marks = `${exam.questionCount} ${exam.questionCount === 1 ? 'question' : 'questions'}  ·  options ${letters[0]}–${letters[letters.length - 1]}${
    exam.totalMarks > 0 ? `  ·  ${formatMark(exam.totalMarks)} in all` : ''
  }`;
  out.push(text(27, 14.6, clip(`SKORA ANSWER SHEET${by ? `  ·  ${by}` : ''}`, 90), 2.7, MUTED, 'bold', 'start', 0.25));
  out.push(text(20, 25, clip(exam.title, 60), 5.6, INK, 'bold'));
  out.push(text(20, 32.5, clip(exam.classNames, 90), 3.6, INK));
  out.push(text(20, 39, marks, 3.1, MUTED));

  // Boxes for the student to write in.
  const { name, date, className, subject } = WRITE_BOXES;
  for (const [b, label] of [
    [name, 'FULL NAME'],
    [date, 'DATE'],
    [className, 'CLASS'],
    [subject, 'SUBJECT'],
  ] as const) {
    out.push(box(b.x, b.y, b.w, b.h));
    out.push(text(b.x + 2, b.y + 3.6, label, 2.4, MUTED, 'bold', 'start', 0.2));
  }

  // Instructions, with a drawn example of a correctly shaded bubble.
  out.push(`<circle cx="22.3" cy="83" r="${GRID.bubbleDiameter / 2}" fill="#111"/>`);
  out.push(text(27, 84, 'Shade ONE bubble fully for each question, like this. Use a dark pencil or pen.', 3, INK));
  out.push(text(27, 89, 'To change an answer, rub it out completely. Keep the black squares clean.', 3, MUTED));

  // Answer grid.
  for (let c = 0; c < shape.columns; c++) {
    const firstIndex = c * GRID.rowsPerColumn;
    if (firstIndex >= count) break;
    letters.forEach((l, o) => {
      const { x } = bubbleCentre(firstIndex, o, shape);
      out.push(text(x, GRID.top - 1.6, l, 2.8, MUTED, 'bold', 'middle'));
    });
  }
  for (let i = 0; i < count; i++) {
    const { x, centreY, row } = rowPosition(i, shape);
    if (Math.floor(row / GRID.rowsPerBlock) % 2 === 1 && row % GRID.rowsPerBlock === 0) {
      // Light band behind every other block of five rows, to help students keep their place.
      const rows = Math.min(GRID.rowsPerBlock, count - i);
      const top = centreY - GRID.rowHeight / 2 - 0.4;
      out.push(
        `<rect x="${n(x - 0.8)}" y="${n(top)}" width="${n(shape.columnWidth - GRID.columnGap + 1.6)}" height="${n(rows * GRID.rowHeight + 0.8)}" rx="1" fill="#F3F4F6"/>`,
      );
    }
    out.push(text(x + GRID.numberWidth - 1.4, centreY + 1.05, String(i + 1), 3, INK, 'bold', 'end'));
    letters.forEach((l, o) => {
      const c = bubbleCentre(i, o, shape);
      out.push(`<use href="#sb-${l}" x="${n(c.x)}" y="${n(c.y)}"/>`);
    });
  }

  // Footer.
  out.push(text(20, 277.5, 'Skora  ·  layout 1', 2.4, FAINT));

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PAGE.width} ${PAGE.height}" width="210mm" height="297mm" font-family="${FONT}"><rect width="${PAGE.width}" height="${PAGE.height}" fill="#fff"/>${out.join('')}</svg>`;
}

/** An empty bubble with its letter, centred on (0, 0). */
function bubbleDefs(optionCount: number): string {
  const r = GRID.bubbleDiameter / 2;
  const shapes = OPTION_LETTERS.slice(0, optionCount).map(
    (l) =>
      `<g id="sb-${l}"><circle r="${r}" fill="#fff" stroke="#374151" stroke-width="0.25"/>` +
      `<text y="0.78" font-size="2.2" fill="${FAINT}" text-anchor="middle" font-family="${FONT}">${l}</text></g>`,
  );
  return `<defs>${shapes.join('')}</defs>`;
}

function box(x: number, y: number, w: number, h: number, fill = '#fff') {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.2" fill="${fill}" stroke="#6B7280" stroke-width="0.3"/>`;
}

function text(
  x: number,
  y: number,
  value: string,
  size: number,
  color: string,
  weight: 'normal' | 'bold' = 'normal',
  anchor: 'start' | 'middle' | 'end' = 'start',
  spacing = 0,
) {
  return `<text x="${n(x)}" y="${n(y)}" font-size="${size}" fill="${color}" font-weight="${weight}" text-anchor="${anchor}"${
    spacing ? ` letter-spacing="${spacing}"` : ''
  }>${escapeXml(value)}</text>`;
}

function n(v: number) {
  return Math.round(v * 100) / 100;
}

function clip(s: string, max: number) {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function escapeXml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
}

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${d} ${months[m - 1]} ${y}`;
}

export function formatMark(mark: number): string {
  const v = Math.round(mark * 100) / 100;
  return `${v} ${v === 1 ? 'mark' : 'marks'}`;
}
