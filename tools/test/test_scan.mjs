// Runs Skora's on-phone sheet reader (the real TypeScript) against test photos.
// Run: node tools/test/test_scan.mjs <manifest.json> <questions> <options>
const ROOT = new URL('../../', import.meta.url).pathname;
import fs from 'fs';
const ts = (await import(ROOT + 'node_modules/typescript/lib/typescript.js')).default;
const jpeg = (await import(ROOT + 'node_modules/jpeg-js/index.js')).default;
const out = '/tmp/skora-scan';
fs.mkdirSync(out, { recursive: true });
const files = { layout: 'sheet/layout', geometry: 'scan/geometry', markers: 'scan/markers', read: 'scan/read' };
for (const [name, rel] of Object.entries(files)) {
  let js = ts.transpileModule(fs.readFileSync(`${ROOT}src/lib/${rel}.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  js = js
    .replace("from '../sheet/layout'", "from './layout.mjs'")
    .replace("from './geometry'", "from './geometry.mjs'")
    .replace("from './markers'", "from './markers.mjs'");
  fs.writeFileSync(`${out}/${name}.mjs`, js);
}
const { rgbaToGray } = await import(`${out}/geometry.mjs`);
const { readSheet } = await import(`${out}/read.mjs`);
const [manifestPath, qCount, opts] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
let bad = 0;
for (const m of manifest) {
  const t0 = Date.now();
  const img = jpeg.decode(fs.readFileSync(m.file), { useTArray: true });
  const g = rgbaToGray(img.data, img.width, img.height);
  const t1 = Date.now();
  const r = readSheet(g, { questionCount: Number(qCount), optionCount: Number(opts) });
  const t2 = Date.now();
  if (!r.ok) {
    bad++;
    console.log(m.case.padEnd(14), 'FAILED', r.reason);
    continue;
  }
  let wrong = 0, check = 0;
  const notes = [];
  for (let i = 0; i < m.truth.length; i++) {
    const t = m.truth[i], a = r.answers[i];
    if (a === t) continue;
    if (a >= 'a' && a <= 'e') { check++; if (a.toUpperCase() !== t) notes.push(`q${i + 1} ${t}->${a}`); continue; }
    wrong++; notes.push(`q${i + 1} ${t}->${a}`);
  }
  if (wrong) bad++;
  console.log(m.case.padEnd(14), `${img.width}x${img.height}`, `wrong=${wrong} toCheck=${check}`, `read ${t2 - t1}ms`, notes.slice(0, 6).join(' '));
}
console.log(bad ? `${bad} problem photos` : 'all photos read correctly');
process.exit(bad ? 1 : 0);
