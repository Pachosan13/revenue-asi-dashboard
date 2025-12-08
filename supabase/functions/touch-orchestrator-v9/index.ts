// supabase/functions/touch-orchestrator-v9/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "touch-orchestrator-v9_2025-12-08"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders })

  if (req.method !== "POST")
    return new Response("Method not allowed", { status: 405, headers: corsHeaders })

  const SB_URL = Deno.env.get("SUPABASE_URL")!
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const supabase = createClient(SB_URL, SB_KEY)

  const body = await req.json().catch(() => ({}))
  const limit = Number(body.limit ?? 20)
  const dryRun = Boolean(body.dry_run ?? false)

  // 1) Leads inscritos en campañas
  const { data: enrolled, error: eErr } = await supabase
    .from("campaign_leads")
    .select("campaign_id, lead_id, enrolled_at, status")
    .eq("status", "active")
    .order("enrolled_at", { ascending: true })
    .limit(limit)

  if (eErr) {
    return new Response(JSON.stringify({ ok: false, stage: "select_campaign_leads", error: eErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  if (!enrolled?.length) {
    await safeEvalLog(supabase, {
      label: "touch_orchestrator_v9_run",
      kpis: { processed_leads: 0, inserted: 0 },
      notes: "Run without active leads",
    })
    return new Response(
      JSON.stringify({ ok: true, version: VERSION, processed_leads: 0, inserted: 0, dry_run: dryRun }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 2) Traer steps por campaña
  const campIds = [...new Set(enrolled.map((r: any) => r.campaign_id))]

  const { data: steps, error: sErr } = await supabase
    .from("campaign_steps")
    .select("id, campaign_id, step, channel, delay_minutes, payload, is_active")
    .in("campaign_id", campIds)
    .eq("is_active", true)
    .order("step", { ascending: true })

  if (sErr) {
    return new Response(JSON.stringify({ ok: false, stage: "select_campaign_steps", error: sErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  const stepsByCampaign = new Map<string, any[]>()
  for (const st of steps ?? []) {
    if (!stepsByCampaign.has(st.campaign_id))
      stepsByCampaign.set(st.campaign_id, [])
    stepsByCampaign.get(st.campaign_id)!.push(st)
  }

  let inserted = 0
  const errors: any[] = []
  const nowMs = Date.now()

  for (const row of enrolled as any[]) {
    const leadId = row.lead_id
    const campaignId = row.campaign_id
    const campaignSteps = stepsByCampaign.get(campaignId) || []
    if (!campaignSteps.length) continue

    // ================================================================
    // (A) — INBOUND-AWARE ENTERPRISE LOGIC
    // ================================================================
    const { data: suppression } = await supabase
      .from("lead_suppression_status_v1")
      .select("is_unsubscribed, in_negative_cooldown, skip_next_outbound, pause_until")
      .eq("lead_id", leadId)
      .maybeSingle()

    // A1) NEGATIVO → STOP permanente
    if (suppression?.is_unsubscribed) continue

    // A2) COOL-DOWN NEGATIVO (3–7 días)
    if (suppression?.in_negative_cooldown) continue

    // A3) POSITIVO → PAUSA 24h (pause_until)
    if (suppression?.pause_until && new Date(suppression.pause_until).getTime() > nowMs)
      continue

    // A4) NEUTRO → saltar SOLO el siguiente step
    const skipNext = suppression?.skip_next_outbound === true

    // ================================================================
    // (B) — DEDUPE DE TOUCHES EXISTENTES
    // ================================================================
    const { data: existing, error: xErr } = await supabase
      .from("touch_runs")
      .select("step, channel")
      .eq("lead_id", leadId)
      .eq("campaign_id", campaignId)

    if (xErr) {
      errors.push({ lead_id: leadId, campaign_id: campaignId, error: xErr.message })
      continue
    }

    const existingMap = new Set((existing ?? []).map((r: any) => `${r.step}:${r.channel}`))

    const toInsert = []
    let firstStepInserted = false

    for (const st of campaignSteps) {
      const key = `${st.step}:${st.channel}`
      if (existingMap.has(key)) continue

      // Skip inteligente del inbound neutro (solo el primer step)
      if (skipNext && !firstStepInserted) {
        firstStepInserted = true
        continue
      }

      const delay = Number(st.delay_minutes ?? 0)
      const enrolledAtMs = row.enrolled_at ? new Date(row.enrolled_at).getTime() : nowMs

      const scheduledMs = enrolledAtMs + delay * 60_000
      const scheduledIso = new Date(scheduledMs).toISOString()

      const status = scheduledMs <= nowMs ? "queued" : "scheduled"

      toInsert.push({
        lead_id: leadId,
        campaign_id: campaignId,
        step: st.step,
        channel: st.channel,
        status,
        scheduled_at: scheduledIso,
        payload: st.payload ?? {},
        meta: { orchestrator: VERSION },
        error: null,
      })
    }

    if (!toInsert.length) continue

    if (!dryRun) {
      const { error: iErr } = await supabase.from("touch_runs").insert(toInsert)
      if (iErr) {
        errors.push({ lead_id: leadId, campaign_id: campaignId, error: iErr.message })
        continue
      }
    }

    inserted += toInsert.length
  }

  // ================================================================
  // LOG EVALUATION
  // ================================================================
  await safeEvalLog(supabase, {
    label: VERSION,
    kpis: {
      processed_leads: enrolled.length,
      inserted,
      errors: errors.length,
      dry_run: dryRun ? 1 : 0,
    },
    notes: errors.length
      ? `Completed with ${errors.length} errors`
      : "Run completed OK",
  })

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      processed_leads: enrolled.length,
      inserted,
      dry_run: dryRun,
      errors,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})

// Helper para que nunca rompa el orquestador
async function safeEvalLog(supabase: any, payload: any) {
  try {
    await logEvaluation(supabase, payload)
  } catch (e) {
    console.error("logEvaluation error:", e)
  }
}
