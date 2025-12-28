import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  try {
    // 1) Auth requerido por tu proyecto (Edge Functions)
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json(401, { code: 401, message: "Missing authorization header" });

    // 2) Método
    if (req.method !== "POST") return json(405, { error: "Use POST" });

    // 3) Secrets (los que YA tienes en Supabase)
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, {
        error: "Missing secrets",
        SUPABASE_URL_present: !!SUPABASE_URL,
        SUPABASE_SERVICE_ROLE_KEY_present: !!SUPABASE_SERVICE_ROLE_KEY,
      });
    }

    // 4) Body
    const body = await req.json().catch(() => ({} as any));

    const account_id = body.account_id as string | undefined;
    const source = (body.source ?? "encuentra24") as string;
    const niche = (body.niche ?? "autos") as string;
    const geo = (body.geo ?? { country: "PA" }) as Record<string, unknown>;
    const meta = (body.meta ?? {}) as Record<string, unknown>;
    const public_token = (body.public_token ?? crypto.randomUUID()) as string;

    if (!account_id) return json(400, { error: "account_id required" });

    // 5) Service role client (bypass RLS para INSERT)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 6) Insert (si token duplica, te devuelve 23505 por tu UNIQUE)
    const { data, error } = await supabase
      .schema("lead_hunter")
      .from("jobs")
      .insert({
        account_id,
        source,
        niche,
        status: "queued",
        geo,
        meta,
        public_token,
      })
      .select("id, account_id, source, niche, status, public_token, created_at")
      .single();

    if (error) return json(400, { error });

    return json(200, { ok: true, job: data });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
