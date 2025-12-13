// supabase/functions/dispatch-touch-smart-router/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-smart-router-v3_2025-12-09"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  // Env
  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "env",
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  // Body
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const lead_id = body?.lead_id as string | undefined
  const step = Number(body?.step ?? 1)
  const dryRun = Boolean(body?.dry_run ?? true)

  if (!lead_id) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "input",
        error: "lead_id is required",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // 1) Recuperar el último touch_runs de ese lead + step
  const { data: lastTouch, error: ltErr } = await supabase
    .from("touch_runs")
    .select(
      "id, campaign_id, campaign_run_id, lead_id, step, channel, payload, account_id, message_class, created_at",
    )
    .eq("lead_id", lead_id)
    .eq("step", step)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (ltErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "load_last_touch",
        error: ltErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  if (!lastTouch) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "load_last_touch",
        error: "No touch_runs found for this lead_id + step",
      }),
      {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // 2) Llamar a la función SQL decide_next_channel_for_lead
  const { data: decisions, error: dErr } = await supabase.rpc(
    "decide_next_channel_for_lead",
    {
      p_lead_id: lead_id,
      p_step: step,
    },
  )

  if (dErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "decide_next_channel",
        error: dErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  if (!decisions || decisions.length === 0) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "decide_next_channel",
        error: "No decision returned from decide_next_channel_for_lead",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const decisionRow = decisions[0] as {
    lead_id: string
    step: number
    current_channel: string
    decision: string
    next_channel: string | null
    attempts_done: number
    attempts_allowed: number
    cooldown_minutes: number | null
    last_attempt_at: string | null
    cooldown_until: string | null
  }

  const decision = decisionRow.decision
  const nextChannel = decisionRow.next_channel || decisionRow.current_channel

  // 3) Si la decisión es STOP o WAIT_COOLDOWN → no creamos nada
  if (decision === "stop" || decision === "wait_cooldown") {
    try {
      await logEvaluation(supabase, {
        lead_id,
        event_source: "router",
        label: "router_decision_no_touch",
        kpis: {
          step,
          attempts_done: decisionRow.attempts_done,
          attempts_allowed: decisionRow.attempts_allowed,
        },
        notes: `decision=${decision} next_channel=${nextChannel}`,
      })
    } catch (e) {
      console.error("logEvaluation router (no_touch) error:", e)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        lead_id,
        step,
        decision,
        next_channel: nextChannel,
        created_touch: false,
        dry_run: dryRun,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 4) Para retry_same_channel o switch_channel → creamos un nuevo touch_runs
  if (!nextChannel) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "build_next_touch",
        error: "next_channel is null for decision that requires touch",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const now = new Date()
  const scheduledAt = new Date(now.getTime() - 60_000).toISOString()

  const lastPayload = (lastTouch.payload ?? {}) as any
  const routing = {
    ...(lastPayload.routing ?? {}),
    current_channel: nextChannel,
  }

  const newPayload = {
    ...lastPayload,
    routing,
  }

  const insertBody: any = {
    campaign_id: lastTouch.campaign_id,
    campaign_run_id: lastTouch.campaign_run_id,
    lead_id: lastTouch.lead_id,
    step: lastTouch.step,
    channel: nextChannel,
    payload: newPayload,
    scheduled_at: scheduledAt,
    status: "queued",
    account_id: lastTouch.account_id,
    message_class: lastTouch.message_class,
    meta: {
      ...(lastPayload.meta ?? {}),
      router_version: VERSION,
      previous_touch_id: lastTouch.id,
      router_decision: decision,
    },
  }

  let newTouchId: string | null = null

  if (!dryRun) {
    const { data: inserted, error: iErr } = await supabase
      .from("touch_runs")
      .insert(insertBody)
      .select("id")
      .single()

    if (iErr) {
      return new Response(
        JSON.stringify({
          ok: false,
          version: VERSION,
          stage: "insert_touch_run",
          error: iErr.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      )
    }

    newTouchId = inserted?.id ?? null
  }

  // 5) Log de evaluación
  try {
    await logEvaluation(supabase, {
      lead_id,
      event_source: "router",
      label: "router_decision_touch_created",
      kpis: {
        step,
        attempts_done: decisionRow.attempts_done,
        attempts_allowed: decisionRow.attempts_allowed,
      },
      notes: `decision=${decision} next_channel=${nextChannel} dry_run=${dryRun}`,
    })
  } catch (e) {
    console.error("logEvaluation router (touch_created) error:", e)
  }

  // 6) Respuesta final
  return new Response(
    JSON.stringify({
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
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})
