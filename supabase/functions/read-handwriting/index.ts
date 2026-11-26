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
  giveBack: async (deviceId) => {
    const { error } = await admin.rpc("give_back_gemini_request", { p_device: deviceId });
    if (error) throw error;
  },
  modelOrder: async (models) => {
    const { data, error } = await admin.rpc("gemini_model_order", { p_models: models });
    if (error) throw error;
    return Array.isArray(data) ? data.map(String) : models;
  },
  markBusy: async (model, seconds) => {
    const { error } = await admin.rpc("mark_gemini_model_busy", { p_model: model, p_seconds: seconds });
    if (error) throw error;
  },
};

Deno.serve((req) => handle(req, deps));
