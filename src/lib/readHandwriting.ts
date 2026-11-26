// Skora app: send an unclear handwritten script to the read-handwriting
// Edge Function, then combine Gemini's reading with the phone's.
//
// Photos go in as base64 JPEG. Shrink them first (about 1600 px on the
// longest side at quality 0.7 keeps each well under the 4 MB limit and
// quick to upload), for example with expo-image-manipulator's base64 output.

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
  photos: Photo[];          // 1 to 4 pages
  timeoutMs?: number;
  signal?: AbortSignal;     // to stop waiting, for example when the teacher leaves the screen
  fetchFn?: typeof fetch;
}): Promise<ReadResult> {
  const doFetch = opts.fetchFn ?? fetch;
  const controller = new AbortController();
  // The helper gives up on Gemini after 45 seconds; the rest is time to upload the photos.
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  const stop = () => controller.abort();
  opts.signal?.addEventListener("abort", stop);

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
    return { ok: false, error: "offline", message: "No internet, or the connection is too slow.", retryLater: true };
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", stop);
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

// The phone's reading and Gemini's reading, combined. The phone gives its answer, whether it is
// sure of it, and for answers it is not sure of, its best guess when it read a letter at all
// (send "unclear" when it has none):
//   * both sure and the same              -> that answer, clear
//   * both sure but different             -> the phone's answer, teacher checks (alsoRead = Gemini's)
//   * only the phone is sure              -> the phone's answer, clear
//   * only Gemini is sure                 -> Gemini's answer, clear, unless the phone's guess
//                                            differs: then the teacher checks
//   * neither is sure                     -> the phone's guess or "unclear", teacher checks
export function mergeReads(
  questionCount: number,
  phone: { q: number; chosen: Chosen; clear: boolean }[],
  gemini: { q: number; chosen: Chosen }[] | null,
): MergedAnswer[] {
  const p = new Map(phone.map((a) => [a.q, a]));
  const g = new Map((gemini ?? []).map((a) => [a.q, a.chosen]));
  const out: MergedAnswer[] = [];
  for (let q = 1; q <= questionCount; q++) {
    const read = p.get(q);
    const a = read?.chosen;
    const phoneSure = !!read?.clear && DEFINITE(a);
    const b = g.get(q);
    if (phoneSure && DEFINITE(b)) {
      out.push(a === b ? { q, chosen: a, source: "mlkit", clear: true } : { q, chosen: a, source: "mlkit", clear: false, alsoRead: b });
    } else if (phoneSure) {
      out.push({ q, chosen: a, source: "mlkit", clear: true });
    } else if (DEFINITE(b)) {
      out.push(DEFINITE(a) && a !== b ? { q, chosen: b, source: "gemini", clear: false, alsoRead: a } : { q, chosen: b, source: "gemini", clear: true });
    } else if (DEFINITE(a)) {
      out.push({ q, chosen: a, source: "mlkit", clear: false });
    } else {
      out.push({ q, chosen: "unclear", source: gemini ? "gemini" : "mlkit", clear: false });
    }
  }
  return out;
}
