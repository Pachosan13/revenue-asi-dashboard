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
    const status = body.status as "done" | "failed" | undefined;
    const error_msg = (body.error ?? null) as string | null;
    const progress = (body.progress ?? null) as Record<string, unknown> | null;

    if (!job_id) return json(400, { error: "job_id required" });
    if (!status || (status !== "done" && status !== "failed")) {
      return json(400, { error: "status must be 'done' or 'failed'" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const now = new Date().toISOString();

    const patch: any = {
      status,
      updated_at: now,
      last_heartbeat_at: now,
      error: status === "failed" ? (error_msg ?? "unknown error") : null,
    };

    if (progress) patch.progress = progress;

    const { data, error } = await supabase
      .schema("lead_hunter")
      .from("jobs")
      .update(patch)
      .eq("id", job_id)
      .select("id,status,error,progress,updated_at")
      .maybeSingle();

    if (error) return json(400, { error });
    if (!data) return json(404, { ok: false, message: "Job not found" });

    return json(200, { ok: true, job: data });
  } catch (e) {
    return json(500, { error: String(e) });
  }
});
