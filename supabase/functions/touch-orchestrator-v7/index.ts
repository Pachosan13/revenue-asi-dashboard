import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEvaluation } from "../_shared/eval.ts";

const VERSION = "touch-orchestrator-v7_2025-12-15_routingdecision";

const DEFAULT_FALLBACK_ORDER = ["voice", "whatsapp", "sms", "email"];
const DEFAULT_MAX_ATTEMPTS = { voice: 2, whatsapp: 2, sms: 2, email: 2 };
const DEFAULT_COOLDOWNS = { voice: 120, whatsapp: 120, sms: 120, email: 120 };

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-revenue-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function toLower(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function json(res: any, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256HexPrefix8(input: string): Promise<string> {
  if (!input) return "";
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 8);
}

async function logEvalSafe(supabase: any, payload: any) {
  try {
    await (logEvaluation as any)(supabase, payload);
  } catch (_) {
    try {
      await (logEvaluation as any)({ supabase, ...payload });
    } catch (_2) {}
  }
}

function buildRoutingBaseline(args: {
  channel: string;
  decision: string;
  current_channel?: string;
  next_channel?: string | null;
}) {
  const current_channel = args.current_channel ?? args.channel;
  return {
    routing: {
      current_channel,
      next_channel: args.next_channel ?? null,
      decision: args.decision,
      attempts_done: null,
      attempts_allowed: null,
      cooldown_minutes: null,
      cooldown_until: null,
      fallback: {
        order: DEFAULT_FALLBACK_ORDER,
        max_attempts: DEFAULT_MAX_ATTEMPTS,
        cooldown_minutes: DEFAULT_COOLDOWNS,
      },
    },
  };
}

/* =========================
   Campaign guard (by id)
========================= */
async function isCampaignActiveById(
  supabase: any,
  account_id: string,
  campaign_id: string,
): Promise<boolean> {
  const { data, error } = await supabase.rpc("is_campaign_active_by_id", {
    p_account_id: account_id,
    p_campaign_id: campaign_id,
  });
  if (error) throw new Error(`is_campaign_active_by_id error: ${error.message}`);
  return Boolean(data);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, version: VERSION, error: "POST only" }, 405);

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_KEY = (Deno.env.get("SB_SERVICE_ROLE_KEY") ?? "").trim();
  if (!SB_URL || !SB_KEY) {
    return json(
      {
        ok: false,
        version: VERSION,
        stage: "env",
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      },
      500,
    );
  }

  // Auth:
  // - Preferred: x-revenue-secret == REVENUE_SECRET
  // - Local/dev fallback: allow service-role authenticated calls (Authorization/apikey == SB_KEY)
  const REVENUE_SECRET = (Deno.env.get("REVENUE_SECRET") ?? "").trim();
  const incomingSecret = (req.headers.get("x-revenue-secret") ?? "").trim();
  const auth = (req.headers.get("authorization") ?? "").trim();
  // Some callers send `Authorization: Bearer <token>`; accept both raw token and Bearer format.
  const bearer = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : auth.trim();
  const apiKey = (req.headers.get("apikey") ?? "").trim();

  const isServiceRoleAuthed = (bearer && bearer === SB_KEY) || (apiKey && apiKey === SB_KEY);
  const isRevenueSecretAuthed = !!REVENUE_SECRET && incomingSecret === REVENUE_SECRET;

  if (!isRevenueSecretAuthed && !isServiceRoleAuthed) {
    const hasSBKey = Boolean(SB_KEY);
    const sbKeyLen = SB_KEY.length;
    const bearerLen = bearer.length;
    const apiKeyLen = apiKey.length;
    const sbKeyHash8 = await sha256HexPrefix8(SB_KEY);
    const bearerHash8 = await sha256HexPrefix8(bearer);
    const apiKeyHash8 = await sha256HexPrefix8(apiKey);

    console.log("TOUCH_ORCH_AUTH_FAIL", {
      hasSBKey,
      sbKeyLen,
      bearerLen,
      apiKeyLen,
      isRevenueSecretAuthed,
      isServiceRoleAuthed,
      sbKeyHash8,
      bearerHash8,
      apiKeyHash8,
    });
    return json({ ok: false, version: VERSION, error: "unauthorized" }, 401);
  }

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({} as any));
  const accountId = String(body.account_id ?? "").trim();
  if (!accountId) return json({ ok: false, version: VERSION, stage: "parse_body", error: "account_id required" }, 400);

  const campaignIdFilter = String(body.campaign_id ?? "").trim();
  if (campaignIdFilter && !UUID_REGEX.test(campaignIdFilter)) {
    return json(
      { ok: false, version: VERSION, stage: "parse_body", error: "Invalid campaign_id" },
      400,
    );
  }

  const limit = Math.min(Math.max(Number(body.limit ?? 20), 1), 200);
  const dryRun = Boolean(body.dry_run ?? false);

  const nowIso = new Date().toISOString();
  const windowStartIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // 1) campaign_leads DUE + (active|enrolled)
  let enrolledQuery = supabase
    .from("campaign_leads")
    .select("id, campaign_id, lead_id, enrolled_at, next_action_at, status, account_id")
    .eq("account_id", accountId)
    .in("status", ["active", "enrolled"])
    .lte("next_action_at", nowIso)
    .order("next_action_at", { ascending: true })
    .limit(limit);

  if (campaignIdFilter) {
    enrolledQuery = enrolledQuery.eq("campaign_id", campaignIdFilter);
  }

  const { data: enrolled, error: eErr } = await enrolledQuery;

  if (eErr) return json({ ok: false, version: VERSION, stage: "select_campaign_leads", error: eErr.message }, 500);

  if (!enrolled?.length) {
    const result = {
      ok: true,
      version: VERSION,
      processed_leads: 0,
      inserted: 0,
      dry_run: dryRun,
      errors: [],
      note: "no due enrolled leads",
    };
    await logEvalSafe(supabase, {
      scope: "system",
      label: "touch_orchestrator_v7_run",
      kpis: { processed_leads: 0, inserted: 0, errors_count: 0, dry_run_runs: dryRun ? 1 : 0 },
      notes: "Run without due enrolled leads",
    });
    return json(result);
  }

  // 2) campaigns únicas
  const campaignIds = [...new Set(enrolled.map((r: any) => r.campaign_id).filter(Boolean))];
  if (!campaignIds.length) {
    return json({
      ok: true,
      version: VERSION,
      processed_leads: enrolled.length,
      inserted: 0,
      dry_run: dryRun,
      errors: [],
      note: "no campaign_ids in enrolled rows",
    });
  }

  // ===== GUARD (campaign ON/OFF) =====
  // cache per campaign_id
  const campaignActiveCache = new Map<string, boolean>();
  for (const cid of campaignIds) {
    try {
      const ok = await isCampaignActiveById(supabase, accountId, String(cid));
      campaignActiveCache.set(String(cid), ok);
    } catch (e) {
      // if guard fails, hard-fail to avoid sending while blind
      return json({ ok: false, version: VERSION, stage: "campaign_guard", error: String(e) }, 500);
    }
  }
  // ===== END GUARD =====

  // 3) steps por campaign (solo campañas activas)
  const activeCampaignIds = campaignIds.filter((cid) => campaignActiveCache.get(String(cid)) === true);
  if (!activeCampaignIds.length) {
    return json({ ok: true, version: VERSION, processed_leads: enrolled.length, inserted: 0, dry_run: dryRun, errors: [], note: "all campaigns paused" });
  }

  const { data: steps, error: sErr } = await supabase
    .from("campaign_steps")
    .select("id, campaign_id, step, channel, delay_minutes, payload, is_active")
    .in("campaign_id", activeCampaignIds)
    .eq("is_active", true)
    .order("step", { ascending: true });

  if (sErr) return json({ ok: false, version: VERSION, stage: "select_campaign_steps", error: sErr.message }, 500);

  const stepsByCampaign = new Map<string, any[]>();
  for (const st of steps ?? []) {
    if (!st?.campaign_id) continue;
    if (!stepsByCampaign.has(st.campaign_id)) stepsByCampaign.set(st.campaign_id, []);
    stepsByCampaign.get(st.campaign_id)!.push(st);
  }

  // 4) batch lookup lead state + account_id
  const leadIds = [...new Set(enrolled.map((r: any) => r.lead_id).filter(Boolean))];
  const { data: leadRows, error: lErr } = await supabase
    .from("leads")
    .select("id, account_id")
    .in("id", leadIds);

  if (lErr) return json({ ok: false, version: VERSION, stage: "select_leads_state", error: lErr.message }, 500);

  const leadInfo = new Map<string, { lead_state: string; account_id: string | null }>();
  for (const r of leadRows ?? []) {
    leadInfo.set((r as any).id, { lead_state: "", account_id: (r as any).account_id ?? null });
  }

  const futureApptCache = new Map<string, boolean>();
  const touches24hCache = new Map<string, number>();

  let inserted = 0;
  const errors: any[] = [];
  const nowMs = Date.now();

  for (const row of enrolled) {
    if (!row?.lead_id || !row?.campaign_id) continue;

    // skip paused campaigns
    if (campaignActiveCache.get(String(row.campaign_id)) !== true) continue;

    const info = leadInfo.get(row.lead_id);
    const lead_state = info?.lead_state ?? "";

    const account_id = row.account_id ?? info?.account_id ?? null;
    if (!account_id) {
      errors.push({ lead_id: row.lead_id, campaign_id: row.campaign_id, error: "missing_account_id" });
      continue;
    }

    // Anti-spam guardrail: max 3 touches / (account_id, lead_id, campaign_id) / 24h
    const touchCapKey = `${account_id}:${row.lead_id}:${row.campaign_id}`;
    let touches24h = touches24hCache.get(touchCapKey);
    if (touches24h === undefined) {
      const { count, error: tErr } = await supabase
        .from("touch_runs")
        .select("id", { head: true, count: "exact" })
        .eq("account_id", account_id)
        .eq("lead_id", row.lead_id)
        .eq("campaign_id", row.campaign_id)
        .gte("created_at", windowStartIso);

      if (tErr) {
        errors.push({
          lead_id: row.lead_id,
          campaign_id: row.campaign_id,
          error: `touches_24h_count_error: ${tErr.message}`,
        });
        continue;
      }

      touches24h = Number(count ?? 0);
      touches24hCache.set(touchCapKey, touches24h);
    }

    if (touches24h >= 3) {
      console.log("ORCH_SPAM_GUARD_LEAD_DAY_CAP", {
        account_id,
        campaign_id: row.campaign_id,
        lead_id: row.lead_id,
        touches_24h: touches24h,
        cap: 3,
      });
      continue;
    }

    // stop si tiene cita futura
    let hasFuture = futureApptCache.get(row.lead_id);
    if (hasFuture === undefined) {
      const { data: fa, error: faErr } = await supabase
        .from("v_lead_has_future_appointment")
        .select("lead_id")
        .eq("lead_id", row.lead_id)
        .limit(1);

      hasFuture = !faErr && !!fa && fa.length > 0;
      futureApptCache.set(row.lead_id, hasFuture);
    }
    if (hasFuture) continue;

    const campaignSteps = stepsByCampaign.get(row.campaign_id) || [];
    if (!campaignSteps.length) continue;

    const enrolledAtMs = row.enrolled_at ? new Date(row.enrolled_at).getTime() : nowMs;

    const stepNums = [...new Set(campaignSteps.map((s: any) => Number(s.step ?? 1)))]
      .filter((n) => Number.isFinite(n) && n >= 1 && n <= 1000);
    const channels = [...new Set(campaignSteps.map((s: any) => toLower(s.channel)).filter(Boolean))];

    const { data: existingActive, error: xErr } = await supabase
      .from("touch_runs")
      .select("step, channel, status")
      .eq("account_id", account_id)
      .eq("lead_id", row.lead_id)
      .eq("campaign_id", row.campaign_id)
      .in("step", stepNums)
      .in("channel", channels)
      .in("status", ["queued", "scheduled", "executing"]);

    if (xErr) {
      errors.push({ lead_id: row.lead_id, campaign_id: row.campaign_id, error: xErr.message });
      continue;
    }

    const activeKey = new Set((existingActive ?? []).map((r: any) => `${Number(r.step)}:${toLower(r.channel)}`));

    const toUpsert: any[] = [];

    for (const st of campaignSteps) {
      const channel = toLower(st.channel);
      if (!channel) continue;

      const stepNum = Number(st.step ?? 1);
      if (!Number.isFinite(stepNum) || stepNum < 1) continue;
      if (stepNum > 1000) {
        console.log("ORCH_STEP_CAP_SKIP", {
          account_id,
          campaign_id: row.campaign_id,
          lead_id: row.lead_id,
          step: stepNum,
          cap: 1000,
        });
        continue;
      }
      const k = `${stepNum}:${channel}`;
      if (activeKey.has(k)) continue;

      const delayMin = Number(st.delay_minutes ?? 0);
      const scheduledAtMs = enrolledAtMs + delayMin * 60_000;
      const scheduledAtIso = new Date(scheduledAtMs).toISOString();
      const status = scheduledAtMs <= nowMs ? "queued" : "scheduled";

      const basePayload = (st.payload ?? {}) as any;
      const routing = buildRoutingBaseline({
        channel,
        decision: status === "queued" ? "touch_queued" : "touch_scheduled",
        current_channel: channel,
        next_channel: channel,
      });

      const payload = { ...(basePayload ?? {}), ...(routing ?? {}) };

      const meta = {
        orchestrator: VERSION,
        lead_state,
        routing: payload.routing,
      };

      toUpsert.push({
        account_id,
        campaign_id: row.campaign_id,
        campaign_run_id: null,
        lead_id: row.lead_id,
        step: stepNum,
        channel,
        status,
        scheduled_at: scheduledAtIso,
        payload,
        error: null,
        meta,
      });
    }

    if (!toUpsert.length) continue;

    if (!dryRun) {
      const { error: upErr } = await supabase
        .from("touch_runs")
        .upsert(toUpsert, { onConflict: "lead_id,campaign_id,step,channel", ignoreDuplicates: true });

      if (upErr) {
        errors.push({ lead_id: row.lead_id, campaign_id: row.campaign_id, error: upErr.message });
        continue;
      }
    }

    inserted += toUpsert.length;
  }

  const result = { ok: true, version: VERSION, processed_leads: enrolled.length, inserted, dry_run: dryRun, errors };

  await logEvalSafe(supabase, {
    scope: "system",
    label: "touch_orchestrator_v7_run",
    kpis: { processed_leads: enrolled.length, inserted, errors_count: errors.length, dry_run_runs: dryRun ? 1 : 0 },
    notes: errors.length ? `Run completed with ${errors.length} errors` : "Run completed without errors",
  });

  return json(result);
});

export const config = {
  verify_jwt: false,
};
