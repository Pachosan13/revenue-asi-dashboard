export const config = {
  verify_jwt: false,
}

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-smart-router-v3_2025-12-15_write_routing"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(res: any, status = 200) {
  return new Response(JSON.stringify(res), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
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
    return json({ ok: false, version: VERSION, stage: "env", error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

  const body = await req.json().catch(() => ({}))
  const lead_id = body?.lead_id as string | undefined
  const step = Number(body?.step ?? 1)
  const dryRun = Boolean(body?.dry_run ?? true)

  if (!lead_id) return json({ ok: false, version: VERSION, stage: "input", error: "lead_id is required" }, 400)

  // 1) último touch_run (por lead+step)
  const { data: lastTouch, error: ltErr } = await supabase
    .from("touch_runs")
    .select("id, campaign_id, campaign_run_id, lead_id, step, channel, payload, meta, account_id, message_class, created_at")
    .eq("lead_id", lead_id)
    .eq("step", step)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (ltErr) return json({ ok: false, version: VERSION, stage: "load_last_touch", error: ltErr.message }, 500)
  if (!lastTouch) return json({ ok: false, version: VERSION, stage: "load_last_touch", error: "No touch_runs found for this lead_id + step" }, 404)

  // 2) decisión SQL
  const { data: decisions, error: dErr } = await supabase.rpc("decide_next_channel_for_lead", {
    p_lead_id: lead_id,
    p_step: step,
  })
  if (dErr) return json({ ok: false, version: VERSION, stage: "decide_next_channel", error: dErr.message }, 500)
  if (!decisions || decisions.length === 0) return json({ ok: false, version: VERSION, stage: "decide_next_channel", error: "No decision returned" }, 500)

  const r = decisions[0] as {
    lead_id: string
    step: number
    current_channel: string
    decision: string
    next_channel: string | null
    fallback_order?: string[] | null
    max_attempts?: Record<string, number> | null
    cooldowns?: Record<string, number> | null
    attempts_done: number
    attempts_allowed: number
    cooldown_minutes: number | null
    last_attempt_at: string | null
    cooldown_until: string | null
  }

  const decision = r.decision
  const nextChannel = r.next_channel || r.current_channel

  // STOP / WAIT
  if (decision === "stop" || decision === "wait_cooldown") {
    try {
      await (logEvaluation as any)(supabase, {
        lead_id,
        event_source: "router",
        label: "router_decision_no_touch",
        kpis: { step, attempts_done: r.attempts_done, attempts_allowed: r.attempts_allowed },
        notes: `decision=${decision} next_channel=${nextChannel} cooldown_until=${r.cooldown_until ?? "null"}`,
      })
    } catch (_) {}

    // ✅ Persist decision even when no touch is created (so dashboard can show it)
try {
  const lastPayload = (lastTouch.payload ?? {}) as any
  const nextRouting = {
    ...(lastPayload.routing ?? {}),
    current_channel: decisionRow.current_channel,
    next_channel: nextChannel,
    decision,
    attempts_done: decisionRow.attempts_done,
    attempts_allowed: decisionRow.attempts_allowed,
    cooldown_minutes: decisionRow.cooldown_minutes ?? null,
    cooldown_until: decisionRow.cooldown_until ?? null,
    last_attempt_at: decisionRow.last_attempt_at ?? null,
  }

  await supabase
    .from("touch_runs")
    .update({
      payload: {
        ...lastPayload,
        routing: nextRouting,
      },
      // opcional: meta también
      meta: {
        ...(lastTouch as any).meta,
        router_version: VERSION,
      },
    })
    .eq("id", lastTouch.id)
} catch (e) {
  console.error("router: failed to persist no-touch decision", e)
}

    return json({
      ok: true,
      version: VERSION,
      lead_id,
      step,
      decision,
      next_channel: nextChannel,
      created_touch: false,
      dry_run: dryRun,
      cooldown_until: r.cooldown_until ?? null,
    })
  }

  if (!nextChannel) return json({ ok: false, version: VERSION, stage: "build_next_touch", error: "next_channel is null for decision that requires touch" }, 500)

  const nowIso = new Date().toISOString()

  const lastPayload = (lastTouch.payload ?? {}) as any
  const lastMeta = (lastTouch.meta ?? {}) as any

  const newPayload = {
    ...lastPayload,
    routing: {
      ...(lastPayload.routing ?? {}),
      current_channel: nextChannel,
      next_channel: nextChannel,
      decision,
      attempts_done: r.attempts_done,
      attempts_allowed: r.attempts_allowed,
      cooldown_minutes: r.cooldown_minutes ?? null,
      cooldown_until: r.cooldown_until ?? null,
      fallback: {
        ...(lastPayload.routing?.fallback ?? {}),
        order: r.fallback_order ?? lastPayload.routing?.fallback?.order ?? ["voice","whatsapp","sms","email"],
        max_attempts: r.max_attempts ?? lastPayload.routing?.fallback?.max_attempts ?? { voice: 2, whatsapp: 2, sms: 2, email: 2 },
        cooldown_minutes: r.cooldowns ?? lastPayload.routing?.fallback?.cooldown_minutes ?? { voice: 120, whatsapp: 120, sms: 120, email: 120 },
      },
    },
  }

  const insertBody: any = {
    account_id: lastTouch.account_id,
    campaign_id: lastTouch.campaign_id,
    campaign_run_id: lastTouch.campaign_run_id ?? null,
    lead_id: lastTouch.lead_id,
    step: lastTouch.step,
    channel: nextChannel,
    payload: newPayload,
    scheduled_at: nowIso,
    status: "queued",
    message_class: lastTouch.message_class,
    meta: {
      ...lastMeta,
      router_version: VERSION,
      previous_touch_id: lastTouch.id,
      router_decision: decision,
    },
  }

  let newTouchId: string | null = null

  if (!dryRun) {
    // ✅ si tu unique viejo está, esto evita crash; pero DEBES dropear ux_touch_runs_unique para retries reales
    const { data: ins, error: iErr } = await supabase
      .from("touch_runs")
      .upsert(insertBody, { onConflict: "lead_id,campaign_id,step,channel", ignoreDuplicates: true })
      .select("id")
      .maybeSingle()

    if (iErr) return json({ ok: false, version: VERSION, stage: "upsert_touch_run", error: iErr.message }, 500)

    newTouchId = (ins as any)?.id ?? null
  }

  try {
    await (logEvaluation as any)(supabase, {
      lead_id,
      event_source: "router",
      label: "router_decision_touch_created",
      kpis: { step, attempts_done: r.attempts_done, attempts_allowed: r.attempts_allowed },
      notes: `decision=${decision} next_channel=${nextChannel} dry_run=${dryRun}`,
    })
  } catch (_) {}

  return json({
    ok: true,
    version: VERSION,
    lead_id,
    step,
    decision,
    next_channel: nextChannel,
    created_touch: !dryRun,
    dry_run: dryRun,
    new_touch_id: newTouchId,
    insert_body: dryRun ? insertBody : undefined,
  })
})
