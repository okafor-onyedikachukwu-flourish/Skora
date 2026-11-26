import { readHandwriting, mergeReads } from "../../src/lib/readHandwriting.ts";
function assert(c: unknown, m: string) { if (!c) throw new Error("FAILED: " + m); }
const base = { supabaseUrl: "https://x.supabase.co/", publishableKey: "sb_publishable_k", deviceId: "0123456789abcdef0123456789abcdef", questionCount: 3, optionCount: 4 as const, photos: [{ mime_type: "image/jpeg" as const, data: "AAAA" }] };
const respond = (status: number, body: unknown) => (async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })) as unknown as typeof fetch;

Deno.test("sends the right request", async () => {
  let seen: { url: string; init: RequestInit } | null = null;
  const f = (async (url: string, init: RequestInit) => { seen = { url, init }; return new Response(JSON.stringify({ answers: [{ q: 1, chosen: "A" }], model: "m" })); }) as unknown as typeof fetch;
  const r = await readHandwriting({ ...base, fetchFn: f });
  assert(r.ok && r.answers[0].chosen === "A" && r.model === "m", "ok result");
  assert(seen!.url === "https://x.supabase.co/functions/v1/read-handwriting", "url without double slash");
  const h = seen!.init.headers as Record<string, string>;
  assert(h.apikey === "sb_publishable_k" && !("Authorization" in h), "key in apikey header only");
  const b = JSON.parse(seen!.init.body as string);
  assert(b.device_id === base.deviceId && b.question_count === 3 && b.option_count === 4 && b.photos.length === 1, "body fields");
});

Deno.test("errors map to queue decisions", async () => {
  const cases: [typeof fetch, string, boolean][] = [
    [(async () => { throw new TypeError("Network request failed"); }) as unknown as typeof fetch, "offline", true],
    [respond(429, { error: "limit_reached", message: "m" }), "limit_reached", true],
    [respond(503, { error: "gemini_busy", message: "m" }), "gemini_busy", true],
    [respond(503, { error: "not_set_up", message: "m" }), "not_set_up", false],
    [respond(502, { error: "gemini_failed", message: "m" }), "gemini_failed", false],
    [respond(401, { error: "unauthorized", message: "m" }), "unauthorized", false],
    [respond(500, "<html>gateway</html>"), "unknown", true],
    [respond(404, "nope"), "unknown", false],
  ];
  for (const [f, code, later] of cases) {
    const r = await readHandwriting({ ...base, fetchFn: f });
    assert(!r.ok && r.error === code && r.retryLater === later, `${code}: got ${JSON.stringify(r)}`);
  }
});

Deno.test("timeout counts as offline", async () => {
  const slow = ((_u: string, init: RequestInit) => new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))))) as unknown as typeof fetch;
  const r = await readHandwriting({ ...base, fetchFn: slow, timeoutMs: 20 });
  assert(!r.ok && r.error === "offline" && r.retryLater, "timeout -> offline");
});

Deno.test("merge rules", () => {
  const phone = [
    { q: 1, chosen: "A" as const, clear: true },   // agree
    { q: 2, chosen: "B" as const, clear: true },   // disagree
    { q: 3, chosen: "C" as const, clear: false },  // phone unsure, gemini sure
    { q: 4, chosen: "D" as const, clear: true },   // gemini unclear
    // q5 missing on phone, gemini unclear
  ];
  const gem = [{ q: 1, chosen: "A" as const }, { q: 2, chosen: "C" as const }, { q: 3, chosen: "D" as const }, { q: 4, chosen: "unclear" as const }, { q: 5, chosen: "unclear" as const }];
  const m = mergeReads(5, phone, gem);
  const s = m.map((a) => `${a.q}:${a.chosen}:${a.source}:${a.clear ? "clear" : "check"}${a.alsoRead ? "/" + a.alsoRead : ""}`).join(" ");
  assert(s === "1:A:mlkit:clear 2:B:mlkit:check/C 3:D:gemini:clear 4:D:mlkit:clear 5:unclear:gemini:check", s);
  const noGem = mergeReads(2, [{ q: 1, chosen: "blank", clear: true }], null);
  assert(noGem[0].chosen === "blank" && noGem[0].clear && noGem[1].chosen === "unclear" && !noGem[1].clear && noGem[1].source === "mlkit", "phone only");
});
