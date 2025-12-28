import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  job_id: string;
  limit?: number;
  dry_run?: boolean;
};

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const job_id = String(body.job_id || "").trim();
    if (!job_id) throw new Error("Missing job_id");

    const limit = Math.max(1, Math.min(Number(body.limit ?? 500), 5000));

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch } });
    const lh = supabase.schema("lead_hunter");

    // 1) confirm job exists
    const { data: job, error: jobErr } = await lh.from("jobs").select("id,status").eq("id", job_id).maybeSingle();
    if (jobErr) throw jobErr;
    if (!job) throw new Error("Job not found");

    // 2) take domains linked to this job (indirectly) by joining places_raw -> domains
    // but we don't have job_id in places_raw/domains. So: just queue from domains that are pending AND exist.
    // For now: queue all pending domains (MVP). Later we’ll tag domains with job_id.
    const { data: domains, error: dErr } = await lh
      .from("domains")
      .select("domain,status")
      .eq("status", "pending")
      .limit(limit);

    if (dErr) throw dErr;

    const toQueue = (domains ?? []).map((d) => ({
      job_id,
      domain: d.domain,
      status: "queued",
      provider: null,
      attempts: 0,
      last_error: null,
    }));

    if (!toQueue.length) {
      return new Response(JSON.stringify({ ok: true, queued: 0, reason: "no pending domains" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // upsert avoids duplicates
    const { error: upErr } = await lh
      .from("contact_reveal_tasks")
      .upsert(toQueue, { onConflict: "job_id,domain" });

    if (upErr) throw upErr;

    return new Response(JSON.stringify({ ok: true, queued: toQueue.length }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as any)?.message ?? err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
