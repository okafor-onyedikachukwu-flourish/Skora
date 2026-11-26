// Skora app: send an unclear handwritten script to the read-handwriting
// Edge Function, then combine Gemini's reading with the phone's.
//
// Photos go in as base64 JPEG. Shrink them first (about 1600 px wide,
// quality 0.7 keeps each photo well under the 4 MB limit), for example
// with expo-image-manipulator's base64 output.

export type Letter = "A" | "B" | "C" | "D" | "E";
export type Chosen = Letter | "blank" | "several" | "unclear";
export type Photo = { mime_type: "image/jpeg" | "image/png" | "image/webp"; data: string };

export type ReadError =
  | "offline"        // no internet, or the call timed out: keep it in the queue
  | "limit_reached"  // today's Gemini limit is used up: teacher fixes it, or try tomorrow
  | "not_set_up"     // GEMINI_API_KEY not added yet: teacher fixes it by hand
  | "gemini_busy"    // Gemini or Supabase busy: keep it in the queue, retry later
  | "gemini_failed"  // Gemini could not read it: teacher fixes it by hand
  | "bad_request"    // the app sent something wrong (a bug)
  | "unauthorized"   // wrong publishable key in the app (a bug)
  | "unknown";

export type ReadResult =
  | { ok: true; answers: { q: number; chosen: Chosen }[]; model: string }
  | { ok: false; error: ReadError; message: string; retryLater: boolean };

const RETRY_LATER = new Set<ReadError>(["offline", "gemini_busy", "limit_reached"]);
const KNOWN = new Set<string>(["limit_reached", "not_set_up", "gemini_busy", "gemini_failed", "bad_request", "unauthorized"]);

export async function readHandwriting(opts: {
  supabaseUrl: string;      // e.g. https://yuolzyndkhuwmkulswdd.supabase.co
  publishableKey: string;   // sb_publishable_...
  deviceId: string;         // settings.device_id
  questionCount: number;
  optionCount: 4 | 5;
  photos: Photo[];          // 1 or 2 pages
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}): Promise<ReadResult> {
  const doFetch = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 75_000);

  let res: Response;
  try {
    res = await doFetch(`${opts.supabaseUrl.replace(/\/$/, "")}/functions/v1/read-handwriting`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: opts.publishableKey },
      body: JSON.stringify({
        device_id: opts.deviceId,
        question_count: opts.questionCount,
        option_count: opts.optionCount,
        photos: opts.photos,
      }),
      signal: controller.signal,
    });
  } catch {
    return { ok: false, error: "offline", message: "No internet. The script will wait in the queue.", retryLater: true };
  } finally {
    clearTimeout(timer);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await res.json();
  } catch { /* not JSON */ }

  if (res.ok && Array.isArray(body.answers)) {
    return { ok: true, answers: body.answers as { q: number; chosen: Chosen }[], model: String(body.model ?? "") };
  }

  const code = typeof body.error === "string" && KNOWN.has(body.error) ? body.error as ReadError : "unknown";
  const message = typeof body.message === "string" ? body.message : "Gemini could not read this script. Fix the unclear answers by hand.";
  return { ok: false, error: code, message, retryLater: RETRY_LATER.has(code) || (code === "unknown" && res.status >= 500) };
}

// One question as the result screen shows it.
export type MergedAnswer = {
  q: number;
  chosen: Chosen;
  source: "mlkit" | "gemini";
  clear: boolean;          // false = highlight it for the teacher
  alsoRead?: Chosen;       // the other reader's answer, when they disagree
};

const DEFINITE = (c: Chosen | undefined): c is Letter | "blank" | "several" =>
  c !== undefined && c !== "unclear";

// The phone's reading and Gemini's reading, combined:
//   * both give the same answer          -> that answer, clear
//   * only one reader is sure            -> that reader's answer, clear
//   * both are sure but give different answers -> unclear, teacher picks
//   * neither is sure                    -> unclear, teacher picks
export function mergeReads(
  questionCount: number,
  phone: { q: number; chosen: Chosen; clear: boolean }[],
  gemini: { q: number; chosen: Chosen }[] | null,
): MergedAnswer[] {
  const p = new Map(phone.map((a) => [a.q, a.clear ? a.chosen : "unclear" as Chosen]));
  const g = new Map((gemini ?? []).map((a) => [a.q, a.chosen]));
  const out: MergedAnswer[] = [];
  for (let q = 1; q <= questionCount; q++) {
    const a = p.get(q);
    const b = g.get(q);
    if (DEFINITE(a) && DEFINITE(b)) {
      // On a disagreement the phone's answer is shown first and Gemini's
      // beside it; the teacher must pick one before Save.
      out.push(a === b ? { q, chosen: a, source: "mlkit", clear: true } : { q, chosen: a, source: "mlkit", clear: false, alsoRead: b });
    } else if (DEFINITE(a)) {
      out.push({ q, chosen: a, source: "mlkit", clear: true });
    } else if (DEFINITE(b)) {
      out.push({ q, chosen: b, source: "gemini", clear: true });
    } else {
      out.push({ q, chosen: "unclear", source: gemini ? "gemini" : "mlkit", clear: false });
    }
  }
  return out;
}
