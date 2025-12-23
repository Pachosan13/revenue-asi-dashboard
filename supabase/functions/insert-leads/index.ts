import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
}

serve(async (req) => {
  const auth = req.headers.get("authorization");
  if (!auth) return json(401, { message: "Missing authorization header" });
  if (req.method !== "POST") return json(405, { error: "Use POST" });

  const URL = Deno.env.get("SUPABASE_URL");
  const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!URL || !KEY) return json(500, { error: "Missing secrets" });

  const body = await req.json().catch(() => ({} as any));
  const rows = body.rows as any[] | undefined;
  if (!rows?.length) return json(400, { error: "rows[] required" });

  const supabase = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data, error } = await supabase
    .schema("lead_hunter")
    .from("leads")
    .upsert(rows, { onConflict: "account_id,source,external_id" })
    .select("id");

  if (error) return json(400, { error });
  return json(200, { ok: true, inserted: data?.length ?? 0 });
});
