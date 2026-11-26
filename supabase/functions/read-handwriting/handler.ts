// read-handwriting/handler.ts: the request logic, kept apart from start-up so it can be tested.
// read-handwriting: Skora's second reader for handwritten answer scripts.
//
// The phone calls this only when ML Kit could not read a script clearly
// and Gemini is on in Settings. It sends one or two photos of the script;
// this function checks the daily limits, asks Gemini for one answer per
// question and returns them. It stores nothing.
//
// Request (POST, JSON), with the project's publishable key in the
// `apikey` header:
//   {
//     "device_id": "<32 hex characters from the phone's settings table>",
//     "question_count": 40,          // 1 to 100
//     "option_count": 4,             // 4 = A to D, 5 = A to E
//     "photos": [ { "mime_type": "image/jpeg", "data": "<base64>" } ]  // 1 or 2
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
// Settings (Edge Functions > Secrets):
//   GEMINI_API_KEY          required, from Google AI Studio
//   GEMINI_MODEL            optional, default gemini-3.8-flash
//   SKORA_PER_PHONE_DAILY   optional, default 100 requests per phone a day
//   SKORA_ALL_PHONES_DAILY  optional, default 200 requests a day for all
//                           phones; keep it under the free daily limit
//                           Google AI Studio shows for the model

type Letter = "A" | "B" | "C" | "D" | "E";
type Chosen = Letter | "blank" | "several" | "unclear";
type Photo = { mime_type: string; data: string };
type Job = { deviceId: string; questionCount: number; optionCount: 4 | 5; photos: Photo[] };

const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_PHOTO_BYTES = 4 * 1024 * 1024; // per photo, decoded
const GEMINI_TIMEOUT_MS = 60_000;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

export type Deps = {
  env: (name: string) => string | undefined;
  takeRequest: (deviceId: string, perPhone: number, allPhones: number) => Promise<boolean>;
  fetch: typeof fetch;
};

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

  if (!Array.isArray(b.photos) || b.photos.length < 1 || b.photos.length > 2) {
    return "Send one or two photos.";
  }
  const photos: Photo[] = [];
  for (const p of b.photos) {
    const photo = p as Record<string, unknown>;
    if (typeof photo?.mime_type !== "string" || !MIME_TYPES.has(photo.mime_type)) {
      return "Photos must be JPEG, PNG or WebP.";
    }
    if (typeof photo.data !== "string" || photo.data.length < 100 || !/^[A-Za-z0-9+/]+={0,2}$/.test(photo.data)) {
      return "Each photo must be base64 data.";
    }
    if (decodedSize(photo.data) > MAX_PHOTO_BYTES) return "Each photo must be 4 MB or less.";
    photos.push({ mime_type: photo.mime_type, data: photo.data });
  }

  return { deviceId, questionCount, optionCount, photos };
}

function promptFor(job: Job): string {
  const n = job.questionCount;
  const letters = lettersFor(job.optionCount).join(", ");
  return [
    `The photo${job.photos.length > 1 ? "s show" : " shows"} a student's handwritten answer script for an objective test with ${n} questions, numbered 1 to ${n}.`,
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

function geminiBody(job: Job) {
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

  const model = deps.env("GEMINI_MODEL") || "gemini-3.8-flash";
  let res: Response;
  try {
    res = await deps.fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(geminiBody(job)),
        signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      },
    );
  } catch (e) {
    console.error("Gemini request failed", e);
    return fail(503, "gemini_busy", "Gemini did not answer in time. The script stays in the queue.");
  }

  if (res.status === 429 || res.status >= 500) {
    console.error("Gemini busy", res.status, (await res.text()).slice(0, 500));
    return fail(503, "gemini_busy", "Gemini is busy right now. The script stays in the queue.");
  }
  if (!res.ok) {
    console.error("Gemini error", res.status, (await res.text()).slice(0, 500));
    return fail(502, "gemini_failed", "Gemini could not read this script. Fix the unclear answers by hand.");
  }

  let parsed: unknown;
  try {
    const data = await res.json();
    const parts: { text?: string; thought?: boolean }[] = data?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
    parsed = JSON.parse(text);
  } catch (e) {
    console.error("Gemini reply was not JSON", e);
    return fail(502, "gemini_failed", "Gemini could not read this script. Fix the unclear answers by hand.");
  }

  return reply(200, { answers: cleanAnswers(parsed, job), model });
}
