// read-handwriting/handler.ts: the request logic, kept apart from start-up so it can be tested.
// read-handwriting: Skora's second reader for handwritten answer scripts.
//
// The phone calls this only when ML Kit could not read a script clearly
// and Gemini is on in Settings. It sends one to four photos of the script;
// this function checks the daily limits, asks Gemini for one answer per
// question and returns them. It stores nothing.
//
// Request (POST, JSON), with the project's publishable key in the
// `apikey` header:
//   {
//     "device_id": "<32 hex characters from the phone's settings table>",
//     "question_count": 40,          // 1 to 100
//     "option_count": 4,             // 4 = A to D, 5 = A to E
//     "photos": [ { "mime_type": "image/jpeg", "data": "<base64>" } ]  // 1 to 4 pages
//   }
//
// Reply 200:
//   { "answers": [ { "q": 1, "chosen": "B" }, ... ], "model": "..." }
//   chosen is a letter, "blank", "several" or "unclear".
//
// Other replies: { "error": "<code>", "message": "<for the teacher>" }
//   400 bad_request · 401 unauthorized · 405 method_not_allowed
//   429 limit_reached · 503 not_set_up or gemini_busy · 502 gemini_failed
//
// Gemini models: tried in order until one answers. A model that was busy
// (overloaded, out of free quota or too slow) is tried last for the next
// few minutes, so the teacher does not wait for it again and again. If no
// model answers, the request does not count against the day's limit.
//
// Settings (Edge Functions > Secrets):
//   GEMINI_API_KEY          required, from Google AI Studio
//   GEMINI_MODELS           optional, models to try, comma-separated; default
//                           gemini-3.5-flash-lite,gemini-3.6-flash,gemini-3.8-flash
//   GEMINI_MODEL            optional, one model to try before those
//   SKORA_PER_PHONE_DAILY   optional, default 100 requests per phone a day
//   SKORA_ALL_PHONES_DAILY  optional, default 200 requests a day for all
//                           phones; keep it under the free daily limit
//                           Google AI Studio shows for the model

type Letter = "A" | "B" | "C" | "D" | "E";
type Chosen = Letter | "blank" | "several" | "unclear";
type Photo = { mime_type: string; data: string };
type Job = { deviceId: string; questionCount: number; optionCount: 4 | 5; photos: Photo[] };

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTOS = 4;
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // per photo, decoded
const MAX_TOTAL_BYTES = 12 * 1024 * 1024; // all photos together, decoded
const DEFAULT_MODELS = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.8-flash"];
// The lowest thinking each model allows. Reading letters needs little thought, and thinking is slow.
const THINKING: Record<string, string> = {
  "gemini-3.8-flash": "LOW",
  "gemini-3.6-flash": "MINIMAL",
  "gemini-3.5-flash-lite": "MINIMAL",
  "gemini-3-flash-preview": "MINIMAL",
};
const TOTAL_TIME_MS = 45_000; // all tries together, so the phone hears back in time
const TRY_TIME_MS = 25_000; // one model
const BUSY_SECONDS = 180; // how long a busy model goes to the back of the line

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type Deps = {
  env: (name: string) => string | undefined;
  takeRequest: (deviceId: string, perPhone: number, allPhones: number) => Promise<boolean>;
  /** Hands back a request no model answered, so it does not use up the day's limit. */
  giveBack: (deviceId: string) => Promise<void>;
  /** The models in the order to try them: those busy lately go last. */
  modelOrder: (models: string[]) => Promise<string[]>;
  markBusy: (model: string, seconds: number) => Promise<void>;
  fetch: typeof fetch;
  now?: () => number;
};

export function modelsFrom(env: Deps["env"]): string[] {
  const listed = (env("GEMINI_MODELS") ?? "").split(",").map((m) => m.trim()).filter(Boolean);
  const first = (env("GEMINI_MODEL") ?? "").trim();
  return [...new Set([...(first ? [first] : []), ...(listed.length ? listed : DEFAULT_MODELS)])];
}

function reply(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function fail(status: number, error: string, message: string): Response {
  return reply(status, { error, message });
}

function toInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

// Keys the app may send: every publishable key, plus the legacy anon key
// while it still exists.
function allowedKeys(env: Deps["env"]): string[] {
  const keys: string[] = [];
  try {
    const named = JSON.parse(env("SUPABASE_PUBLISHABLE_KEYS") ?? "{}");
    for (const k of Object.values(named)) if (typeof k === "string" && k) keys.push(k);
  } catch { /* not set */ }
  const anon = env("SUPABASE_ANON_KEY");
  if (anon) keys.push(anon);
  return keys;
}

function lettersFor(optionCount: 4 | 5): Letter[] {
  return optionCount === 5 ? ["A", "B", "C", "D", "E"] : ["A", "B", "C", "D"];
}

function decodedSize(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function readJob(body: unknown): Job | string {
  if (typeof body !== "object" || body === null) return "Send the scan as JSON.";
  const b = body as Record<string, unknown>;

  const deviceId = typeof b.device_id === "string" ? b.device_id : "";
  if (!/^[0-9a-f]{32}$/.test(deviceId)) return "device_id must be 32 lower-case hex characters.";

  const questionCount = b.question_count;
  if (typeof questionCount !== "number" || !Number.isInteger(questionCount) || questionCount < 1 || questionCount > 100) {
    return "question_count must be a whole number from 1 to 100.";
  }

  const optionCount = b.option_count;
  if (optionCount !== 4 && optionCount !== 5) return "option_count must be 4 or 5.";

  if (!Array.isArray(b.photos) || b.photos.length < 1 || b.photos.length > MAX_PHOTOS) {
    return `Send one to ${MAX_PHOTOS} photos.`;
  }
  const photos: Photo[] = [];
  let total = 0;
  for (const p of b.photos) {
    const photo = p as Record<string, unknown>;
    if (typeof photo?.mime_type !== "string" || !MIME_TYPES.has(photo.mime_type)) {
      return "Photos must be JPEG, PNG or WebP.";
    }
    if (typeof photo.data !== "string" || photo.data.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data)) {
      return "Each photo must be base64 data.";
    }
    const size = decodedSize(photo.data);
    if (size > MAX_PHOTO_BYTES) return "Each photo must be 4 MB or less.";
    total += size;
    if (total > MAX_TOTAL_BYTES) return "The photos together must be 12 MB or less.";
    photos.push({ mime_type: photo.mime_type, data: photo.data });
  }

  return { deviceId, questionCount, optionCount, photos };
}

function promptFor(job: Job): string {
  const n = job.questionCount;
  const letters = lettersFor(job.optionCount).join(", ");
  return [
    `The photo${job.photos.length > 1 ? `s show the ${job.photos.length} pages of` : " shows"} a student's handwritten answer script for an objective test with ${n} questions, numbered 1 to ${n}.`,
    `Each answer is one letter: ${letters}.`,
    `Find the student's answer to every question from 1 to ${n}.`,
    `- Students write answers in many ways, for example "1. B", "1) b", "1-B", "1B", or numbers and letters in columns. Small letters count the same as capitals.`,
    `- If a letter is crossed out and another is written, use the one that is not crossed out.`,
    `- Use "blank" when there is no answer for a question.`,
    `- Use "several" when more than one letter is given as the answer.`,
    `- Use "unclear" when you cannot read the answer with confidence. Never guess.`,
    `- Ignore the student's name, class, subject and any other writing.`,
    `Return exactly one entry for each question from 1 to ${n}.`,
  ].join("\n");
}

function geminiBody(job: Job, thinkingLevel?: string) {
  const allowed = [...lettersFor(job.optionCount), "blank", "several", "unclear"];
  return {
    contents: [{
      role: "user",
      parts: [
        { text: promptFor(job) },
        ...job.photos.map((p) => ({ inlineData: { mimeType: p.mime_type, data: p.data } })),
      ],
    }],
    generationConfig: {
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          answers: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                q: { type: "INTEGER" },
                chosen: { type: "STRING", enum: allowed },
              },
              required: ["q", "chosen"],
            },
          },
        },
        required: ["answers"],
      },
    },
  };
}

// One answer per question, 1 to n. Anything missing, repeated with a
// different value, or not allowed for this exam becomes "unclear".
export function cleanAnswers(raw: unknown, job: Job): { q: number; chosen: Chosen }[] {
  const allowed = new Set<string>([...lettersFor(job.optionCount), "blank", "several", "unclear"]);
  const seen = new Map<number, Chosen>();
  const list = (raw as { answers?: unknown })?.answers;
  if (Array.isArray(list)) {
    for (const item of list) {
      const q = (item as { q?: unknown })?.q;
      let chosen = (item as { chosen?: unknown })?.chosen;
      if (typeof q !== "number" || !Number.isInteger(q) || q < 1 || q > job.questionCount) continue;
      if (typeof chosen === "string" && /^[a-e]$/.test(chosen)) chosen = chosen.toUpperCase();
      const value: Chosen = typeof chosen === "string" && allowed.has(chosen) ? chosen as Chosen : "unclear";
      const before = seen.get(q);
      seen.set(q, before === undefined || before === value ? value : "unclear");
    }
  }
  return Array.from({ length: job.questionCount }, (_, i) => ({ q: i + 1, chosen: seen.get(i + 1) ?? "unclear" }));
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return fail(405, "method_not_allowed", "Use POST.");

  const key = req.headers.get("apikey") ?? "";
  if (!key || !allowedKeys(deps.env).includes(key)) {
    return fail(401, "unauthorized", "This request did not come from the Skora app.");
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return fail(400, "bad_request", "Send the scan as JSON.");
  }
  const job = readJob(body);
  if (typeof job === "string") return fail(400, "bad_request", job);

  const apiKey = deps.env("GEMINI_API_KEY");
  if (!apiKey) return fail(503, "not_set_up", "Gemini is not set up yet. Fix the unclear answers by hand for now.");

  const perPhone = toInt(deps.env("SKORA_PER_PHONE_DAILY"), 100);
  const allPhones = toInt(deps.env("SKORA_ALL_PHONES_DAILY"), 200);
  let allowed: boolean;
  try {
    allowed = await deps.takeRequest(job.deviceId, perPhone, allPhones);
  } catch (e) {
    console.error("take_gemini_request failed", e);
    return fail(503, "gemini_busy", "Skora could not check today's limit. Try again later.");
  }
  if (!allowed) {
    return fail(429, "limit_reached", "Today's Gemini limit is used up. Fix the unclear answers by hand, or try again tomorrow.");
  }

  const now = deps.now ?? Date.now;
  const deadline = now() + TOTAL_TIME_MS;
  let order = modelsFrom(deps.env);
  try {
    const sorted = await deps.modelOrder(order);
    if (sorted.length === order.length) order = sorted;
  } catch (e) {
    console.error("gemini_model_order failed", e);
  }

  let busy = false;
  for (const model of order) {
    const left = deadline - now();
    if (left < 4_000) break;
    let result = await tryModel(deps, apiKey, model, job, Math.min(TRY_TIME_MS, left), THINKING[model]);
    if (result.kind === "thinking") result = await tryModel(deps, apiKey, model, job, Math.min(TRY_TIME_MS, deadline - now()), undefined);
    if (result.kind === "ok") return reply(200, { answers: cleanAnswers(result.parsed, job), model });
    if (result.kind === "key") {
      await giveBack(deps, job.deviceId);
      return fail(503, "not_set_up", "The Gemini key is not working. Fix the unclear answers by hand for now.");
    }
    if (result.kind === "busy") {
      busy = true;
      try {
        await deps.markBusy(model, BUSY_SECONDS);
      } catch (e) {
        console.error("mark_gemini_model_busy failed", e);
      }
    }
    // Busy, gone, refused or a bad reply: try the next model.
  }

  await giveBack(deps, job.deviceId);
  return busy
    ? fail(503, "gemini_busy", "Gemini is busy right now. Fix the unclear answers yourself, or keep the script for later.")
    : fail(502, "gemini_failed", "Gemini could not read this script. Fix the unclear answers by hand.");
}

async function giveBack(deps: Deps, deviceId: string) {
  try {
    await deps.giveBack(deviceId);
  } catch (e) {
    console.error("give_back_gemini_request failed", e);
  }
}

type Try =
  | { kind: "ok"; parsed: unknown }
  | { kind: "busy" } // overloaded, out of quota or too slow: try another model
  | { kind: "thinking" } // this model does not take the thinking setting: try it again without
  | { kind: "missing" } // no such model (any more)
  | { kind: "bad_reply" } // the reply was not the JSON asked for
  | { kind: "key" } // the API key is wrong or not allowed
  | { kind: "refused" }; // Gemini refused the request (another model may still take it)

async function tryModel(deps: Deps, apiKey: string, model: string, job: Job, timeoutMs: number, thinkingLevel?: string): Promise<Try> {
  let res: Response;
  try {
    res = await deps.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(geminiBody(job, thinkingLevel)),
        signal: AbortSignal.timeout(Math.max(1_000, timeoutMs)),
      },
    );
  } catch (e) {
    console.error(`Gemini ${model} did not answer`, String(e).slice(0, 200));
    return { kind: "busy" };
  }

  if (!res.ok) {
    const text = (await res.text()).slice(0, 500);
    console.error(`Gemini ${model} ${res.status}`, text);
    if (res.status === 429 || res.status >= 500) return { kind: "busy" };
    if (res.status === 404) return { kind: "missing" };
    if (res.status === 401 || res.status === 403) return { kind: "key" };
    if (res.status === 400 && thinkingLevel && /thinking/i.test(text)) return { kind: "thinking" };
    if (res.status === 400 && /api key/i.test(text)) return { kind: "key" };
    return { kind: "refused" };
  }

  try {
    const data = await res.json();
    const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    return { kind: "ok", parsed: JSON.parse(text) };
  } catch (e) {
    console.error(`Gemini ${model} reply was not JSON`, e);
    return { kind: "bad_reply" };
  }
}
