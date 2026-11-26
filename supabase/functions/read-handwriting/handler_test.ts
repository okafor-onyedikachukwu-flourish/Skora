import { handle, cleanAnswers, modelsFrom, type Deps } from "./handler.ts";

const PUB = "sb_publishable_test123";
const photo = { mime_type: "image/jpeg", data: "A".repeat(400) };
const job = { device_id: "0123456789abcdef0123456789abcdef", question_count: 5, option_count: 4, photos: [photo] };

function assert(c: unknown, m: string) { if (!c) throw new Error("FAILED: " + m); }
function make(opts: {
  env?: Record<string, string>;
  allow?: boolean;
  gemini?: (url: string, init: RequestInit) => Response | Promise<Response>;
  order?: (models: string[]) => string[];
  msPerCall?: number;
} = {}) {
  const calls = { take: 0, giveBack: 0, busy: [] as string[], fetch: [] as { url: string; init: RequestInit }[] };
  const env = { SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUB }), GEMINI_API_KEY: "g-key", ...opts.env };
  let clock = 0;
  const deps: Deps = {
    env: (n) => (env as Record<string, string>)[n],
    takeRequest: async () => { calls.take++; return opts.allow ?? true; },
    giveBack: async () => { calls.giveBack++; },
    modelOrder: async (models) => (opts.order ? opts.order(models) : models),
    markBusy: async (model) => { calls.busy.push(model); },
    now: () => clock,
    fetch: (async (url: string, init: RequestInit) => {
      calls.fetch.push({ url, init });
      clock += opts.msPerCall ?? 1000;
      return opts.gemini ? opts.gemini(url, init) : new Response("{}");
    }) as unknown as typeof fetch,
  };
  return { deps, calls };
}
const modelOf = (url: string) => decodeURIComponent(url.split("/models/")[1].split(":")[0]);
const post = (body: unknown, key: string | null = PUB) =>
  new Request("http://x/read-handwriting", { method: "POST", headers: key ? { apikey: key, "content-type": "application/json" } : {}, body: typeof body === "string" ? body : JSON.stringify(body) });
const geminiOk = (answers: unknown, extraParts: unknown[] = []) => (_url?: string, _init?: RequestInit) =>
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

Deno.test("the models to try", () => {
  assert(modelsFrom(() => undefined).join() === "gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.8-flash", "default models");
  const env: Record<string, string> = { GEMINI_MODEL: "gemini-3.8-flash", GEMINI_MODELS: " gemini-x , gemini-3.8-flash," };
  assert(modelsFrom((n) => env[n]).join() === "gemini-3.8-flash,gemini-x", "GEMINI_MODEL first, no repeats");
});

Deno.test("a busy model is skipped for the next one", async () => {
  const { deps, calls } = make({
    gemini: (url) => (modelOf(url) === "gemini-3.5-flash-lite" ? new Response("high demand", { status: 503 }) : geminiOk([{ q: 1, chosen: "C" }])()),
  });
  const r = await handle(post(job), deps);
  const j = await r.json();
  assert(r.status === 200 && j.model === "gemini-3.6-flash" && j.answers[0].chosen === "C", JSON.stringify(j));
  assert(calls.busy.join() === "gemini-3.5-flash-lite", "busy model remembered: " + calls.busy);
  assert(calls.giveBack === 0, "an answered request stays counted");
  const thinking = calls.fetch.map((c) => JSON.parse(c.init.body as string).generationConfig.thinkingConfig?.thinkingLevel).join();
  assert(thinking === "MINIMAL,MINIMAL", "lowest thinking sent: " + thinking);
});

Deno.test("models busy lately are tried last", async () => {
  const { deps, calls } = make({ order: (m) => [m[2], m[0], m[1]], gemini: geminiOk([]) });
  await handle(post(job), deps);
  assert(modelOf(calls.fetch[0].url) === "gemini-3.8-flash", "first model from the order");
  assert(JSON.parse(calls.fetch[0].init.body as string).generationConfig.thinkingConfig.thinkingLevel === "LOW", "3.8 Flash thinks low");
});

Deno.test("every model busy: busy, and the request is given back", async () => {
  for (const g of [() => new Response("quota", { status: 429 }), () => new Response("oops", { status: 500 }), () => { throw new Error("timeout"); }]) {
    const { deps, calls } = make({ gemini: g });
    const r = await handle(post(job), deps);
    const j = await r.json();
    assert(r.status === 503 && j.error === "gemini_busy", `${r.status} ${j.error}`);
    assert(calls.fetch.length === 3 && calls.busy.length === 3 && calls.giveBack === 1, JSON.stringify(calls.busy) + calls.giveBack);
  }
});

Deno.test("the time limit stops the tries", async () => {
  const { deps, calls } = make({ msPerCall: 25_000, gemini: () => new Response("slow", { status: 503 }) });
  const r = await handle(post(job), deps);
  assert(r.status === 503 && calls.fetch.length === 2, `tries: ${calls.fetch.length}`);
});

Deno.test("other Gemini failures", async () => {
  // A missing model or a bad reply: the next model is tried.
  const missing = make({ gemini: (url) => (modelOf(url) === "gemini-3.5-flash-lite" ? new Response("no model", { status: 404 }) : geminiOk([])()) });
  assert((await handle(post(job), missing.deps)).status === 200, "404 falls through");
  const badReply = make({ gemini: () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] })) });
  const r1 = await handle(post(job), badReply.deps);
  assert(r1.status === 502 && (await r1.json()).error === "gemini_failed" && badReply.calls.giveBack === 1, "all bad replies: 502, given back");
  // A model that does not take the thinking setting is asked again without it.
  const noThinking = make({
    gemini: (_u, init) => (JSON.parse(init.body as string).generationConfig.thinkingConfig ? new Response("thinking level not supported", { status: 400 }) : geminiOk([])()),
  });
  assert((await handle(post(job), noThinking.deps)).status === 200 && noThinking.calls.fetch.length === 2, "retried without thinking");
  // A wrong key: stop at once. A refused request: the other models are tried.
  const badKey = make({ gemini: () => new Response("API key not valid", { status: 400 }) });
  const r2 = await handle(post(job), badKey.deps);
  assert(r2.status === 503 && (await r2.json()).error === "not_set_up" && badKey.calls.fetch.length === 1, "bad key");
  const refused = make({ gemini: () => new Response("image could not be processed", { status: 400 }) });
  const r3 = await handle(post(job), refused.deps);
  assert(r3.status === 502 && refused.calls.fetch.length === 3 && refused.calls.giveBack === 1, "refused by every model: 502");
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
