// Checks the handwriting reader (src/lib/handwriting/parse.ts) on text laid out the way
// ML Kit returns it for answer scripts: lines with word boxes and confidence.
// Run: deno test --sloppy-imports tools/test/handwriting_test.ts
import { findAnswers, type LineIn, type PageIn } from "../../src/lib/handwriting/parse.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error("FAILED: " + m); }

const W = 1200, H = 1700, CW = 18, LH = 34;

/** One line of writing starting at x, y. Words are split on spaces; conf sets each word's confidence. */
function line(text: string, x: number, y: number, conf: number | number[] = 0.9): LineIn {
  const words = [];
  let pos = 0;
  let i = 0;
  for (const part of text.split(/( +)/)) {
    if (part.trim()) {
      const c = Array.isArray(conf) ? conf[i] ?? 0.9 : conf;
      words.push({ text: part, box: [x + pos * CW, y, x + (pos + part.length) * CW, y + LH], confidence: c });
      i++;
    }
    pos += part.length;
  }
  return { text, box: [x, y, x + text.length * CW, y + LH], confidence: 0.9, words };
}

const page = (lines: LineIn[]): PageIn => ({ width: W, height: H, lines });
const column = (entries: string[], x: number, y0 = 200) => entries.map((t, i) => line(t, x, y0 + i * 60));

/** "1:A 2:B ..." with ? for answers to check and _ for none. */
function summary(pages: PageIn[], n: number, options: 4 | 5 = 4) {
  return findAnswers(pages, n, options).answers.map((a) => `${a.q}:${a.chosen === null ? "_" : a.chosen === "several" ? "*" : a.chosen}${a.clear ? "" : "?"}`).join(" ");
}

Deno.test("one column, many ways of writing", () => {
  const p = page(column(["1. A", "2) b", "3-C", "4D", "(5) B", "Q6. A", "7.(c)", "8 . d", "9: e", "10 B"], 120));
  const s = summary([p], 10, 5);
  assert(s === "1:A 2:B 3:C 4:D 5:B 6:A 7:C 8:D 9:E 10:B", s);
});

Deno.test("the name, class and date are not answers", () => {
  const p = page([
    line("Name: Ada Obi", 100, 60), line("Class: JSS 2A", 100, 110), line("Subject: Basic Science", 600, 110), line("26/11/2026", 900, 60),
    ...column(["1. B", "2. C", "3. A", "4. D"], 120),
  ]);
  const s = summary([p], 4);
  assert(s === "1:B 2:C 3:A 4:D", s);
});

Deno.test("two columns, read as separate lines or as one line across", () => {
  const left = ["1. A", "2. B", "3. C", "4. D", "5. A"], right = ["6. B", "7. C", "8. D", "9. A", "10. B"];
  const expected = "1:A 2:B 3:C 4:D 5:A 6:B 7:C 8:D 9:A 10:B";
  const apart = page([...column(left, 120), ...column(right, 650)]);
  assert(summary([apart], 10) === expected, "separate: " + summary([apart], 10));
  const across = page(left.map((l, i) => line(`${l}${" ".repeat(26)}${right[i]}`, 120, 200 + i * 60)));
  assert(summary([across], 10) === expected, "across: " + summary([across], 10));
});

Deno.test("several answers on each line", () => {
  const p = page([line("1.A  2.B  3.C  4.D  5.A", 100, 200), line("6.b  7.c  8.d  9.a  10.b", 100, 260), line("11.A 12.B", 100, 320)]);
  const s = summary([p], 12);
  assert(s === "1:A 2:B 3:C 4:D 5:A 6:B 7:C 8:D 9:A 10:B 11:A 12:B", s);
});

Deno.test("answers written close together", () => {
  const p = page([line("1.A2.B3.C", 100, 200), line("4.D5.A", 100, 260)]);
  assert(summary([p], 5) === "1:A 2:B 3:C 4:D 5:A", summary([p], 5));
});

Deno.test("lookalikes are guessed but checked", () => {
  const p = page(column(["1. A", "2. 8", "3. (", "4. 0", "l. C"], 120));
  // l. C is a second "1" on the next line down, so it is out of order and loses to 1. A.
  const s = summary([p], 5);
  assert(s === "1:A 2:B? 3:C? 4:D? 5:_?", s);
});

Deno.test("a misread number is checked, and a missing one is asked about", () => {
  // 13 was read as 18; the real 18 comes later. 16 is missing.
  const p = page(column(["11. A", "12. B", "18. C", "14. D", "15. A", "17. C", "18. D", "19. A", "20. B"], 120));
  const all = findAnswers([p], 20, 4).answers;
  const s = all.slice(10).map((a) => `${a.q}:${a.chosen ?? "_"}${a.clear ? "" : "?" + a.why}`).join(" ");
  // 14 comes straight after the misread number, so it is checked too.
  assert(s === "11:A 12:B 13:_?not-found 14:D?out-of-order 15:A 16:_?not-found 17:C 18:D 19:A 20:B", s);
});

Deno.test("faint writing, two answers and E on an A to D exam are checked", () => {
  const p = page([line("1. A", 120, 200, [0.9, 0.3]), line("2. A/B", 120, 260), line("3. C", 120, 320), line("4. E", 120, 380), line("5. B  5. D", 120, 440), line("6. C", 120, 500)]);
  const a = findAnswers([p], 6, 4).answers;
  const s = a.map((x) => `${x.q}:${x.chosen ?? "_"}${x.clear ? "" : "?" + x.why}`).join(" ");
  // For two answers side by side, the later one is offered first (often the one written after crossing out).
  assert(s === "1:A?faint 2:several?two-answers 3:C 4:_?not-an-option 5:D?two-answers 6:C", s);
});

Deno.test("a table with numbers and letters far apart", () => {
  const p = page([...column(["1", "2", "3", "4"], 120), ...column(["C", "A", "D", "B"], 420)]);
  assert(summary([p], 4) === "1:C 2:A 3:D 4:B", summary([p], 4));
});

Deno.test("two pages", () => {
  const p1 = page(column(["1. A", "2. B", "3. C"], 120));
  const p2 = page(column(["4. D", "5. A", "6. B"], 120));
  const r = findAnswers([p1, p2], 6, 4);
  assert(r.answers.map((a) => a.chosen).join("") === "ABCDAB" && r.clear === 6, JSON.stringify(r.answers));
  assert(r.answers[4].where?.page === 1 && Math.abs(r.answers[4].where.y - 260 / H) < 0.01, "where is on page 2");
});

Deno.test("option words after the letter, and a skipped question", () => {
  const p = page(column(["4. C a form of energy", "5. B oxygen", "6.", "7. D"], 120));
  const s = summary([p], 7).split(" ").slice(3).join(" ");
  assert(s === "4:C 5:B 6:_? 7:D", s);
  const q = page([line("12. 13. C", 120, 200)]);
  assert(summary([q], 13).endsWith("12:_? 13:C"), summary([q], 13));
});

Deno.test("words that only look like answers are ignored", () => {
  const p = page([line("Ade 1st term 2026", 100, 100), line("Bead Dec 12 Cab", 100, 160), line("1. A", 120, 260)]);
  assert(summary([p], 2) === "1:A 2:_?", summary([p], 2));
});

Deno.test("a photo with no answers finds nothing", () => {
  const r = findAnswers([page([line("The quick brown fox", 100, 100)])], 10, 4);
  assert(r.found === 0 && r.clear === 0, JSON.stringify(r));
});

// Many made-up scripts with the mistakes text readers make on handwriting. The rule that matters:
// an answer Skora calls clear must be what the student wrote. Everything else can be checked.
Deno.test("made-up scripts: no clear answer is ever wrong", () => {
  let seed = 7;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const LOOK: Record<string, string> = { A: "4", B: "8", C: "(", D: "0", E: "€" };
  let clear = 0, total = 0, wrong: string[] = [];
  for (let script = 0; script < 400; script++) {
    const n = 10 + Math.floor(rand() * 91);
    const options = rand() < 0.5 ? 4 : 5;
    const letters = "ABCDE".slice(0, options);
    const truth = Array.from({ length: n }, () => (rand() < 0.04 ? null : pick([...letters])));
    const texts: { text: string; conf: number }[] = truth.map((t, i) => {
      let num = String(i + 1);
      if (rand() < 0.04) num = num.replace(/\d(?!.*\d)/, String(Math.floor(rand() * 10))); // last digit misread
      if (t === null) return { text: `${num}.`, conf: 0.9 };
      let letter: string = rand() < 0.3 ? t.toLowerCase() : t;
      if (rand() < 0.05) letter = LOOK[t];
      if (rand() < 0.02) letter = `${letter} ${pick([...letters])}`; // crossed out and written again
      const sep = pick([". ", ".", ") ", "-", " ", ": ", "."]);
      return { text: `${num}${sep}${letter}`, conf: rand() < 0.05 ? 0.3 : 0.9 };
    });
    const lines: LineIn[] = [line("Name: Chidi Okeke", 100, 40), line(`Class: SS ${1 + Math.floor(rand() * 3)}${pick(["A", "B", "C"])}`, 100, 90)];
    const perPage = 34;
    const pages: PageIn[] = [];
    const layout = pick(["columns", "rows"]);
    if (layout === "columns") {
      const cols = n > 60 ? 3 : 2;
      const rowsPerCol = Math.ceil(n / cols);
      for (let pg = 0; pg * perPage < rowsPerCol; pg++) {
        const ls: LineIn[] = pg === 0 ? [...lines] : [];
        for (let c = 0; c < cols; c++) {
          for (let r = pg * perPage; r < Math.min(rowsPerCol, (pg + 1) * perPage); r++) {
            const i = c * rowsPerCol + r;
            if (i >= n) continue;
            const x = 100 + c * 380 + Math.floor(rand() * 30);
            const y = 160 + (r - pg * perPage) * 44 + Math.floor(rand() * 8);
            ls.push(line(texts[i].text, x, y, texts[i].conf));
          }
        }
        pages.push(page(ls));
      }
    } else {
      const perLine = 5;
      const ls: LineIn[] = [...lines];
      for (let i = 0; i < n; i += perLine) {
        const chunk = texts.slice(i, i + perLine);
        const text = chunk.map((t) => t.text).join("   ");
        ls.push(line(text, 90 + Math.floor(rand() * 20), 160 + (i / perLine) * 52, chunk.flatMap((t) => t.text.split(/ +/).map(() => t.conf))));
      }
      pages.push(page(ls));
    }
    const read = findAnswers(pages, n, options as 4 | 5).answers;
    read.forEach((a, i) => {
      total++;
      if (!a.clear) return;
      clear++;
      if (a.chosen !== truth[i]) wrong.push(`script ${script} (${layout}) q${a.q}: read ${a.chosen}, wrote ${truth[i]} [${texts[i].text}]`);
    });
  }
  console.log(`clear without checking: ${clear} of ${total} answers (${Math.round((clear / total) * 100)}%)`);
  assert(wrong.length === 0, `${wrong.length} wrong but clear:\n${wrong.slice(0, 15).join("\n")}`);
});

import { handwrittenAnswers, omrAnswers } from "../../src/lib/scan/answers.ts";
import type { PhoneAnswer } from "../../src/lib/handwriting/parse.ts";

Deno.test("phone and Gemini together, as the result screen shows them", () => {
  const phone: PhoneAnswer[] = [
    { q: 1, chosen: "A", clear: true },
    { q: 2, chosen: null, clear: false, why: "not-found" },
    { q: 3, chosen: "B", clear: false, why: "lookalike" },
    { q: 4, chosen: "C", clear: false, why: "out-of-order" },
    { q: 5, chosen: "D", clear: true },
  ];
  const show = (xs: ReturnType<typeof handwrittenAnswers>) => xs.map((a, i) => `${i + 1}:${a.chosen ?? "_"}${a.unsure ? "?" : ""}:${a.source}`).join(" ");
  const both = handwrittenAnswers(phone, [{ q: 1, chosen: "A" }, { q: 2, chosen: "C" }, { q: 3, chosen: "B" }, { q: 4, chosen: "A" }, { q: 5, chosen: "B" }], 5);
  assert(show(both) === "1:A:mlkit 2:C:gemini 3:B:gemini 4:A:gemini 5:D?:mlkit", show(both));
  assert(both[4].note === "The phone read D, Gemini read B.", String(both[4].note));
  const alone = handwrittenAnswers(phone, null, 5);
  assert(show(alone) === "1:A:mlkit 2:_?:mlkit 3:B?:mlkit 4:_?:mlkit 5:D:mlkit", show(alone));
  assert(alone[3].note === "The number may be misread." && alone[1].note?.startsWith("Skora could not find"), JSON.stringify(alone));
  const stuck = handwrittenAnswers(phone, [{ q: 2, chosen: "unclear" }], 5);
  assert(stuck[1].chosen === null && stuck[1].unsure && stuck[1].note!.endsWith("Gemini could not read it either."), JSON.stringify(stuck[1]));
});

Deno.test("Skora sheet answers", () => {
  const a = omrAnswers("Ab#-", 5);
  assert(a.map((x) => `${x.chosen}${x.unsure ? "?" : ""}`).join(" ") === "A B? several? blank blank", JSON.stringify(a));
});

import { boxFields, writtenFields } from "../../src/lib/handwriting/parse.ts";

Deno.test("name, class and subject at the top of a script", () => {
  const p = page([
    line("NAME: Okafor Ada  CLASS: JSS 2A", 100, 60),
    line("Subject : Basic Science", 100, 110),
    line("Date: 26/11/2026", 700, 110),
    ...column(["1. B", "2. C"], 120, 300),
  ]);
  const f = writtenFields(p);
  assert(f.name === "Okafor Ada" && f.className === "JSS 2A" && f.subject === "Basic Science", JSON.stringify(f));
  const g = writtenFields(page([line("Name.........Chidi Eze........", 100, 60), ...column(["1. A"], 120, 300)]));
  assert(g.name === "Chidi Eze" && g.className === undefined, JSON.stringify(g));
  assert(JSON.stringify(writtenFields(page(column(["1. A", "2. B"], 120, 300)))) === "{}", "no header");
});

Deno.test("name, class and subject boxes of a Skora sheet", () => {
  const rows = [{ key: "name" as const, top: 24, bottom: 110 }, { key: "className" as const, top: 134, bottom: 212 }, { key: "subject" as const, top: 236, bottom: 314 }];
  const p = { width: 934, height: 338, lines: [line("FULL NAME", 10, 30), line("Bello Aisha", 120, 60), line("CLASS", 10, 140), line("SS 1", 100, 165), line("SUBJECT", 10, 240)] };
  const f = boxFields(p, rows);
  assert(f.name === "Bello Aisha" && f.className === "SS 1" && f.subject === undefined, JSON.stringify(f));
});
