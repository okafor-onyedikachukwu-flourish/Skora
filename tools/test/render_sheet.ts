// Draws a sample Skora answer sheet as an SVG, for the scanner tests.
// Run: deno run --sloppy-imports --allow-write tools/test/render_sheet.ts <questions> <options> <out.svg>
import { pageSvg } from "../../src/lib/sheet/render.ts";

const [questions = "100", options = "4", out = "/tmp/skora-sheet/base.svg"] = Deno.args;
Deno.writeTextFileSync(out, pageSvg({
  title: "First Term Examination",
  questionCount: Number(questions),
  optionCount: Number(options),
  totalMarks: Number(questions),
  classNames: "SS1A, SS1B",
  schoolName: "Unity Secondary School, Nnewi",
  teacherName: "Mrs Okafor",
}));
console.log("wrote", out);
