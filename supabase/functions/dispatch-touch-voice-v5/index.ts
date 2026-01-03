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
  // Prefer TWILIO_VOICE_FROM; accept legacy TWILIO_FROM_NUMBER (already used in some envs).
  const VOICE_FROM = Deno.env.get("TWILIO_VOICE_FROM") ?? Deno.env.get("TWILIO_FROM_NUMBER") // ej: "+14155551234"

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
      scope: "system",
      actor: "agent",
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

  // Twilio StatusCallback handler (we reuse voice-webhook with a mode)
  const voiceWebhookBaseUrl = projectRef
    ? `https://${projectRef}.functions.supabase.co/voice-webhook`
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
      const voiceMode: string =
        payload?.voice?.mode ??
        payload?.voice_mode ??
        "simple_say"

      // Routing behavior:
      // - default (backward compatible): advance to next step immediately after sending
      // - optional: wait for call status callback to decide next step (voice -> whatsapp fallback, retries, etc)
      const advanceOn: string =
        payload?.routing?.advance_on ??
        payload?.routing?.advanceOn ??
        "sent"
      const shouldAdvanceAfterSend = advanceOn !== "call_status"

      // 2.4 Marcar como processing (para telemetría)
      {
        // Some schemas don't allow status="processing" (check constraint).
        // Use "executing" as the canonical status; fall back silently.
        const baseUpdate: any = {
          executed_at: new Date().toISOString(),
          error: null,
          meta: {
            ...(payload.meta ?? {}),
            dispatcher_version: VERSION,
          },
        }

        const { error: u1 } = await supabase
          .from("touch_runs")
          .update({ ...baseUpdate, status: "executing" })
          .eq("id", run.id)

        if (u1) {
          // last resort: update without status
          await supabase.from("touch_runs").update(baseUpdate).eq("id", run.id)
        }
      }

      let twilioCallSid: string | null = null

      // 2.5 Enviar por Twilio Voice (si no es dryRun)
      if (!dryRun) {
        const callUrl = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`

        const useInteractiveWebhook = voiceMode === "interactive_v1" && !!voiceWebhookBaseUrl
        const twimlUrl = useInteractiveWebhook
          ? `${voiceWebhookBaseUrl}?mode=twiml&touch_run_id=${encodeURIComponent(run.id)}&state=start`
          : null

        // Default behavior: inline TwiML (<Play> or <Say>)
        let twiml: string | null = null
        if (!useInteractiveWebhook) {
          if (audioUrl) twiml = `<Response><Play>${audioUrl}</Play></Response>`
          else twiml = `<Response><Say>${textBody}</Say></Response>`
        }

        // Status callback so we can decide retries/fallback based on answered/no-answer/busy/etc.
        // Twilio will include CallSid/CallStatus and will preserve our query params.
        const statusCallback =
          voiceWebhookBaseUrl
            ? `${voiceWebhookBaseUrl}?mode=status&touch_run_id=${encodeURIComponent(run.id)}`
            : null

        const params = new URLSearchParams()
        params.set("To", to)
        params.set("From", VOICE_FROM)
        if (twimlUrl) {
          params.set("Url", twimlUrl)
          params.set("Method", "POST")
        }
        if (twiml) {
          params.set("Twiml", twiml)
        }
        if (statusCallback) {
          params.set("StatusCallback", statusCallback)
          params.set("StatusCallbackMethod", "POST")
          // Twilio expects repeated StatusCallbackEvent params (not a space-separated string).
          for (const ev of ["initiated", "ringing", "answered", "completed", "busy", "failed", "no-answer", "canceled"]) {
            params.append("StatusCallbackEvent", ev)
          }
          // Use machine detection when we care about outcomes.
          params.set("MachineDetection", "Enable")
        }

        const twilioResp = await fetch(callUrl, {
          method: "POST",
          headers: {
            Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: params,
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

      // 2.6 Marcar como enviado (solo si corresponde)
      // - default: sent immediately (backward-compatible)
      // - advance_on=call_status: keep executing; voice-webhook?mode=status will finalize + schedule next step
      const sentAtIso = new Date().toISOString()

      await supabase
        .from("touch_runs")
        .update({
          status: shouldAdvanceAfterSend ? "sent" : "executing",
          sent_at: shouldAdvanceAfterSend ? sentAtIso : null,
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
        scope: "lead",
        account_id: run.account_id,
        entity_id: run.lead_id,
        actor: "agent",
        label: "voice_sent",
        kpis: { processed, failed: errors.length },
        notes: `provider=${provider}, dryRun=${dryRun}`,
      })

      // 2.7 🔗 SMART ROUTER
      // - default: advance immediately after send
      // - if advance_on=call_status: wait for voice-webhook status callback to advance
      if (!dryRun && smartRouterUrl && shouldAdvanceAfterSend) {
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
              previous_touch_id: run.id,
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
        scope: "lead",
        account_id: run.account_id,
        entity_id: run.lead_id,
        actor: "agent",
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
    scope: "system",
    actor: "agent",
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
