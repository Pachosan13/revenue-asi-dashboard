// supabase/functions/run-cadence/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "run-cadence-v4_2025-11-23"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
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

  const campaign_id = body?.campaign_id
  const debug = body?.debug === true

  if (!campaign_id) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        error: "campaign_id required",
      }),
      {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // 1) Verifica campaña existe y está active
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
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
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

  // 2) Cargar touches GLOBAL (NO por campaña)
  const { data: touches, error: tErr } = await supabase
    .from("touches")
    .select("id, step, channel, payload")
    .order("step", { ascending: true })

  if (tErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "load_touches",
        error: tErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
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
              voice_id: (process as any)?.env?.REVENUE_ASI_ELEVEN_VOICE_ID,
              render_webhook: (process as any)?.env?.REVENUE_ASI_VOICE_WEBHOOK,
            },
          },
        ]

  // 3) Traer leads elegibles (versión simple por ahora)
  const { data: leads, error: lErr } = await supabase
    .from("leads")
    .select("id, phone, status, account_id")
    .eq("status", "new")
    .not("phone", "is", null)
    .limit(200)

  if (lErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "load_leads",
        error: lErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const leads_seen = leads?.length ?? 0

  if (!leads_seen) {
    // No leads → igual loggeamos evaluación
    try {
      await logEvaluation(supabase, {
        event_source: "cadence",
        label: "run_cadence_v4",
        kpis: {
          campaign_id,
          leads_seen: 0,
          queued: 0,
        },
        notes: "No leads available",
      })
    } catch (e) {
      console.error("logEvaluation failed in run-cadence (no leads)", e)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        runs_created: 0,
        leads_seen: 0,
        queued: 0,
        errors: [],
        debug,
        note: "no leads",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 4) Crear campaign_run
  const nowIso = new Date().toISOString()
  const { data: run, error: rErr } = await supabase
    .from("campaign_runs")
    .insert({
      campaign_id,
      status: "running",
      started_at: nowIso,
      meta: {},
    })
    .select("id")
    .single()

  if (rErr || !run) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "create_run",
        error: rErr?.message ?? "run insert failed",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // 5) Insertar touch_runs
  const inserts: any[] = []
  for (const lead of leads ?? []) {
    for (const touch of cadence) {
      inserts.push({
        campaign_id,
        campaign_run_id: run.id,
        lead_id: lead.id,
        step: touch.step ?? 1,
        channel: touch.channel ?? "whatsapp",
        payload: touch.payload ?? {},
        scheduled_at: nowIso,
        status: "queued",
        account_id: (lead as any).account_id ?? campaign.account_id ?? null,
      })
    }
  }

  const { error: insErr } = await supabase
    .from("touch_runs")
    .insert(inserts)

  if (insErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "insert_touch_runs",
        error: insErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // 6) Log en core_memory_events / eval (best-effort)
  try {
    await logEvaluation(supabase, {
      event_source: "cadence",
      label: "run_cadence_v4",
      kpis: {
        campaign_id,
        leads_seen,
        queued: inserts.length,
      },
      notes: debug
        ? "run-cadence run with debug=true"
        : "run-cadence normal run",
    })
  } catch (e) {
    console.error("logEvaluation failed in run-cadence", e)
  }

  // 7) Respuesta
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
