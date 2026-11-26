// Checks how names read from scripts are matched to the class list (src/lib/nameMatch.ts).
// Run: deno test --sloppy-imports tools/test/nameMatch_test.ts
import { matchNames, matchOption, nameScore, sureMatch } from "../../src/lib/nameMatch.ts";

function assert(c: unknown, m: string) { if (!c) throw new Error("FAILED: " + m); }

const cls = [
  "Okafor Chidinma Grace", "Okafor Chidi", "Adebayo Tunde", "Bello Aisha", "Eze Chukwuemeka", "Nwosu Ifeoma",
  "Ibrahim Musa", "Okonkwo Ebuka", "Obi Ada", "Obi Adaeze",
].map((name) => ({ name, classId: 1 }));

Deno.test("names read with mistakes find the right student", () => {
  const cases: [string, string][] = [
    ["Chukwuemeka Eze", "Eze Chukwuemeka"], // other order
    ["EZE CHUKWUEMEKA", "Eze Chukwuemeka"],
    ["Eze Chukwuerneka", "Eze Chukwuemeka"], // rn read for m
    ["Bel1o Aisha", "Bello Aisha"], // 1 for l
    ["Ad3bayo Tunde", "Adebayo Tunde"],
    ["Nwosu Ifeoma .", "Nwosu Ifeoma"],
    ["IbrahimMusa", "Ibrahim Musa"], // run together
    ["Okonkwo E. Ebuka", "Okonkwo Ebuka"],
  ];
  for (const [read, want] of cases) {
    const m = sureMatch(matchNames(read, cls));
    assert(m?.name === want, `${read} -> ${m?.name} (${JSON.stringify(matchNames(read, cls))})`);
  }
});

Deno.test("close names are suggested, not filled in", () => {
  // "Obi Ad" could be "Obi Ada" or "Obi Adaeze": too close to choose alone.
  for (const read of ["Obi Ad", "Obi Adae"]) {
    const m = matchNames(read, cls);
    assert(m.length >= 2 && sureMatch(m) === null, `${read}: ${JSON.stringify(m)}`);
  }
  assert(sureMatch(matchNames("Obi Adaeze", cls))?.name === "Obi Adaeze", "exact wins");
});

Deno.test("names not in the class are not matched", () => {
  for (const read of ["Musa Garba", "Yusuf Sani", "xx", ""]) {
    const m = sureMatch(matchNames(read, cls));
    assert(m === null, `${read} -> ${m?.name}`);
  }
  assert(nameScore("Musa Garba", "Ibrahim Musa") < 0.86, "one shared word is not enough");
});

Deno.test("classes and subjects", () => {
  const classes = ["JSS 1A", "JSS 2A", "JSS 2B", "SS 1"];
  assert(matchOption("JSS2A", classes) === "JSS 2A", "no space");
  assert(matchOption("jss 2b", classes) === "JSS 2B", "small letters");
  assert(matchOption("JSS 3A", classes) === null, "not a class of this exam");
  const subjects = ["Mathematics", "English Language", "Basic Science"];
  assert(matchOption("Mathernatics", subjects) === "Mathematics", "misread subject");
  assert(matchOption("Civic Education", subjects) === null, "new subject");
});
