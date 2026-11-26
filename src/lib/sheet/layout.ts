/**
 * Skora answer sheet, layout version 1.
 *
 * Everything is measured in millimetres on an A4 page (210 × 297), origin at the top-left.
 * The scanner uses the same numbers: it finds the four corner squares, uses the small orientation
 * square to tell which way up the page is, maps the photo onto this page, then checks each bubble.
 * There is no code on the sheet: the teacher picks the exam before scanning.
 * Changing any number here means making a new layout version, so printed sheets keep working.
 */
export const LAYOUT_VERSION = 1;

export const PAGE = { width: 210, height: 297 };

/** Solid black squares used to find and straighten the page. Centres listed TL, TR, BL, BR. */
export const MARKERS = {
  size: 7,
  centres: [
    [12, 12],
    [198, 12],
    [12, 285],
    [198, 285],
  ] as const,
};

/** A smaller solid square just right of the top-left marker, only there, so the page can't be read upside down. */
export const ORIENTATION = { x: 19.5, y: 10, size: 4 };

/** Boxes the student writes in. Skora doesn't read them: the teacher types the details on Save. */
export const WRITE_BOXES = {
  name: { x: 12, y: 50, w: 118, h: 12 },
  date: { x: 134, y: 50, w: 64, h: 12 },
  className: { x: 12, y: 66, w: 70, h: 11 },
  subject: { x: 88, y: 66, w: 110, h: 11 },
};

export const GRID = {
  top: 96, // top edge of the first row
  left: 12,
  right: 198,
  rowsPerColumn: 25,
  rowsPerBlock: 5,
  rowHeight: 6.6,
  blockGap: 2.6,
  numberWidth: 9,
  bubblePitch: 6.2,
  bubbleDiameter: 4.6,
  columnGap: 4,
};

export const OPTION_LETTERS = ['A', 'B', 'C', 'D', 'E'];

export type GridShape = {
  columns: number;
  perPage: number;
  columnWidth: number;
  /** Left edge of the first column (the grid is centred). */
  startX: number;
};

export function gridShape(optionCount: number): GridShape {
  const g = GRID;
  const columnWidth = g.numberWidth + optionCount * g.bubblePitch + g.columnGap;
  const usable = g.right - g.left;
  const columns = Math.floor((usable + g.columnGap) / columnWidth);
  const gridWidth = columns * columnWidth - g.columnGap;
  return {
    columns,
    perPage: columns * g.rowsPerColumn,
    columnWidth,
    startX: g.left + (usable - gridWidth) / 2,
  };
}

/** Pages needed. A–D fits 125 questions on a page and A–E fits 100, so Skora's 100-question limit is always one page. */
export function pageCount(questionCount: number, optionCount: number): number {
  return Math.max(1, Math.ceil(questionCount / gridShape(optionCount).perPage));
}

/** Where question `index` (0-based) sits. */
export function rowPosition(index: number, shape: GridShape) {
  const g = GRID;
  const column = Math.floor(index / g.rowsPerColumn);
  const row = index % g.rowsPerColumn;
  const block = Math.floor(row / g.rowsPerBlock);
  const x = shape.startX + column * shape.columnWidth;
  const centreY = g.top + row * g.rowHeight + block * g.blockGap + g.rowHeight / 2;
  return { column, row, x, centreY };
}

/** Centre of a bubble: question index (0-based) and option index (0 = A). */
export function bubbleCentre(index: number, option: number, shape: GridShape) {
  const { x, centreY } = rowPosition(index, shape);
  return { x: x + GRID.numberWidth + option * GRID.bubblePitch + GRID.bubblePitch / 2, y: centreY };
}
