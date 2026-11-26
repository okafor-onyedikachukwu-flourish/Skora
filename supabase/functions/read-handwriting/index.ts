// read-handwriting/index.ts: starts the function. The logic is in handler.ts.

import { createClient } from "npm:@supabase/supabase-js@2";
import { type Deps, handle } from "./handler.ts";

const env = (name: string) => Deno.env.get(name);
const secret = (() => {
  try {
    const keys = JSON.parse(env("SUPABASE_SECRET_KEYS") ?? "{}");
    if (typeof keys.default === "string") return keys.default;
  } catch { /* not set */ }
  return env("SUPABASE_SERVICE_ROLE_KEY") ?? "";
})();
const admin = createClient(env("SUPABASE_URL") ?? "", secret, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const deps: Deps = {
  env,
  fetch,
  takeRequest: async (deviceId, perPhone, allPhones) => {
    const { data, error } = await admin.rpc("take_gemini_request", {
      p_device: deviceId,
      p_per_phone: perPhone,
      p_all_phones: allPhones,
    });
    if (error) throw error;
    return data === true;
  },
};

Deno.serve((req) => handle(req, deps));
