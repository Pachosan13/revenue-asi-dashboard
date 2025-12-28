// supabase/functions/lead-hunter-tick/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";

/* =========================
   ENV
========================= */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
}

const REST = `${SUPABASE_URL}/rest/v1`;
const FN_BASE = `${SUPABASE_URL}/functions/v1`;

/* =========================
   Auth (internal only)
========================= */
function getBearer(req: Request) {
  const h = req.headers.get("authorization") || "";
  const m = h.match(/bearer\s+(.+)/i);
  return (m?.[1] || "").trim();
}

function assertInternalAuth(req: Request) {
  const bearer = getBearer(req);
  const apikey = (req.headers.get("apikey") || "").trim();
  if (bearer === SERVICE_ROLE_KEY) return;
  if (apikey === SERVICE_ROLE_KEY) return;
  throw new Error("Unauthorized");
}

/* =========================
   REST helper
========================= */
async function restJson(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("apikey", SERVICE_ROLE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`);

  const res = await fetch(`${REST}${path}`, { ...init, headers });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function fnJson(fnName: string, body: Record<string, any>) {
  const res = await fetch(`${FN_BASE}/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`${fnName} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/* =========================
   Types
========================= */
type Job = {
  id: string;
  account_id: string | null;
  niche: string;
  status: string;
  geo: string;
  keywords: string[];
  meta: Record<string, any>;
  target_leads: number;
};

/* =========================
   Campaign guard (key)
========================= */
async function isCampaignActiveByKey(account_id: string, campaign_key: string): Promise<boolean> {
  const data = await restJson("/rpc/is_campaign_active", {
    method: "POST",
    body: JSON.stringify({ p_account_id: account_id, p_campaign_key: campaign_key }),
  });
  return Boolean(data);
}

/* =========================
   RPC wrappers
========================= */
async function claimNextJob(args: {
  worker_id: string;
  source?: string | null;
  niche?: string | null;
}): Promise<Job | null> {
  // public.claim_next_job expects jsonb param "p"
  const data = await restJson("/rpc/claim_next_job", {
    method: "POST",
    body: JSON.stringify({
      p: {
        worker_id: args.worker_id,
        source: args.source ?? undefined,
        niche: args.niche ?? undefined,
      },
    }),
  });
  return data as Job | null;
}

async function patchJob(jobId: string, patch: Record<string, any>): Promise<Job> {
  // public.patch_job(p_job_id uuid, p_patch jsonb)
  const data = await restJson("/rpc/patch_job", {
    method: "POST",
    body: JSON.stringify({ p_job_id: jobId, p_patch: patch }),
  });
  return data as Job;
}

/* =========================
   Source routers (workers)
========================= */
async function runEncuentra24(params: {
  account_id: string;
  job_id: string;
  niche: string;
  page: number;
}) {
  return await fnJson("lead-hunter-encuentra24", params);
}

async function runMapsCollector(params: {
  account_id: string;
  job_id: string;
  niche: string;
  geo: string;
  keywords: string[];
  cursor: number;
}) {
  return await fnJson("lh_collect_maps", params);
}

async function runEnrichmentHandoff(params: {
  account_id: string;
  job_id: string;
  niche: string;
}) {
  return await fnJson("lh_normalize_score_handoff", params);
}

/* =========================
   Main
========================= */
serve(async (req) => {
  try {
    assertInternalAuth(req);

    const body = await req.json().catch(() => ({}));

    const worker_id = String(body.worker_id || "w1");
    const source = body.source ? String(body.source) : null; // optional filter
    const niche = body.niche ? String(body.niche) : null; // optional filter

    // 1) claim (multi-vertical)
    const job = await claimNextJob({ worker_id, source, niche });
    if (!job) {
      return new Response(JSON.stringify({ ok: true, message: "No queued job", worker_id, source, niche }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 2) validate
    if (!job.account_id) {
      await patchJob(job.id, {
        status: "queued",
        meta: {
          ...(job.meta || {}),
          last_error: "job.account_id is null (hard fail)",
          last_heartbeat_at: new Date().toISOString(),
          worker_id,
        },
      });

      return new Response(JSON.stringify({ ok: false, error: "Job has null account_id", job_id: job.id }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    // ===== GUARD (campaign ON/OFF) =====
    const jobSource = String(job.meta?.source || source || "encuentra24");
    const campaign_key =
      String(job.meta?.campaign_key || "").trim() ||
      `${jobSource}.${job.niche || "autos"}`; // fallback

    const active = await isCampaignActiveByKey(job.account_id, campaign_key);
    if (!active) {
      // don’t burn job, keep it queued so it resumes when activated
      await patchJob(job.id, {
        status: "queued",
        meta: {
          ...(job.meta || {}),
          worker_id,
          last_heartbeat_at: new Date().toISOString(),
          last_skip_reason: "campaign_paused",
          campaign_key,
        },
      });

      return new Response(JSON.stringify({ ok: true, skipped: "campaign_paused", job_id: job.id, campaign_key }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    // ===== END GUARD =====

    const cursor = Number(job.meta?.cursor || 1);
    const page = cursor > 0 ? cursor : 1;

    // 3) mark running
    await patchJob(job.id, {
      status: "running",
      meta: { ...(job.meta || {}), worker_id, last_heartbeat_at: new Date().toISOString(), campaign_key },
    });

    // 4) run by source
    let run: any = null;
    let inserted = 0;
    let skipped = 0;
    let count_listings = 0;
    let done = false;
    let nextCursor: number | null = null;

    if (jobSource === "encuentra24") {
      run = await runEncuentra24({
        account_id: job.account_id,
        job_id: job.id,
        niche: job.niche || "autos",
        page,
      });

      inserted = Number(run?.inserted || 0);
      skipped = Number(run?.skipped || 0);
      count_listings = Number(run?.count_listings || 0);
      done = count_listings === 0;

      nextCursor = done ? page : page + 1;
    } else if (jobSource === "maps") {
      run = await runMapsCollector({
        account_id: job.account_id,
        job_id: job.id,
        niche: job.niche,
        geo: job.geo,
        keywords: Array.isArray(job.keywords) ? job.keywords : [],
        cursor: Number(job.meta?.cursor || 0),
      });

      inserted = Number(run?.inserted || 0);
      skipped = Number(run?.skipped || 0);
      done = Boolean(run?.done || false);
      nextCursor = Number.isFinite(Number(run?.cursor))
        ? Number(run?.cursor)
        : Number(job.meta?.cursor || 0) + 1;

      count_listings = Number(run?.count_listings || 0);
    } else {
      await patchJob(job.id, {
        status: "queued",
        meta: {
          ...(job.meta || {}),
          last_error: `unknown source: ${jobSource}`,
          last_heartbeat_at: new Date().toISOString(),
          worker_id,
        },
      });

      return new Response(JSON.stringify({ ok: false, job_id: job.id, error: `unknown source: ${jobSource}` }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 5) Handoff into Revenue ASI brain (score/enrich pipeline)
    let handoff_ok = false;
    let handoff_error: string | null = null;

    if (inserted > 0) {
      try {
        await runEnrichmentHandoff({
          account_id: job.account_id,
          job_id: job.id,
          niche: job.niche,
        });
        handoff_ok = true;
      } catch (e) {
        handoff_ok = false;
        handoff_error = String(e);
        console.error("handoff failed:", handoff_error);
      }
    }

    // 6) progress accounting
    const prev = (job.meta?.progress || {}) as Record<string, any>;
    const nextProgress = {
      ...prev,
      runs: (prev.runs || 0) + 1,
      leads_inserted: (prev.leads_inserted || 0) + inserted,
      leads_skipped: (prev.leads_skipped || 0) + skipped,
      last_run: {
        at: new Date().toISOString(),
        cursor: job.meta?.cursor ?? null,
        page: jobSource === "encuentra24" ? page : undefined,
        inserted,
        skipped,
        count_listings,
        source: jobSource,
      },
    };

    // 7) patch final state
    const patched = await patchJob(job.id, {
      status: done ? "done" : "queued",
      meta: {
        ...(job.meta || {}),
        cursor: nextCursor ?? job.meta?.cursor ?? 0,
        progress: nextProgress,
        last_heartbeat_at: new Date().toISOString(),
        worker_id,
        campaign_key,
        last_handoff: inserted > 0 ? { ok: handoff_ok, error: handoff_error } : undefined,
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        job_id: job.id,
        status: patched.status,
        source: jobSource,
        campaign_key,
        cursor_in: job.meta?.cursor ?? null,
        cursor_out: nextCursor,
        page: jobSource === "encuentra24" ? page : undefined,
        inserted,
        skipped,
        count_listings,
        done,
        handoff_ok,
        handoff_error,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    const msg = String(e?.message || e);
    const status = msg === "Unauthorized" ? 401 : 500;
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
});

export const config = {
  verify_jwt: false,
};
