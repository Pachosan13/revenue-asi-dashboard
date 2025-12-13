// supabase/functions/touch-orchestrator-v7/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "touch-orchestrator-v7_2025-12-10"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

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

  const body = await req.json().catch(() => ({}))
  const limit = Number(body.limit ?? 20)
  const dryRun = Boolean(body.dry_run ?? false)

  // 1) Traer campaign_leads activos
  const { data: enrolled, error: eErr } = await supabase
    .from("campaign_leads")
    .select("campaign_id, lead_id, enrolled_at, status, account_id")
    .eq("status", "active")
    .order("enrolled_at", { ascending: true })
    .limit(limit)

  if (eErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "select_campaign_leads",
        error: eErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  if (!enrolled?.length) {
    const result = {
      ok: true,
      version: VERSION,
      processed_leads: 0,
      inserted: 0,
      dry_run: dryRun,
      errors: [],
    }

    try {
      await logEvaluation(supabase, {
        scope: "system",
        label: "touch_orchestrator_v7_run",
        kpis: {
          processed_leads: 0,
          inserted: 0,
          errors_count: 0,
          dry_run_runs: dryRun ? 1 : 0,
        },
        notes: "Run without active enrolled leads",
      })
    } catch (err) {
      console.error("logEvaluation error (no leads):", err)
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    })
  }

  // 2) campaigns únicas
  const campaignIds = [...new Set(enrolled.map((r: any) => r.campaign_id))]

  // 3) steps por campaign
  const { data: steps, error: sErr } = await supabase
    .from("campaign_steps")
    .select(
      "id, campaign_id, step, channel, delay_minutes, payload, is_active",
    )
    .in("campaign_id", campaignIds)
    .eq("is_active", true)
    .order("step", { ascending: true })

  if (sErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "select_campaign_steps",
        error: sErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const stepsByCampaign = new Map<string, any[]>()
  for (const st of steps ?? []) {
    if (!stepsByCampaign.has(st.campaign_id)) {
      stepsByCampaign.set(st.campaign_id, [])
    }
    stepsByCampaign.get(st.campaign_id)!.push(st)
  }

  let inserted = 0
  const errors: any[] = []
  const nowMs = Date.now()

  for (const row of enrolled) {
    // 🟣 0) SKIP si el lead tiene cita futura (protección hard)
    const { data: futureAppt, error: faErr } = await supabase
      .from("v_lead_has_future_appointment")
      .select("lead_id")
      .eq("lead_id", row.lead_id)
      .limit(1)

    if (!faErr && futureAppt && futureAppt.length > 0) {
      // opcional log mini, pero sin drama
      try {
        await logEvaluation(supabase, {
          lead_id: row.lead_id,
          account_id: row.account_id,
          event_source: "orchestrator",
          label: "skip_lead_due_to_future_appointment",
          kpis: {},
          notes: "Lead tiene cita futura programada",
          meta: {
            campaign_id: row.campaign_id,
          },
        })
      } catch (logErr) {
        console.error("logEvaluation skip lead error:", logErr)
      }

      continue
    }

    const campaignSteps = stepsByCampaign.get(row.campaign_id) || []
    if (!campaignSteps.length) continue

    const enrolledAtMs = row.enrolled_at
      ? new Date(row.enrolled_at).getTime()
      : nowMs

    // 4) dedupe: revisar cola real en touch_runs
    const { data: existing, error: xErr } = await supabase
      .from("touch_runs")
      .select("step, channel")
      .eq("lead_id", row.lead_id)
      .eq("campaign_id", row.campaign_id)

    if (xErr) {
      errors.push({
        lead_id: row.lead_id,
        campaign_id: row.campaign_id,
        error: xErr.message,
      })
      continue
    }

    const existingKey = new Set(
      (existing ?? []).map((r: any) => `${r.step}:${r.channel}`),
    )

    const toInsert: any[] = []

    for (const st of campaignSteps) {
      const key = `${st.step}:${st.channel}`
      if (existingKey.has(key)) continue

      const delayMin = Number(st.delay_minutes ?? 0)
      const scheduledAtMs = enrolledAtMs + delayMin * 60_000
      const scheduledAtIso = new Date(scheduledAtMs).toISOString()
      const status = scheduledAtMs <= nowMs ? "queued" : "scheduled"

      toInsert.push({
        campaign_id: row.campaign_id,
        lead_id: row.lead_id,
        step: st.step,
        channel: st.channel,
        status,
        scheduled_at: scheduledAtIso,
        payload: st.payload ?? {},
        error: null,
        meta: { orchestrator: VERSION },
      })
    }

    if (!toInsert.length) continue

    if (!dryRun) {
      const { error: iErr } = await supabase
        .from("touch_runs")
        .insert(toInsert)

      if (iErr) {
        errors.push({
          lead_id: row.lead_id,
          campaign_id: row.campaign_id,
          error: iErr.message,
        })
        continue
      }
    }

    inserted += toInsert.length
  }

  const result = {
    ok: true,
    version: VERSION,
    processed_leads: enrolled.length,
    inserted,
    dry_run: dryRun,
    errors,
  }

  try {
    await logEvaluation(supabase, {
      scope: "system",
      label: "touch_orchestrator_v7_run",
      kpis: {
        processed_leads: enrolled.length,
        inserted,
        errors_count: errors.length,
        dry_run_runs: dryRun ? 1 : 0,
      },
      notes: errors.length
        ? `Run completed with ${errors.length} errors`
        : "Run completed without errors",
    })
  } catch (err) {
    console.error("logEvaluation error:", err)
  }

  return new Response(JSON.stringify(result), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
})
