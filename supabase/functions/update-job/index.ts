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
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json(401, { code: 401, message: "Missing authorization header" });
    if (req.method !== "POST") return json(405, { error: "Use POST" });

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !KEY) return json(500, { error: "Missing secrets" });

    const body = await req.json().catch(() => ({} as any));
    const job_id = body.job_id as string | undefined;
    if (!job_id) return json(400, { error: "job_id required" });

    const patch: any = {};
    if (typeof body.cursor === "number") patch.cursor = body.cursor;
    if (body.progress && typeof body.progress === "object") patch.progress = body.progress;
    if (body.meta && typeof body.meta === "object") patch.meta = body.meta;
    patch.updated_at = new Date().toISOString();

    const supabase = createClient(SUPABASE_URL, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await supabase
      .schema("lead_hunter")
      .from("jobs")
      .update(patch)
      .eq("id", job_id)
      .select("id,status,cursor,progress,updated_at")
      .maybeSingle();

    if (error) return json(400, { error });
    if (!data) return json(404, { ok: false, message: "Job not found" });

    return json(200, { ok: true, job: data });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
