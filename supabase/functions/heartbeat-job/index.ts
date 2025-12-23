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
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) return json(500, { error: "Missing secrets" });

    const body = await req.json().catch(() => ({} as any));
    const job_id = body.job_id as string | undefined;
    const worker_id = (body.worker_id ?? "worker-unknown") as string;

    if (!job_id) return json(400, { error: "job_id required" });

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = new Date().toISOString();

    const { data, error } = await supabase
      .schema("lead_hunter")
      .from("jobs")
      .update({ last_heartbeat_at: now, claimed_by: worker_id, updated_at: now })
      .eq("id", job_id)
      .eq("status", "running")
      .select("id,status,last_heartbeat_at,claimed_by")
      .maybeSingle();

    if (error) return json(400, { error });
    if (!data) return json(409, { ok: false, message: "Job not running or not found" });

    return json(200, { ok: true, job: data });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
