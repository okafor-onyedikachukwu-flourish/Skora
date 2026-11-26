import { handle, cleanAnswers, type Deps } from "./handler.ts";

const PUB = "sb_publishable_test123";
const photo = { mime_type: "image/jpeg", data: "A".repeat(400) };
const job = { device_id: "0123456789abcdef0123456789abcdef", question_count: 5, option_count: 4, photos: [photo] };

function assert(c: unknown, m: string) { if (!c) throw new Error("FAILED: " + m); }
function make(opts: { env?: Record<string, string>; allow?: boolean; gemini?: () => Response | Promise<Response> } = {}) {
  const calls = { take: 0, fetch: [] as { url: string; init: RequestInit }[] };
  const env = { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }), GEMINI_API_KEY: "g-key", ...opts.env };
  const deps: Deps = {
    env: (n) => (env as Record<string, string>)[n],
    takeRequest: async () => { calls.take++; return opts.allow ?? true; },
    fetch: (async (url: string, init: RequestInit) => { calls.fetch.push({ url, init }); return opts.gemini ? opts.gemini() : new Response("{}"); }) as typeof fetch,
  };
  return { deps, calls };
}
const post = (body: unknown, key: string | null = PUB) =>
  new Request("http://x/read-handwriting", { method: "POST", headers: key ? { apikey: key, "content-type": "application/json" } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });
const geminiOk = (answers: unknown, extraParts: unknown[] = []) => () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [...extraParts, { text: JSON.stringify({ answers }) }] } }] }), { status: 200 });

Deno.test("preflight and method", async () => {
  const { deps } = make();
  assert((await handle(new Request("http://x", { method: "OPTIONS" }), deps)).status === 204, "options 204");
  assert((await handle(new Request("http://x"), deps)).status === 405, "get 405");
});

Deno.test("key check", async () => {
  const { deps, calls } = make();
  assert((await handle(post(job, null), deps)).status === 401, "no key 401");
  assert((await handle(post(job, "sb_publishable_wrong"), deps)).status === 401, "wrong key 401");
  const legacy = make({ env: { SUPABASE_PUBLISHABLE_KEYS: "", SUPABASE_ANON_KEY: "legacy-anon" }, gemini: geminiOk([]) });
  assert((await handle(post(job, "legacy-anon"), legacy.deps)).status === 200, "legacy anon accepted");
  assert(calls.take === 0, "no usage counted on refused key");
});

Deno.test("body checks", async () => {
  const { deps, calls } = make();
  const bad = [
    "not json",
    { ...job, device_id: "XYZ" },
    { ...job, question_count: 0 },
    { ...job, question_count: 101 },
    { ...job, question_count: 2.5 },
    { ...job, option_count: 3 },
    { ...job, photos: [] },
    { ...job, photos: [photo, photo, photo, photo, photo] },
    { ...job, photos: Array(4).fill({ mime_type: "image/jpeg", data: "A".repeat(4_200_000) }) },
    { ...job, photos: [{ mime_type: "image/gif", data: photo.data }] },
    { ...job, photos: [{ mime_type: "image/jpeg", data: "not base64!!" + "A".repeat(200) }] },
    { ...job, photos: [{ mime_type: "image/jpeg", data: "A".repeat(6_000_000) }] },
  ];
  for (const b of bad) {
    const r = await handle(post(b), deps);
    const j = await r.json();
    assert(r.status === 400 && j.error === "bad_request", "400 for " + JSON.stringify(b).slice(0, 80));
  }
  assert(calls.take === 0, "no usage counted on bad bodies");
});

Deno.test("not set up and limits", async () => {
  const a = make({ env: { GEMINI_API_KEY: "" } });
  const r1 = await handle(post(job), a.deps);
  assert(r1.status === 503 && (await r1.json()).error === "not_set_up", "no gemini key 503");
  assert(a.calls.take === 0, "limit not touched without key");
  const b = make({ allow: false });
  const r2 = await handle(post(job), b.deps);
  assert(r2.status === 429 && (await r2.json()).error === "limit_reached", "limit 429");
  assert(b.calls.fetch.length === 0, "gemini not called past limit");
});

Deno.test("good read is cleaned", async () => {
  const { deps, calls } = make({
    env: { GEMINI_MODEL: "gemini-test" },
    gemini: geminiOk(
      [{ q: 1, chosen: "A" }, { q: 2, chosen: "b" }, { q: 3, chosen: "E" }, { q: 4, chosen: "C" }, { q: 4, chosen: "D" }, { q: 9, chosen: "A" }, { q: 5, chosen: "blank" }],
      [{ text: "thinking...", thought: true }],
    ),
  });
  const r = await handle(post(job), deps);
  const j = await r.json();
  assert(r.status === 200, "200");
  const got = j.answers.map((a: { chosen: string }) => a.chosen).join(",");
  assert(got === "A,B,unclear,unclear,blank", "cleaned answers: " + got);
  assert(j.model === "gemini-test", "model echoed");
  const call = calls.fetch[0];
  assert(call.url.endsWith("/models/gemini-test:generateContent"), "model url");
  assert((call.init.headers as Record<string, string>)["x-goog-api-key"] === "g-key", "key header");
  const sent = JSON.parse(call.init.body as string);
  assert(sent.contents[0].parts[1].inlineData.mimeType === "image/jpeg", "photo sent");
  const en = sent.generationConfig.responseSchema.properties.answers.items.properties.chosen.enum.join(",");
  assert(en === "A,B,C,D,blank,several,unclear", "enum for A-D: " + en);
  assert(sent.contents[0].parts[0].text.includes("questions, numbered 1 to 5"), "prompt has count");
});

Deno.test("gemini failures", async () => {
  const cases: [() => Response | Promise<Response>, number, string][] = [
    [() => new Response("slow down", { status: 429 }), 503, "gemini_busy"],
    [() => new Response("oops", { status: 500 }), 503, "gemini_busy"],
    [() => new Response("bad model", { status: 404 }), 502, "gemini_failed"],
    [() => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] })), 502, "gemini_failed"],
    [() => { throw new Error("network down"); }, 503, "gemini_busy"],
  ];
  for (const [g, status, code] of cases) {
    const { deps } = make({ gemini: g });
    const r = await handle(post(job), deps);
    const j = await r.json();
    assert(r.status === status && j.error === code, `expected ${status} ${code}, got ${r.status} ${j.error}`);
  }
});

Deno.test("cleanAnswers fills every question", () => {
  const out = cleanAnswers({ answers: "nope" }, { deviceId: "", questionCount: 3, optionCount: 5, photos: [] });
  assert(out.length === 3 && out.every((a) => a.chosen === "unclear"), "all unclear");
  const five = cleanAnswers({ answers: [{ q: 1, chosen: "E" }] }, { deviceId: "", questionCount: 1, optionCount: 5, photos: [] });
  assert(five[0].chosen === "E", "E allowed with 5 options");
});

Deno.test("four pages are accepted", async () => {
  const { deps, calls } = make({ gemini: geminiOk([{ q: 1, chosen: "A" }]) });
  const r = await handle(post({ ...job, photos: [photo, photo, photo, photo] }), deps);
  const parts = JSON.parse(calls.fetch[0].init.body as string).contents[0].parts;
  assert(r.status === 200 && parts.length === 5, `status ${r.status}, parts ${parts.length}`);
  assert(String(parts[0].text).includes("4 pages"), "prompt mentions the pages");
});
