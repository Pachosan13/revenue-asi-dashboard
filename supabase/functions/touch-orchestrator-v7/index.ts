export const config = {
  verify_jwt: false,
}

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "touch-orchestrator-v7_2025-12-15_routingdecision"

const DEFAULT_FALLBACK_ORDER = ["voice", "whatsapp", "sms", "email"]
const DEFAULT_MAX_ATTEMPTS = { voice: 2, whatsapp: 2, sms: 2, email: 2 }
const DEFAULT_COOLDOWNS = { voice: 120, whatsapp: 120, sms: 120, email: 120 }

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function toLower(v: any) {
  return String(v ?? "").trim().toLowerCase()
}

function json(res: any, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

async function logEvalSafe(supabase: any, payload: any) {
  try {
    await (logEvaluation as any)(supabase, payload)
  } catch (_) {
    try {
      await (logEvaluation as any)({ supabase, ...payload })
    } catch (_2) {}
  }
}

function buildRoutingBaseline(args: {
  channel: string
  decision: string
  current_channel?: string
  next_channel?: string | null
}) {
  const current_channel = args.current_channel ?? args.channel
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
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, version: VERSION, error: "POST only" }, 405)

    const REVENUE_SECRET = Deno.env.get("REVENUE_SECRET")

if (!REVENUE_SECRET) {
  return json(
    { ok: false, version: VERSION, error: "REVENUE_SECRET not configured" },
    500
  )
}

const incomingSecret = req.headers.get("x-revenue-secret")

if (incomingSecret !== REVENUE_SECRET) {
  return json(
    { ok: false, version: VERSION, error: "unauthorized" },
    401
  )
}

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!SB_URL || !SB_KEY) {
    return json(
      { ok: false, version: VERSION, stage: "env", error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" },
      500,
    )
  }

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

  const body = await req.json().catch(() => ({}))
  const limit = Math.min(Math.max(Number(body.limit ?? 20), 1), 200)
  const dryRun = Boolean(body.dry_run ?? false)

  // 1) campaign_leads activos
  const { data: enrolled, error: eErr } = await supabase
    .from("campaign_leads")
    .select("campaign_id, lead_id, enrolled_at, status, account_id")
    .eq("status", "active")
    .order("enrolled_at", { ascending: true })
    .limit(limit)

  if (eErr) return json({ ok: false, version: VERSION, stage: "select_campaign_leads", error: eErr.message }, 500)

  if (!enrolled?.length) {
    const result = { ok: true, version: VERSION, processed_leads: 0, inserted: 0, dry_run: dryRun, errors: [], note: "no active enrolled leads" }
    await logEvalSafe(supabase, {
      scope: "system",
      label: "touch_orchestrator_v7_run",
      kpis: { processed_leads: 0, inserted: 0, errors_count: 0, dry_run_runs: dryRun ? 1 : 0 },
      notes: "Run without active enrolled leads",
    })
    return json(result)
  }

  // 2) campaigns únicas
  const campaignIds = [...new Set(enrolled.map((r: any) => r.campaign_id).filter(Boolean))]
  if (!campaignIds.length) {
    return json({ ok: true, version: VERSION, processed_leads: enrolled.length, inserted: 0, dry_run: dryRun, errors: [], note: "no campaign_ids in enrolled rows" })
  }

  // 3) steps por campaign
  const { data: steps, error: sErr } = await supabase
    .from("campaign_steps")
    .select("id, campaign_id, step, channel, delay_minutes, payload, is_active")
    .in("campaign_id", campaignIds)
    .eq("is_active", true)
    .order("step", { ascending: true })

  if (sErr) return json({ ok: false, version: VERSION, stage: "select_campaign_steps", error: sErr.message }, 500)

  const stepsByCampaign = new Map<string, any[]>()
  for (const st of steps ?? []) {
    if (!st?.campaign_id) continue
    if (!stepsByCampaign.has(st.campaign_id)) stepsByCampaign.set(st.campaign_id, [])
    stepsByCampaign.get(st.campaign_id)!.push(st)
  }

  // 4) batch lookup lead state + account_id
  const leadIds = [...new Set(enrolled.map((r: any) => r.lead_id).filter(Boolean))]
  const { data: leadRows, error: lErr } = await supabase
    .from("leads")
    .select("id, state, status, account_id")
    .in("id", leadIds)

  if (lErr) return json({ ok: false, version: VERSION, stage: "select_leads_state", error: lErr.message }, 500)

  const leadInfo = new Map<string, { lead_state: string; account_id: string | null }>()
  for (const r of leadRows ?? []) {
    const st = toLower((r as any).state ?? (r as any).status ?? "")
    leadInfo.set((r as any).id, { lead_state: st, account_id: (r as any).account_id ?? null })
  }

  const futureApptCache = new Map<string, boolean>()

  let inserted = 0
  const errors: any[] = []
  const nowMs = Date.now()

  for (const row of enrolled) {
    if (!row?.lead_id || !row?.campaign_id) continue

    const info = leadInfo.get(row.lead_id)
    const lead_state = info?.lead_state ?? ""
    if (lead_state === "dead") continue

    const account_id = row.account_id ?? info?.account_id ?? null
    if (!account_id) {
      errors.push({ lead_id: row.lead_id, campaign_id: row.campaign_id, error: "missing_account_id" })
      continue
    }

    // stop si tiene cita futura
    let hasFuture = futureApptCache.get(row.lead_id)
    if (hasFuture === undefined) {
      const { data: fa, error: faErr } = await supabase
        .from("v_lead_has_future_appointment")
        .select("lead_id")
        .eq("lead_id", row.lead_id)
        .limit(1)

      hasFuture = !faErr && !!fa && fa.length > 0
      futureApptCache.set(row.lead_id, hasFuture)
    }
    if (hasFuture) continue

    const campaignSteps = stepsByCampaign.get(row.campaign_id) || []
    if (!campaignSteps.length) continue

    const enrolledAtMs = row.enrolled_at ? new Date(row.enrolled_at).getTime() : nowMs

    // dedupe por activos (para no romper ux_touch_runs_active_dedupe*)
    const stepNums = [...new Set(campaignSteps.map((s: any) => Number(s.step ?? 1)))]
    const channels = [...new Set(campaignSteps.map((s: any) => toLower(s.channel)).filter(Boolean))]

    const { data: existingActive, error: xErr } = await supabase
      .from("touch_runs")
      .select("step, channel, status")
      .eq("account_id", account_id)
      .eq("lead_id", row.lead_id)
      .eq("campaign_id", row.campaign_id)
      .in("step", stepNums)
      .in("channel", channels)
      .in("status", ["queued", "scheduled", "executing"])

    if (xErr) {
      errors.push({ lead_id: row.lead_id, campaign_id: row.campaign_id, error: xErr.message })
      continue
    }

    const activeKey = new Set((existingActive ?? []).map((r: any) => `${Number(r.step)}:${toLower(r.channel)}`))

    const toUpsert: any[] = []

    for (const st of campaignSteps) {
      const channel = toLower(st.channel)
      if (!channel) continue

      const stepNum = Number(st.step ?? 1)
      const k = `${stepNum}:${channel}`
      if (activeKey.has(k)) continue

      const delayMin = Number(st.delay_minutes ?? 0)
      const scheduledAtMs = enrolledAtMs + delayMin * 60_000
      const scheduledAtIso = new Date(scheduledAtMs).toISOString()
      const status = scheduledAtMs <= nowMs ? "queued" : "scheduled"

      const basePayload = (st.payload ?? {}) as any
      const routing = buildRoutingBaseline({
        channel,
        decision: status === "queued" ? "touch_queued" : "touch_scheduled",
        current_channel: channel,
        next_channel: channel,
      })

      const payload = { ...(basePayload ?? {}), ...(routing ?? {}) }

      const meta = {
        orchestrator: VERSION,
        lead_state,
        routing: payload.routing,
      }

      toUpsert.push({
        account_id,
        campaign_id: row.campaign_id,
        campaign_run_id: null, // consistente con tu dedupe COALESCE
        lead_id: row.lead_id,
        step: stepNum,
        channel,
        status,
        scheduled_at: scheduledAtIso,
        payload,
        error: null,
        meta,
      })
    }

    if (!toUpsert.length) continue

    if (!dryRun) {
      const { error: upErr } = await supabase
        .from("touch_runs")
        .upsert(toUpsert, { onConflict: "lead_id,campaign_id,step,channel", ignoreDuplicates: true })

      if (upErr) {
        errors.push({ lead_id: row.lead_id, campaign_id: row.campaign_id, error: upErr.message })
        continue
      }
    }

    inserted += toUpsert.length
  }

  const result = { ok: true, version: VERSION, processed_leads: enrolled.length, inserted, dry_run: dryRun, errors }

  await logEvalSafe(supabase, {
    scope: "system",
    label: "touch_orchestrator_v7_run",
    kpis: { processed_leads: enrolled.length, inserted, errors_count: errors.length, dry_run_runs: dryRun ? 1 : 0 },
    notes: errors.length ? `Run completed with ${errors.length} errors` : "Run completed without errors",
  })

  return json(result)
})
