// supabase/functions/dispatch-touch-voice-v5/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-voice-v5_2025-12-10_multitenant"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function cleanPhone(p: string | null) {
  if (!p) return null
  return p.replace(/\s+/g, "").trim()
}

function isValidE164(p: string | null) {
  if (!p) return false
  return /^\+\d{8,15}$/.test(p)
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
        stage: "env",
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
        version: VERSION,
      }),
      { status: 500, headers: corsHeaders },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  // ENV Twilio para VOICE
  const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")
  const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")
  const VOICE_FROM = Deno.env.get("TWILIO_VOICE_FROM") // ej: "+14155551234"

  const QA_VOICE_SINK = Deno.env.get("QA_VOICE_SINK") ?? null
  const DRY_DEFAULT = Deno.env.get("DRY_RUN_VOICE") === "true"

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const limit = Number(body.limit ?? 50)
  const dryRun = Boolean(body.dry_run ?? DRY_DEFAULT)

  //────────────────────────────────────────
  // 1) TRAER TOUCH RUNS VOICE
  //────────────────────────────────────────
  const { data: runs, error: rErr } = await supabase
    .from("touch_runs")
    .select("id, lead_id, account_id, payload, scheduled_at, step, status")
    .eq("channel", "voice")
    .in("status", ["queued", "scheduled"])
    .order("scheduled_at", { ascending: true })
    .limit(limit)

  if (rErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "select_runs",
        error: rErr.message,
        version: VERSION,
      }),
      { status: 500, headers: corsHeaders },
    )
  }

  if (!runs?.length) {
    await logEvaluation(supabase, {
      event_source: "dispatcher",
      label: "voice_empty",
      kpis: { processed: 0, failed: 0 },
      notes: "No voice runs to dispatch",
    })

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        processed: 0,
        failed: 0,
        dryRun,
      }),
      { headers: corsHeaders },
    )
  }

  //────────────────────────────────────────
  // 2) LOOP PRINCIPAL
  //────────────────────────────────────────
  let processed = 0
  const errors: any[] = []

  // Para llamar al smart router después de enviar
  const projectRef = (() => {
    try {
      const url = new URL(SB_URL)
      const host = url.hostname // ej: cdrrlkxgurckuyceiguo.supabase.co
      return host.split(".")[0]
    } catch {
      return null
    }
  })()

  const smartRouterUrl = projectRef
    ? `https://${projectRef}.functions.supabase.co/dispatch-touch-smart-router`
    : null

  for (const run of runs) {
    try {
      if (!run.account_id) {
        throw new Error("missing_account_id_on_run")
      }

      // 2.1 Resolver proveedor para esta cuenta/canal
      const { data: providerRow, error: provErr } = await supabase
        .from("account_provider_settings")
        .select("provider, config")
        .eq("account_id", run.account_id)
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
      const config = (providerRow.config ?? {}) as Record<string, unknown>

      if (provider !== "twilio") {
        throw new Error(`unsupported_provider:${provider}`)
      }

      if (!TWILIO_SID || !TWILIO_TOKEN || !VOICE_FROM) {
        throw new Error("missing_twilio_voice_env")
      }

      // 2.2 Resolver teléfono del lead (lead_enriched primero)
      const { data: leadE, error: leErr } = await supabase
        .from("lead_enriched")
        .select("phone")
        .eq("id", run.lead_id)
        .maybeSingle()

      if (leErr) {
        throw new Error("lead_enriched_lookup_failed")
      }

      const phoneRaw = cleanPhone(leadE?.phone ?? null)

      if (!isValidE164(phoneRaw)) {
        throw new Error(`invalid_phone:${phoneRaw}`)
      }

      const toReal = phoneRaw!
      const to = QA_VOICE_SINK ?? toReal

      // 2.3 Determinar mensaje / audio
      const payload = (run.payload ?? {}) as any
      const audioUrl: string | undefined = payload.audio_url ?? undefined
      const delivery = payload.delivery ?? {}
      const textBody: string =
        delivery.body ??
        "Esta es una llamada de prueba automática de Revenue ASI."

      // 2.4 Marcar como processing (para telemetría)
      await supabase
        .from("touch_runs")
        .update({
          status: "processing",
          executed_at: new Date().toISOString(),
          error: null,
          meta: {
            ...(payload.meta ?? {}),
            dispatcher_version: VERSION,
          },
        })
        .eq("id", run.id)

      let twilioCallSid: string | null = null

      // 2.5 Enviar por Twilio Voice (si no es dryRun)
      if (!dryRun) {
        const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`

        // Usamos TwiML inline: <Play>audio</Play> o <Say>texto</Say>
        let twiml: string
        if (audioUrl) {
          twiml = `<Response><Play>${audioUrl}</Play></Response>`
        } else {
          twiml = `<Response><Say>${textBody}</Say></Response>`
        }

        const twilioResp = await fetch(callUrl, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: to,
            From: VOICE_FROM,
            Twiml: twiml,
          }),
        })

        const txt = await twilioResp.text()

        if (!twilioResp.ok) {
          throw new Error(`Twilio error: ${txt}`)
        }

        try {
          const parsed = JSON.parse(txt)
          twilioCallSid = parsed.sid ?? null
        } catch {
          twilioCallSid = null
        }
      }

      // 2.6 Marcar como enviado
      const sentAtIso = new Date().toISOString()

      await supabase
        .from("touch_runs")
        .update({
          status: "sent",
          sent_at: sentAtIso,
          error: null,
          payload: {
            ...(payload ?? {}),
            to,
            to_normalized: toReal,
            dryRun,
            provider,
            provider_config: config,
            twilio_call_sid: twilioCallSid,
          },
        })
        .eq("id", run.id)

      processed++

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "voice_sent",
        kpis: { processed, failed: errors.length },
        notes: `provider=${provider}, dryRun=${dryRun}`,
      })

      // 2.7 🔗 LLAMAR AL SMART ROUTER (solo si NO es dryRun)
      if (!dryRun && smartRouterUrl) {
        try {
          await fetch(smartRouterUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SB_KEY,
              Authorization: `Bearer ${SB_KEY}`,
            },
            body: JSON.stringify({
              lead_id: run.lead_id,
              step: run.step ?? 1,
              dry_run: false,
              source: "voice_dispatcher",
            }),
          })
          // No nos importa el body aquí; el router se encarga de crear el siguiente touch si aplica
        } catch (routerErr) {
          console.error("Smart router call failed:", routerErr)
          // No rompemos el flujo de envío por culpa del router
        }
      }
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      errors.push({ id: run.id, lead_id: run.lead_id, error: msg })

      await supabase
        .from("touch_runs")
        .update({
          status: "failed",
          error: msg,
        })
        .eq("id", run.id)

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "voice_failed",
        kpis: { processed, failed: errors.length },
        notes: msg,
      })
    }
  }

  //────────────────────────────────────────
  // 3) LOG RESUMEN
  //────────────────────────────────────────
  await logEvaluation(supabase, {
    event_source: "dispatcher",
    label: "voice_summary",
    kpis: { processed, failed: errors.length },
    notes: errors.length
      ? `${errors.length} errors`
      : "All voice messages delivered",
  })

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      processed,
      failed: errors.length,
      errors,
      dryRun,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})
