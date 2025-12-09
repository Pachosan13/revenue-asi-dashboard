// supabase/functions/dispatch-touch-voice/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-voice-v5_2025-12-09_multitenant"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
}

// ---------- helpers ----------
const digitsOnly = (s: string) => (s || "").replace(/[^\d+]/g, "")

function normalizePhone(raw: string, country?: string | null) {
  if (!raw) return ""
  const trimmed = raw.trim()
  if (trimmed.startsWith("+")) return trimmed

  const d = digitsOnly(trimmed).replace(/\+/g, "")
  if (!d) return ""

  const c = (country || "").toLowerCase()

  // Panamá
  if (c === "panama" || c === "pa" || d.length === 8) return `+507${d}`

  // USA/Canada
  if (d.length === 10) return `+1${d}`

  // ya trae country code
  if (d.length >= 11 && d.length <= 15) return `+${d}`

  return `+${d}`
}

async function twilioCall(opts: {
  to: string
  sid: string
  token: string
  from: string
  twimlUrl: string
}) {
  const body = new URLSearchParams({
    To: opts.to,
    From: opts.from,
    Url: opts.twimlUrl,
  })

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${opts.sid}/Calls.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${opts.sid}:${opts.token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    },
  )
  if (!res.ok) throw new Error(await res.text())
  return await res.json()
}

// ---------- handler ----------
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
        error: "Missing Supabase env vars",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  // Twilio global env (por ahora usamos uno global aunque el switch es por cuenta)
  const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || ""
  const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || ""
  const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER") || ""

  const PUBLIC_BASE_URL = Deno.env.get("PUBLIC_BASE_URL") || SB_URL
  const VOICE_WEBHOOK_PATH =
    Deno.env.get("VOICE_WEBHOOK_PATH") || "voice-webhook"

  const DRY_RUN = (Deno.env.get("DRY_RUN") || "false") === "true"

  const DEFAULT_VOICE_ID =
    Deno.env.get("REVENUE_ASI_ELEVEN_VOICE_ID") || ""
  const DEFAULT_RENDER_WEBHOOK =
    Deno.env.get("REVENUE_ASI_VOICE_WEBHOOK") || ""

  // body limit
  let limit = 20
  try {
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}))
      if (typeof b.limit === "number" && b.limit > 0) {
        limit = Math.min(100, b.limit)
      }
    }
  } catch (_) {
    // ignore
  }

  // 1) traer candidatos queued/scheduled (ahora con account_id)
  const { data: candidates, error: cErr } = await supabase
    .from("touch_runs")
    .select("id, lead_id, account_id, payload, step, created_at, scheduled_at")
    .eq("channel", "voice")
    .in("status", ["queued", "scheduled"])
    .lte("scheduled_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit)

  if (cErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "select_candidates",
        error: cErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const ids = (candidates || []).map((r) => r.id)

  if (ids.length === 0) {
    // log best-effort cuando no hay nada que procesar
    try {
      await logEvaluation({
        supabase,
        event_type: "evaluation",
        actor: "dispatcher",
        label: "dispatch_touch_voice_v5",
        kpis: {
          channel: "voice",
          processed: 0,
          failed: 0,
        },
        notes: "No queued/scheduled voice touch_runs to process",
      })
    } catch (e) {
      console.error(
        "logEvaluation failed in dispatch-touch-voice (no candidates)",
        e,
      )
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        processed: 0,
        errors: [],
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // 2) claim atómico -> processing (incluyendo account_id)
  const { data: runs, error: claimErr } = await supabase
    .from("touch_runs")
    .update({ status: "processing" })
    .in("id", ids)
    .eq("status", "queued")
    .select("id, lead_id, account_id, payload, step, created_at")

  if (claimErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        stage: "claim_runs",
        error: claimErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  let processed = 0
  const errors: any[] = []

  for (const tr of runs ?? []) {
    try {
      if (!tr.lead_id) throw new Error("missing_lead_id")
      if (!tr.account_id) throw new Error("missing_account_id_on_run")

      // 2.1 resolver proveedor por cuenta/canal
      const { data: providerRow, error: provErr } = await supabase
        .from("account_provider_settings")
        .select("provider, config")
        .eq("account_id", tr.account_id)
        .eq("channel", "voice")
        .eq("is_default", true)
        .maybeSingle()

      if (provErr) {
        throw new Error(`provider_lookup_failed:${provErr.message}`)
      }
      if (!providerRow?.provider) {
        throw new Error("no_default_provider_for_account_voice")
      }

      const provider = providerRow.provider
      const providerConfig =
        (providerRow.config ?? {}) as Record<string, unknown>

      if (provider !== "twilio") {
        throw new Error(`unsupported_provider:${provider}`)
      }

      if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
        throw new Error("missing_twilio_env")
      }

      // 2.2 fetch lead
      const { data: lead, error: lErr } = await supabase
        .from("leads")
        .select("id, phone, contact_name, company_name, country")
        .eq("id", tr.lead_id)
        .maybeSingle()

      if (lErr || !lead) throw new Error("lead_not_found")

      const to = normalizePhone(lead.phone || "", lead.country)
      if (!to) throw new Error("missing_or_invalid_phone")

      const firstName =
        (lead.contact_name || "").split(" ")[0]?.trim() || "there"
      const company = lead.company_name || "your company"

      const payload = (tr.payload || {}) as Record<string, any>

      const scriptText =
        payload.script ||
        `Hey, is this ${firstName}? ` +
          `Mira, voy rápido — te contacto porque vimos tu empresa, ${company}, ` +
          `y estamos ayudando a negocios como el tuyo a generar 10 a 20 clientes nuevos al mes ` +
          `con automatización real. ` +
          `Si te hace sentido, te mando un link para agendar una llamada de 15 minutos. ` +
          `¿Te interesa verlo?`

      const voiceId = payload.voice_id || DEFAULT_VOICE_ID
      const renderWebhook = payload.render_webhook || DEFAULT_RENDER_WEBHOOK
      if (!renderWebhook) throw new Error("missing_render_webhook")

      // 2.3 render audio (función render-voice)
      const { data: audioData, error: aErr } = await supabase.functions.invoke(
        "render-voice",
        {
          body: { text: scriptText, lead_id: lead.id, voice_id: voiceId },
        },
      )
      if (aErr) throw aErr

      const audioUrl =
        audioData?.publicUrl || audioData?.url || audioData?.audioUrl
      if (!audioUrl) throw new Error("render-voice missing publicUrl/url")

      const twimlUrl =
        `${PUBLIC_BASE_URL}/functions/v1/${VOICE_WEBHOOK_PATH}` +
        `?audio_url=${encodeURIComponent(audioUrl)}`

      // 2.4 call Twilio (a menos que DRY_RUN)
      let twilio_call_sid: string | null = null
      if (!DRY_RUN) {
        const call = await twilioCall({
          to,
          sid: TWILIO_SID,
          token: TWILIO_TOKEN,
          from: TWILIO_FROM,
          twimlUrl,
        })
        twilio_call_sid = call.sid
      }

      // 2.5 marcar como sent
      await supabase
        .from("touch_runs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error: null,
          payload: {
            ...payload,
            dry_run: DRY_RUN,
            audio_url: audioUrl,
            to_normalized: to,
            voice_id: voiceId,
            twilio_call_sid,
            provider,
            provider_config: providerConfig,
          },
        })
        .eq("id", tr.id)

      processed++
    } catch (e: any) {
      const msg = String(e?.message ?? e)

      await supabase
        .from("touch_runs")
        .update({
          status: "failed",
          error: msg,
        })
        .eq("id", tr.id)

      errors.push({
        touch_run_id: tr.id,
        lead_id: tr.lead_id,
        error: msg,
      })
    }
  }

  // 3) Log resumen en core_memory_events (best-effort)
  try {
    await logEvaluation({
      supabase,
      event_type: "evaluation",
      actor: "dispatcher",
      label: "dispatch_touch_voice_v5",
      kpis: {
        channel: "voice",
        processed,
        failed: errors.length,
      },
      notes:
        errors.length === 0
          ? "All voice calls dispatched successfully"
          : `Voice dispatch completed with ${errors.length} errors`,
    })
  } catch (e) {
    console.error("logEvaluation failed in dispatch-touch-voice", e)
  }

  return new Response(
    JSON.stringify({ ok: true, version: VERSION, processed, errors }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  )
})
