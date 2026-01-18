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

async function emitDispatchEvent(
  supabase: any,
  run: any,
  args: { provider?: string | null; event: string; payload: any },
) {
  const { error } = await supabase.from("dispatch_events").insert({
    touch_run_id: run.id,
    account_id: run.account_id,
    channel: "voice",
    provider: args.provider ?? null,
    event: args.event,
    payload: args.payload ?? {},
  })
  if (error) throw new Error(`dispatch_events_insert_failed:${run.id}:${error.message}`)
}

async function upsertVoiceCall(
  supabase: any,
  run: any,
  patch: {
    provider?: string | null
    provider_call_id?: string | null
    provider_job_id?: string | null
    from_phone: string
    to_phone: string
    status: string
    last_error?: string | null
    meta?: any
  },
) {
  const nowIso = new Date().toISOString()
  const { error } = await supabase.from("voice_calls").upsert(
    {
      id: run.id, // stable id to avoid rewriting ids on repeated upserts
      lead_id: run.lead_id,
      touch_run_id: run.id,
      channel: "voice",
      provider: patch.provider ?? null,
      provider_call_id: patch.provider_call_id ?? null,
      provider_job_id: patch.provider_job_id ?? null,
      from_phone: patch.from_phone,
      to_phone: patch.to_phone,
      status: patch.status,
      scheduled_at: nowIso,
      last_error: patch.last_error ?? null,
      meta: patch.meta ?? {},
      created_at: nowIso,
      updated_at: nowIso,
    },
    { onConflict: "touch_run_id" },
  )
  if (error) throw new Error(`voice_calls_upsert_failed:${run.id}:${error.message}`)
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

  // ENV Telnyx para VOICE (primary)
  // NOTE: el secreto en Supabase Edge está cargado como "Telnyx_Api" (según usuario),
  // pero también aceptamos TELNYX_API_KEY por consistencia.
  const TELNYX_API_KEY = Deno.env.get("TELNYX_API_KEY") ?? Deno.env.get("Telnyx_Api") ?? null
  const VOICE_GATEWAY_TOKEN = String(Deno.env.get("VOICE_GATEWAY_TOKEN") ?? "").trim()
  const TELNYX_STREAM_URL_FROM_TOKEN = VOICE_GATEWAY_TOKEN
    ? `wss://revenue-asi-voice-gateway.fly.dev/telnyx?token=${VOICE_GATEWAY_TOKEN}`
    : null
  let streamUrlBuiltLogged = false
  function logStreamUrlBuilt(touchRunId: string) {
    if (streamUrlBuiltLogged) return
    streamUrlBuiltLogged = true
    console.log(JSON.stringify({
      event: "STREAM_URL_BUILT",
      touch_run_id: touchRunId,
      got_len: VOICE_GATEWAY_TOKEN.length,
      token_prefix: VOICE_GATEWAY_TOKEN ? VOICE_GATEWAY_TOKEN.slice(0, 6) : "",
    }))
  }

  const QA_VOICE_SINK = Deno.env.get("QA_VOICE_SINK") ?? null
  const DRY_DEFAULT = Deno.env.get("DRY_RUN_VOICE") === "true"

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const touchRunIds = Array.isArray(body.touch_run_ids)
    ? body.touch_run_ids.filter((x: any) => typeof x === "string")
    : null
  const limit = Number(body.limit ?? 50)
  const dryRun = Boolean(body.dry_run ?? DRY_DEFAULT)

  //────────────────────────────────────────
  // 1) TRAER TOUCH RUNS VOICE
  //────────────────────────────────────────
  let runs: any[] = []
  if (touchRunIds && touchRunIds.length) {
    const { data, error } = await supabase
      .from("touch_runs")
      .select("id, lead_id, account_id, payload, scheduled_at, step, status, channel")
      .in("id", touchRunIds)
      .order("scheduled_at", { ascending: true })
    if (error) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "select_runs_by_ids",
          error: error.message,
          version: VERSION,
        }),
        { status: 500, headers: corsHeaders },
      )
    }
    runs = data ?? []
  } else {
    const { data, error } = await supabase
    .from("touch_runs")
      .select("id, lead_id, account_id, payload, scheduled_at, step, status, channel")
    .eq("channel", "voice")
    .in("status", ["queued", "scheduled"])
    .order("scheduled_at", { ascending: true })
    .limit(limit)
    if (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "select_runs",
          error: error.message,
        version: VERSION,
      }),
      { status: 500, headers: corsHeaders },
    )
    }
    runs = data ?? []
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
  const processed_ids: string[] = []
  const failed_ids: string[] = []

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

  async function telnyxCreateCall(args: {
    to: string
    from: string
    touchRunId: string
    config: Record<string, unknown>
    clientStateExtra?: Record<string, unknown>
  }): Promise<{ ok: true; call_control_id: string | null; raw: any } | { ok: false; error: string; raw: any }> {
    if (!TELNYX_API_KEY) return { ok: false, error: "missing_telnyx_api_key", raw: null }

    const connectionId =
      (args.config?.telnyx_connection_id as string | undefined) ??
      (args.config?.connection_id as string | undefined) ??
      (Deno.env.get("TELNYX_CONNECTION_ID") ?? undefined)

    if (!connectionId) return { ok: false, error: "missing_telnyx_connection_id", raw: null }

    // Event webhook: prefer explicit config, else use our shared voice-webhook in telnyx mode.
    const eventUrl =
      (args.config?.telnyx_webhook_event_url as string | undefined) ??
      (args.config?.webhook_event_url as string | undefined) ??
      (voiceWebhookBaseUrl ? `${voiceWebhookBaseUrl}?mode=telnyx_status&touch_run_id=${encodeURIComponent(args.touchRunId)}` : null)

    // client_state: many Telnyx events echo this back; we use it to map event -> touch_run_id.
    const clientStateObj = {
      touch_run_id: args.touchRunId,
      ...(args.clientStateExtra ?? {}),
    }
    const clientState = btoa(JSON.stringify(clientStateObj))

    const body: Record<string, unknown> = {
      connection_id: connectionId,
      to: args.to,
      from: args.from,
      client_state: clientState,
    }
    if (eventUrl) body.webhook_event_url = eventUrl

    // Ring timeout (seconds). If too low, callee can "answer" near the end and Telnyx may still hang up as timeout.
    const timeoutSecsRaw =
      (args.config?.telnyx_timeout_secs as number | string | undefined) ??
      (args.config?.timeout_secs as number | string | undefined) ??
      (Deno.env.get("TELNYX_TIMEOUT_SECS") ?? undefined)
    const timeoutSecs = timeoutSecsRaw ? Number(timeoutSecsRaw) : 60
    if (Number.isFinite(timeoutSecs) && timeoutSecs > 0) body.timeout_secs = Math.min(Math.max(timeoutSecs, 15), 120)

    // Streaming is initiated on call.answered; still require token so gateway can start later.
    if (!TELNYX_STREAM_URL_FROM_TOKEN) {
      console.log(JSON.stringify({ event: "VOICE_GATEWAY_TOKEN_MISSING", touch_run_id: args.touchRunId, token_len: 0, token_prefix: "" }))
      return { ok: false, error: "missing_voice_gateway_token", raw: null }
    }
    logStreamUrlBuilt(args.touchRunId)

    console.log(
      JSON.stringify({
        event: "TELNYX_CREATE_CALL_REQ",
        touch_run_id: args.touchRunId,
        body_keys: Object.keys(body).sort(),
      }),
    )

    const res = await fetch("https://api.telnyx.com/v2/calls", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    })

    const txt = await res.text().catch(() => "")
    let j: any = null
    try {
      j = txt ? JSON.parse(txt) : null
    } catch {
      j = { raw: txt }
    }

    if (!res.ok) {
      const msg = (j?.errors?.[0]?.detail as string | undefined) ?? (j?.message as string | undefined) ?? `telnyx_http_${res.status}`
      return { ok: false, error: msg, raw: j }
    }

    const callControlId =
      (j?.data?.call_control_id as string | undefined) ??
      (j?.data?.id as string | undefined) ??
      null

    return { ok: true, call_control_id: callControlId, raw: j }
  }

  async function telnyxSpeakNow(args: { call_control_id: string; text: string }): Promise<{ ok: boolean; status: number | null; body: string }> {
    if (!TELNYX_API_KEY) return { ok: false, status: null, body: "missing_telnyx_api_key" }
    const ccid = String(args.call_control_id || "").trim()
    if (!ccid) return { ok: false, status: null, body: "missing_call_control_id" }

    const url = `https://api.telnyx.com/v2/calls/${encodeURIComponent(ccid)}/actions/speak`
    const headers = {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    }

    // Attempt A: common call-control shape (voice required in some accounts)
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ payload: String(args.text || ""), voice: "female", language: "es-PA" }) })
    const txt = await res.text().catch(() => "")
    return { ok: res.ok, status: res.status, body: txt }
  }

  for (const run of runs) {
    try {
      if (String(run.channel || "").toLowerCase() !== "voice") {
        throw new Error("wrong_channel_for_voice_dispatcher")
      }
      if (!run.account_id) {
        throw new Error("missing_account_id_on_run")
      }

      await emitDispatchEvent(supabase, run, {
        provider: null,
        event: "dispatch_attempt",
        payload: { version: VERSION, dry_run: dryRun, at: new Date().toISOString() },
      })

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

      const isTelnyx = provider === "telnyx"
      const isTwilio = provider === "twilio"
      if (!isTelnyx && !isTwilio) {
        throw new Error(`unsupported_provider:${provider}`)
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
      let telnyxCallControlId: string | null = null
      let telnyxRaw: any = null
      let telnyxErr: string | null = null
      let telnyxSpeakRes: any = null

      // dry_run: deterministic trace (no provider call)
      if (dryRun) {
        await upsertVoiceCall(supabase, run, {
          provider: "dry_run",
          from_phone: "+0000000000",
          to_phone: to,
          status: "scheduled",
          meta: { dry_run: true, dry_run_simulated: true },
        })
        await emitDispatchEvent(supabase, run, { provider: "dry_run", event: "provider_request", payload: { dry_run: true } })
        await emitDispatchEvent(supabase, run, { provider: "dry_run", event: "provider_response", payload: { ok: true, dry_run: true } })

        await supabase
          .from("touch_runs")
          .update({
            // NOTE: must comply with touch_runs.status CHECK constraint and MUST NOT
            // pollute success metrics on dry_run.
            status: "canceled",
            sent_at: null,
            error: null,
            updated_at: new Date().toISOString(),
            meta: {
              ...(run.meta ?? {}),
              simulated: true,
              dry_run_simulated: true,
              dispatcher_version: VERSION,
            },
          })
          .eq("id", run.id)

        processed++
        processed_ids.push(run.id)
        continue
      }

      // 2.5 Enviar por Telnyx (PRIMARY) o Twilio (fallback)
      if (!dryRun && isTelnyx) {
        const streamUrl = TELNYX_STREAM_URL_FROM_TOKEN
        if (!streamUrl) {
          console.log(JSON.stringify({ event: "VOICE_GATEWAY_TOKEN_MISSING", touch_run_id: run.id, token_len: 0, token_prefix: "" }))
          throw new Error("missing_voice_gateway_token")
        }
        logStreamUrlBuilt(run.id)

        const telnyxFrom =
          (config?.telnyx_from as string | undefined) ??
          (config?.from as string | undefined) ??
          (Deno.env.get("TELNYX_VOICE_FROM") ?? undefined)

        if (!telnyxFrom) throw new Error("missing_telnyx_from")

        const clientStateExtra = {
          lead_id: run.lead_id,
          account_id: run.account_id,
          source: (payload?.source ?? payload?.voice?.source ?? null),
          voice_mode: streamUrl ? "realtime" : "call_control_tts",
          buyer_name: (payload?.voice?.buyer_name ?? payload?.voice?.buyerName ?? null),
          listing: (payload?.voice?.listing ?? null),
        }

        await upsertVoiceCall(supabase, run, {
          provider: "telnyx",
          from_phone: telnyxFrom,
          to_phone: to,
          status: "scheduled",
          meta: { stream_url: streamUrl ?? null },
        })

        await emitDispatchEvent(supabase, run, {
          provider: "telnyx",
          event: "provider_request",
          payload: { to, from: telnyxFrom, stream_url: streamUrl ?? null, voice_mode: clientStateExtra.voice_mode },
        })

        const r = await telnyxCreateCall({ to, from: telnyxFrom, touchRunId: run.id, config, clientStateExtra })
        telnyxRaw = (r as any).raw ?? null
        if (!r.ok) {
          telnyxErr = String((r as any).error || "telnyx_failed")
          await upsertVoiceCall(supabase, run, {
            provider: "telnyx",
            from_phone: telnyxFrom,
            to_phone: to,
            status: "failed",
            last_error: telnyxErr,
            meta: { stream_url: streamUrl ?? null, provider_response: telnyxRaw ?? null },
          })
          await emitDispatchEvent(supabase, run, {
            provider: "telnyx",
            event: "provider_response",
            payload: { ok: false, error: telnyxErr, response: telnyxRaw ?? null },
          })
          // Fallback to Twilio if configured
          if (!TWILIO_SID || !TWILIO_TOKEN || !VOICE_FROM) {
            throw new Error(`telnyx_failed_and_no_twilio_fallback:${(r as any).error}`)
          }
          // Use Twilio branch below
        } else {
          telnyxCallControlId = r.call_control_id
          await upsertVoiceCall(supabase, run, {
            provider: "telnyx",
            from_phone: telnyxFrom,
            to_phone: to,
            status: "scheduled",
            provider_call_id: telnyxCallControlId,
            meta: { stream_url: streamUrl ?? null, call_control_id: telnyxCallControlId, provider_response: telnyxRaw ?? null },
          })
          await emitDispatchEvent(supabase, run, {
            provider: "telnyx",
            event: "provider_response",
            payload: { ok: true, call_control_id: telnyxCallControlId, response: telnyxRaw ?? null },
          })
          // If we're using realtime streaming, the Fly gateway handles the conversation.
          // Otherwise, keep best-effort immediate speech.
          if (!streamUrl && telnyxCallControlId) {
            telnyxSpeakRes = await telnyxSpeakNow({ call_control_id: telnyxCallControlId, text: textBody })
          }
        }
      }

      // 2.5b Twilio branch:
      // - if provider is twilio, always
      // - if provider is telnyx, only when telnyx failed (telnyxCallControlId is null)
      if (!dryRun && (isTwilio || (isTelnyx && !telnyxCallControlId))) {
        if (!TWILIO_SID || !TWILIO_TOKEN || !VOICE_FROM) {
          throw new Error("missing_twilio_voice_env")
        }
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

        await emitDispatchEvent(supabase, run, {
          provider: "twilio",
          event: "provider_request",
          payload: { to, from: VOICE_FROM, status_callback: statusCallback ?? null },
        })

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
          await emitDispatchEvent(supabase, run, {
            provider: "twilio",
            event: "provider_response",
            payload: { ok: false, status: twilioResp.status, response: txt.slice(0, 2000) },
          })
          await upsertVoiceCall(supabase, run, {
            provider: "twilio",
            from_phone: VOICE_FROM,
            to_phone: to,
            status: "failed",
            last_error: `twilio_http_${twilioResp.status}`,
            meta: { twilio_raw: txt.slice(0, 2000) },
          })
          if (telnyxErr) {
            throw new Error(`telnyx_failed:${telnyxErr}; twilio_error:${txt}`)
          }
          throw new Error(`Twilio error: ${txt}`)
        }

        try {
          const parsed = JSON.parse(txt)
          twilioCallSid = parsed.sid ?? null
        } catch {
          twilioCallSid = null
        }

        await emitDispatchEvent(supabase, run, {
          provider: "twilio",
          event: "provider_response",
          payload: { ok: true, call_sid: twilioCallSid, response: txt.slice(0, 2000) },
        })
        await upsertVoiceCall(supabase, run, {
          provider: "twilio",
          from_phone: VOICE_FROM,
          to_phone: to,
          status: "scheduled",
          provider_call_id: twilioCallSid,
          provider_job_id: twilioCallSid,
          meta: { call_sid: twilioCallSid, twilio_raw: txt.slice(0, 2000) },
        })
      }

      // 2.6 Marcar como enviado (solo si corresponde)
      // - default: sent immediately (backward-compatible)
      // - advance_on=call_status: keep executing; voice-webhook?mode=status will finalize + schedule next step
      const sentAtIso = new Date().toISOString()

      // Guardrail: NEVER mark sent/executing unless provider was actually initiated.
      if (!telnyxCallControlId && !twilioCallSid) {
        throw new Error("provider_not_initiated")
      }

      await supabase
        .from("touch_runs")
        .update({
          status: shouldAdvanceAfterSend ? "sent" : "executing",
          sent_at: shouldAdvanceAfterSend ? sentAtIso : null,
          error: null,
          updated_at: new Date().toISOString(),
          payload: {
            ...(payload ?? {}),
            to,
            to_normalized: toReal,
            dryRun,
            // If Telnyx is configured as primary but it failed and we fell back to Twilio,
            // persist the actual provider used for this run.
            provider: telnyxCallControlId ? "telnyx" : (twilioCallSid ? "twilio" : provider),
            provider_config: config,
            twilio_call_sid: twilioCallSid,
            telnyx_call_control_id: telnyxCallControlId,
            telnyx_response: telnyxRaw,
            telnyx_speak: telnyxSpeakRes ? { ok: Boolean(telnyxSpeakRes.ok), status: telnyxSpeakRes.status ?? null } : null,
          },
        })
        .eq("id", run.id)

      processed++
      processed_ids.push(run.id)

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
      failed_ids.push(run.id)

      await supabase
        .from("touch_runs")
        .update({
          status: "failed",
          error: msg,
          updated_at: new Date().toISOString(),
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
      ok: errors.length === 0,
      version: VERSION,
      processed,
      failed: failed_ids.length,
      errors,
      dryRun,
      processed_ids,
      failed_ids,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})
