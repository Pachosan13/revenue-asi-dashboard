// supabase/functions/run-cadence/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "run-cadence-v5_2025-12-13_deadstop"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

  let body: any = {}
  try { body = await req.json() } catch { body = {} }

  const campaign_id = body?.campaign_id
  const debug = body?.debug === true
  if (!campaign_id) {
    return new Response(
      JSON.stringify({ ok: false, version: VERSION, error: "campaign_id required" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  const nowIso = new Date().toISOString()

  // 1) campaign
  const { data: campaign, error: cErr } = await supabase
    .from("campaigns")
    .select("id,status,account_id")
    .eq("id", campaign_id)
    .maybeSingle()

  if (cErr || !campaign) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "load_campaign",
        error: cErr?.message ?? "campaign not found",
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  if ((campaign.status ?? "").toLowerCase() !== "active") {
    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        runs_created: 0,
        leads_seen: 0,
        queued: 0,
        errors: [],
        debug,
        note: "campaign not active; skipping",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 2) cadence
  const { data: touches, error: tErr } = await supabase
    .from("touches")
    .select("id, step, channel, payload")
    .order("step", { ascending: true })

  if (tErr) {
    return new Response(
      JSON.stringify({ ok: false, version: VERSION, stage: "load_touches", error: tErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  const cadence =
    (touches ?? []).length > 0
      ? touches!
      : [
          {
            id: null,
            step: 1,
            channel: "voice",
            payload: {
              script:
                "Hey {{first_name}}, voy rápido — te contacto porque vimos tu empresa y estamos ayudando negocios como el tuyo a generar 10–20 clientes nuevos al mes con automatización real.",
            },
          },
        ]

  const ELASTIC_API_KEY =
    (Deno.env.get("ELASTIC_EMAIL_API_KEY") ?? "").trim() ||
    (Deno.env.get("ELASTICEMAIL_API_KEY") ?? "").trim()
  const ELASTIC_FROM = (Deno.env.get("ELASTIC_EMAIL_FROM") ?? "").trim()
  const EMAIL_READY = Boolean(ELASTIC_API_KEY && ELASTIC_FROM)

  const cadenceFiltered = EMAIL_READY
    ? cadence
    : cadence.filter((t: any) => String(t?.channel ?? "").toLowerCase().trim() !== "email")

  // 3) leads elegibles (dead=stop, phone required, account required)
  const { data: leads, error: lErr } = await supabase
    .from("leads")
    .select("id, phone, status, account_id, lead_state")
    .eq("status", "new")
    .not("phone", "is", null)
    .not("account_id", "is", null)
    .neq("lead_state", "dead")
    .limit(200)

  if (lErr) {
    return new Response(
      JSON.stringify({ ok: false, version: VERSION, stage: "load_leads", error: lErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  const leads_seen = leads?.length ?? 0
  if (!leads_seen) {
    try {
      await logEvaluation(supabase, {
        event_source: "cadence",
        label: "run_cadence_v5",
        kpis: { campaign_id, leads_seen: 0, queued: 0 },
        notes: "No eligible leads (dead/phone/account filtered)",
      })
    } catch (_) {}

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        runs_created: 0,
        leads_seen: 0,
        queued: 0,
        errors: [],
        debug,
        note: "no eligible leads",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 4) campaign_run
  const { data: run, error: rErr } = await supabase
    .from("campaign_runs")
    .insert({ campaign_id, status: "running", started_at: nowIso, meta: {} })
    .select("id")
    .single()

  if (rErr || !run) {
    return new Response(
      JSON.stringify({ ok: false, version: VERSION, stage: "create_run", error: rErr?.message ?? "run insert failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 5) build inserts + dedupe básico (evitar duplicar queued/scheduled)
  // (si tu schema ya dedupea con unique index, esto igual ayuda)
  const leadIds = (leads ?? []).map((l: any) => l.id)
  const { data: existing, error: xErr } = await supabase
    .from("touch_runs")
    .select("lead_id, step, channel, status")
    .in("lead_id", leadIds)
    .in("status", ["queued", "scheduled", "executing"])

  if (xErr) {
    return new Response(
      JSON.stringify({ ok: false, version: VERSION, stage: "load_existing_touch_runs", error: xErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  const existingKey = new Set((existing ?? []).map((r: any) => `${r.lead_id}:${r.step}:${r.channel}`))

  const inserts: any[] = []
  for (const lead of leads ?? []) {
    for (const touch of cadenceFiltered) {
      const step = Number(touch.step ?? 1)
      const channel = String(touch.channel ?? "whatsapp").toLowerCase()
      const key = `${lead.id}:${step}:${channel}`
      if (existingKey.has(key)) continue

      inserts.push({
        campaign_id,
        campaign_run_id: run.id,
        lead_id: lead.id,
        step,
        channel,
        payload: touch.payload ?? {},
        scheduled_at: nowIso,
        status: "queued",
        account_id: (lead as any).account_id ?? campaign.account_id ?? null,
        meta: { source: VERSION },
      })
    }
  }

  if (!inserts.length) {
    try {
      await logEvaluation(supabase, {
        event_source: "cadence",
        label: "run_cadence_v5",
        kpis: { campaign_id, leads_seen, queued: 0 },
        notes: "No inserts (all deduped)",
      })
    } catch (_) {}

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        runs_created: 1,
        leads_seen,
        queued: 0,
        errors: [],
        debug,
        note: "all deduped",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  const { error: insErr } = await supabase.from("touch_runs").insert(inserts)
  if (insErr) {
    return new Response(
      JSON.stringify({ ok: false, version: VERSION, stage: "insert_touch_runs", error: insErr.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  try {
    await logEvaluation(supabase, {
      event_source: "cadence",
      label: "run_cadence_v5",
      kpis: { campaign_id, leads_seen, queued: inserts.length },
      notes: debug ? "debug=true" : "ok",
    })
  } catch (_) {}

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      runs_created: 1,
      leads_seen,
      queued: inserts.length,
      errors: [],
      debug,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})
