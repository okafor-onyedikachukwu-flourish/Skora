// Checks the printed answer sheet: no code on it, the markers in place, one bubble per question and option.
// Run: deno test --sloppy-imports tools/test/sheet_test.ts
import { pageSvg, sheetsHtml } from "../../src/lib/sheet/render.ts";
import { gridShape, pageCount } from "../../src/lib/sheet/layout.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error("FAILED: " + m); }
const exam = { title: "First Term <Exam> & Test", questionCount: 100, optionCount: 5, totalMarks: 100, classNames: "SS2A, SS2B", schoolName: "CSS Nnewi", teacherName: "Mrs Okafor" };

Deno.test("one page for every Skora exam", () => {
  assert(gridShape(4).perPage === 125 && gridShape(5).perPage === 100, "capacity");
  for (const o of [4, 5]) for (let q = 1; q <= 100; q++) assert(pageCount(q, o) === 1, `pages for ${q} q, ${o} options`);
});

Deno.test("sheet content", () => {
  const svg = pageSvg(exam);
  assert(!/SKR|ZLV|qr/i.test(svg), "no code on the sheet");
  assert((svg.match(/width="7" height="7" fill="#000"/g) ?? []).length === 4, "four corner squares");
  assert(svg.includes('x="19.5" y="10" width="4" height="4" fill="#000"'), "orientation square");
  assert((svg.match(/<use href="#sb-/g) ?? []).length === 100 * 5, "500 bubbles");
  for (const label of ["FULL NAME", "DATE", "CLASS", "SUBJECT"]) assert(svg.includes(`>${label}<`), label);
  assert(svg.includes("First Term &lt;Exam&gt; &amp; Test"), "title escaped");
  assert(!svg.includes("NaN") && !svg.includes("undefined"), "no broken numbers");
  const few = pageSvg({ ...exam, questionCount: 7, optionCount: 4, totalMarks: 0 });
  assert((few.match(/<use href="#sb-/g) ?? []).length === 28 && !few.includes("in all"), "7 questions, no total while key empty");
});

Deno.test("copies", () => {
  const html = sheetsHtml(exam, 3);
  assert((html.match(/class="page"/g) ?? []).length === 3, "three pages");
});
