// supabase/functions/voice-webhook/index.ts
//
// Multi-purpose Twilio Voice webhook:
// - Playback: GET ?audio_url=...
// - Interactive pre-qual voice flow: POST ?mode=twiml&touch_run_id=...&state=...
// - Outbound StatusCallback handler (retries/fallback): POST ?mode=status&touch_run_id=...
//
// Design goals:
// - Backward compatible (if mode not provided, respond empty TwiML).
// - No fragile From/To matching for outbound: rely on touch_run_id query param.
// - Keep voice flow short (60–90s), yes/no + one open question.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "voice-webhook-v4_2026-01-02_clean_flow_and_status"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
}

function xmlResponse(xml: string) {
  return new Response(xml, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/xml" },
  })
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function escXml(s: string) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function norm(s: string | null) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
}

function digitsOrSpeech(formData: FormData | null) {
  const digits = (formData?.get("Digits") as string | null) ?? null
  const speech = (formData?.get("SpeechResult") as string | null) ?? null
  const confidenceRaw = (formData?.get("Confidence") as string | null) ?? null
  const confidence = confidenceRaw ? Number(confidenceRaw) : null
  return { digits, speech, confidence }
}

function classifyYesNo(speechRaw: string | null, digits: string | null): "yes" | "no" | "unknown" {
  if (digits === "1") return "yes"
  if (digits === "2") return "no"
  const s = norm(speechRaw ?? "")
  if (!s) return "unknown"
  if (/\b(si|sí|claro|dale|ok|okay|correcto|confirmo)\b/.test(s)) return "yes"
  if (/\b(no|negativo|para nada|ahorita no)\b/.test(s)) return "no"
  return "unknown"
}

function classifyIntro(speechRaw: string | null, digits: string | null) {
  // DTMF map:
  // 1 = sí (tengo 30s)
  // 2 = apurado
  // 3 = no
  // 4 = ya se vendió
  // 5 = equivocado
  // 6 = agencia/dealer
  if (digits === "1") return "ok"
  if (digits === "2") return "busy"
  if (digits === "3") return "no"
  if (digits === "4") return "sold"
  if (digits === "5") return "wrong"
  if (digits === "6") return "dealer"

  const s = norm(speechRaw ?? "")
  if (!s) return "unknown"
  if (s.includes("ocup") || s.includes("apur")) return "busy"
  if (/\b(vendido|ya lo vendi|ya se vendio|se vendio)\b/.test(s)) return "sold"
  if (/\b(equivocado|numero equivocado|te equivocaste)\b/.test(s)) return "wrong"
  if (/\b(agencia|dealer|autolote|concesionario|showroom)\b/.test(s)) return "dealer"
  if (/\b(no|ahorita no)\b/.test(s)) return "no"
  if (/\b(si|sí|dale|ok|claro)\b/.test(s)) return "ok"
  return "unknown"
}

function buildGather(args: {
  actionUrl: string
  say: string
  hints?: string
  numDigits?: number
  timeoutSec?: number
}) {
  const numDigits = args.numDigits ?? 1
  const timeoutSec = args.timeoutSec ?? 5
  const hints = args.hints ? ` speechHints="${escXml(args.hints)}"` : ""

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech dtmf" method="POST" action="${escXml(args.actionUrl)}" numDigits="${numDigits}" timeout="${timeoutSec}"${hints} language="es-PA">
    <Say voice="alice" language="es-PA">${escXml(args.say)}</Say>
  </Gather>
  <Say voice="alice" language="es-PA">No te escuché. Te escribo por WhatsApp para confirmar. Gracias.</Say>
  <Hangup/>
</Response>`
}

async function patchVoiceMeta(supabase: any, touchRunId: string, patch: Record<string, unknown>) {
  const { data: row } = await supabase
    .from("touch_runs")
    .select("meta")
    .eq("id", touchRunId)
    .maybeSingle()
  const meta = (row?.meta ?? {}) as any
  const next = {
    ...meta,
    voice: {
      ...(meta.voice ?? {}),
      ...(patch ?? {}),
      updated_at: new Date().toISOString(),
      version: VERSION,
    },
  }
  await supabase.from("touch_runs").update({ meta: next }).eq("id", touchRunId)
}

function toTerminalOutcome(args: { callStatus: string | null; answeredBy: string | null; callDuration: number | null }) {
  const st = (args.callStatus ?? "").toLowerCase()
  const answeredBy = (args.answeredBy ?? "").toLowerCase()
  const dur = Number.isFinite(args.callDuration ?? NaN) ? Number(args.callDuration) : null

  if (st === "busy") return { terminal: true, outcome: "busy" }
  if (st === "no-answer") return { terminal: true, outcome: "no_answer" }
  if (st === "failed") return { terminal: true, outcome: "failed" }
  if (st === "canceled") return { terminal: true, outcome: "canceled" }

  if (st === "completed") {
    if (answeredBy.includes("machine") || answeredBy.includes("fax") || answeredBy.includes("unknown")) {
      return { terminal: true, outcome: "machine" }
    }
    if (dur !== null && dur <= 0) return { terminal: true, outcome: "no_answer" }
    return { terminal: true, outcome: "answered" }
  }

  return { terminal: false, outcome: st || "unknown" }
}

async function insertNextTouchIfExists(args: {
  supabase: any
  account_id: string
  campaign_id: string
  lead_id: string
  next_step: number
  preferred_channel: "voice" | "whatsapp"
  previous_touch_id: string
}) {
  const { supabase, account_id, campaign_id, lead_id, next_step, preferred_channel, previous_touch_id } = args

  const { data: stepRow, error: csErr } = await supabase
    .from("campaign_steps")
    .select("delay_minutes, payload")
    .eq("account_id", account_id)
    .eq("campaign_id", campaign_id)
    .eq("step", next_step)
    .eq("channel", preferred_channel)
    .eq("is_active", true)
    .maybeSingle()

  if (csErr) throw new Error(`select_campaign_step_failed:${csErr.message}`)
  if (!stepRow) return { created: false, reason: "no_campaign_step" }

  const delayMinutes = Number(stepRow.delay_minutes ?? 0)
  const scheduledAt = new Date(Date.now() + Math.max(0, delayMinutes) * 60_000).toISOString()
  const basePayload = (stepRow.payload ?? {}) as Record<string, unknown>

  const insertBody: any = {
    account_id,
    campaign_id,
    campaign_run_id: null,
    lead_id,
    step: next_step,
    channel: preferred_channel,
    payload: basePayload,
    scheduled_at: scheduledAt,
    status: "queued",
    meta: {
      ...(basePayload as any)?.meta,
      previous_touch_id,
      created_by: VERSION,
    },
  }

  const { data: ins, error: insErr } = await supabase
    .from("touch_runs")
    .upsert(insertBody, { onConflict: "lead_id,campaign_id,step,channel", ignoreDuplicates: true })
    .select("id")
    .maybeSingle()

  if (insErr) throw new Error(`insert_touch_failed:${insErr.message}`)
  const newId = (ins as any)?.id ?? null
  return { created: Boolean(newId), new_touch_id: newId, insertBody }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } }) : null

  const url = new URL(req.url)
  const audioUrl = url.searchParams.get("audio_url")
  const mode = url.searchParams.get("mode") // twiml | status | null
  const touchRunId = url.searchParams.get("touch_run_id")
  const state = url.searchParams.get("state") ?? "start"

  // ---- Playback ----
  if (audioUrl) {
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>${audioUrl}</Play>
  <Hangup/>
</Response>`
    return xmlResponse(twiml)
  }

  // ---- Interactive voice flow (TwiML) ----
  if (mode === "twiml" && touchRunId) {
    if (!supabase || !SB_URL) return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`)

    const formData = req.method === "POST" ? await req.formData().catch(() => null) : null
    const { digits, speech, confidence } = digitsOrSpeech(formData)

    const { data: tr } = await supabase
      .from("touch_runs")
      .select("id, lead_id, payload")
      .eq("id", touchRunId)
      .maybeSingle()

    if (!tr?.id) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Gracias. Te escribo por WhatsApp para coordinar.</Say><Hangup/></Response>`)
    }

    const payload: any = tr.payload ?? {}
    const buyer = String(payload?.voice?.buyer_name ?? "Darmesh").trim() || "Darmesh"
    const listing = payload?.voice?.listing ?? {}
    const carLabel =
      String(listing?.car_label ?? "").trim() ||
      String(listing?.model ?? "").trim() ||
      "carro"

    const base = `${SB_URL}/functions/v1/voice-webhook?mode=twiml&touch_run_id=${encodeURIComponent(tr.id)}`
    const action = (st: string) => `${base}&state=${encodeURIComponent(st)}`

    if (state === "start") {
      const say =
        `Hola. ¿Hablo con el dueño del ${carLabel}? ` +
        `Te llamo rápido por el anuncio. Estoy ayudando a ${buyer}, que está muy interesado. ` +
        `¿Tienes 30 segundos? Marca 1 sí, 2 apurado, 3 no.`
      return xmlResponse(buildGather({ actionUrl: action("intro_post"), say, numDigits: 1, timeoutSec: 6 }))
    }

    if (state === "intro_post") {
      const cls = classifyIntro(speech, digits)
      await patchVoiceMeta(supabase, touchRunId, { intro: { digits, speech, confidence, classification: cls } }).catch(() => {})

      if (cls === "busy") {
        return xmlResponse(buildGather({ actionUrl: action("available_busy"), say: "Tranquilo, lo hago rápido. ¿Todavía está disponible? Marca 1 sí, 2 no.", numDigits: 1, timeoutSec: 5 }))
      }
      if (cls === "no" || cls === "wrong") {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Perfecto, disculpa la molestia. Gracias.</Say><Hangup/></Response>`)
      }
      if (cls === "sold") {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Perfecto, gracias por avisar. Que tengas buena tarde.</Say><Hangup/></Response>`)
      }
      if (cls === "dealer") {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Gracias. En este momento buscamos trato directo con dueño. Que tengas buena tarde.</Say><Hangup/></Response>`)
      }
      return xmlResponse(buildGather({ actionUrl: action("available"), say: "Perfecto. ¿Todavía está disponible? Marca 1 sí, 2 no.", numDigits: 1, timeoutSec: 5 }))
    }

    if (state === "available" || state === "available_busy") {
      const yn = classifyYesNo(speech, digits)
      await patchVoiceMeta(supabase, touchRunId, { available: { digits, speech, confidence, value: yn } }).catch(() => {})
      if (yn === "no") {
        return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Listo, gracias. Que tengas buena tarde.</Say><Hangup/></Response>`)
      }
      if (state === "available_busy") {
        return xmlResponse(buildGather({ actionUrl: action("negotiable_busy"), say: "¿El precio es negociable un poco? Marca 1 sí, 2 no.", numDigits: 1, timeoutSec: 5 }))
      }
      return xmlResponse(buildGather({ actionUrl: action("negotiable"), say: "¿El precio es el final o es negociable un poco? Di “final” o “negociable”.", hints: "final, negociable", numDigits: 1, timeoutSec: 6 }))
    }

    if (state === "negotiable" || state === "negotiable_busy") {
      const s = norm(speech ?? "")
      let v: "final" | "negotiable" | "unknown" = "unknown"
      if (digits === "1") v = "negotiable"
      if (digits === "2") v = "final"
      if (s.includes("final")) v = "final"
      if (s.includes("negoci")) v = "negotiable"
      await patchVoiceMeta(supabase, touchRunId, { negotiable: { digits, speech, confidence, value: v } }).catch(() => {})

      if (state === "negotiable_busy") {
        return xmlResponse(buildGather({ actionUrl: action("wa_ok"), say: "Listo. ¿Te puedo escribir por WhatsApp para coordinar? Marca 1 sí, 2 no.", numDigits: 1, timeoutSec: 5 }))
      }
      return xmlResponse(buildGather({ actionUrl: action("issues"), say: "¿Ha tenido choques fuertes o algún problema mecánico serio? Marca 1 no, 2 sí.", numDigits: 1, timeoutSec: 6 }))
    }

    if (state === "issues") {
      let v: "no" | "yes" | "unknown" = "unknown"
      if (digits === "1") v = "no"
      if (digits === "2") v = "yes"
      const s = norm(speech ?? "")
      if (/\b(no|ninguno|nada)\b/.test(s)) v = "no"
      if (/\b(si|sí|tuvo|tiene)\b/.test(s)) v = "yes"
      await patchVoiceMeta(supabase, touchRunId, { issues: { digits, speech, confidence, value: v } }).catch(() => {})
      return xmlResponse(buildGather({ actionUrl: action("location"), say: "Perfecto. ¿En qué zona se puede ver hoy o mañana? Dímelo después del tono.", timeoutSec: 7 }))
    }

    if (state === "location") {
      await patchVoiceMeta(supabase, touchRunId, { location: { digits, speech, confidence, value: (speech ?? "").toString().trim() || null } }).catch(() => {})
      return xmlResponse(buildGather({ actionUrl: action("wa_ok"), say: "Gracias. ¿Te puedo escribir por WhatsApp para confirmar? Marca 1 sí, 2 no.", numDigits: 1, timeoutSec: 5 }))
    }

    if (state === "wa_ok") {
      const yn = classifyYesNo(speech, digits)
      await patchVoiceMeta(supabase, touchRunId, { whatsapp_ok: { digits, speech, confidence, value: yn } }).catch(() => {})
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">${escXml(
        yn === "yes"
          ? "Perfecto. Te escribo por WhatsApp en este mismo número para confirmar. Gracias."
          : "Perfecto. Gracias por tu tiempo."
      )}</Say><Hangup/></Response>`)
    }

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`)
  }

  // ---- StatusCallback (retries/fallback) ----
  if (mode === "status" && touchRunId) {
    if (!supabase) return json({ ok: true, ignored: true, reason: "missing_supabase_env", version: VERSION })

    const formData = await req.formData().catch(() => null)
    const callStatus = (formData?.get("CallStatus") as string | null) ?? null
    const answeredBy = (formData?.get("AnsweredBy") as string | null) ?? null
    const callSid = (formData?.get("CallSid") as string | null) ?? null
    const callDurationRaw = (formData?.get("CallDuration") as string | null) ?? null
    const callDuration = callDurationRaw ? Number(callDurationRaw) : null

    const { data: run, error: rErr } = await supabase
      .from("touch_runs")
      .select("id, account_id, campaign_id, lead_id, step, channel, payload, meta")
      .eq("id", touchRunId)
      .maybeSingle()

    if (rErr) return json({ ok: false, error: rErr.message, version: VERSION }, 500)
    if (!run) return json({ ok: true, ignored: true, reason: "touch_run_not_found", version: VERSION })

    const payload = (run.payload ?? {}) as any
    const meta = (run.meta ?? {}) as any

    const resolved = toTerminalOutcome({ callStatus, answeredBy, callDuration })
    const terminal = resolved.terminal
    const outcome = resolved.outcome

    const metaPatch = {
      ...meta,
      twilio: {
        ...(meta?.twilio ?? {}),
        call_sid: callSid ?? (payload?.twilio_call_sid ?? null),
        call_status: callStatus,
        answered_by: answeredBy,
        call_duration: callDuration,
        last_callback_at: new Date().toISOString(),
        version: VERSION,
      },
      outcome: terminal ? outcome : (meta?.outcome ?? null),
    }

    if (!terminal) {
      await supabase.from("touch_runs").update({ status: "executing", meta: metaPatch }).eq("id", run.id)
      return json({ ok: true, terminal: false, outcome, version: VERSION })
    }

    const advanceOn = payload?.routing?.advance_on ?? payload?.routing?.advanceOn ?? "sent"
    const optedIn = advanceOn === "call_status"
    const isVoice = String(run.channel || "").toLowerCase() === "voice"

    const finalStatus = outcome === "answered" ? "sent" : "failed"
    await supabase
      .from("touch_runs")
      .update({
        status: finalStatus,
        meta: metaPatch,
        error: outcome === "answered" ? null : `twilio_${outcome}`,
        sent_at: new Date().toISOString(),
      })
      .eq("id", run.id)

    let scheduled: any = null
    if (optedIn && isVoice) {
      const routing = payload?.routing ?? {}
      const maxAttempts = Number(routing?.fallback?.max_attempts?.voice ?? 2)
      const attemptsDone = Number(routing?.attempts_done ?? 0) + 1
      const nextStep = Number(run.step ?? 1) + 1

      const shouldRetry = ["no_answer", "machine", "busy", "failed"].includes(outcome) && attemptsDone < maxAttempts
      const shouldFallbackToWhatsApp = ["no_answer", "machine", "busy", "failed"].includes(outcome) && attemptsDone >= maxAttempts

      try {
        await supabase
          .from("touch_runs")
          .update({
            payload: {
              ...(payload ?? {}),
              routing: {
                ...(routing ?? {}),
                attempts_done: attemptsDone,
                last_outcome: outcome,
              },
            },
          })
          .eq("id", run.id)
      } catch {}

      if (shouldRetry) {
        scheduled = await insertNextTouchIfExists({
          supabase,
          account_id: run.account_id,
          campaign_id: run.campaign_id,
          lead_id: run.lead_id,
          next_step: nextStep,
          preferred_channel: "voice",
          previous_touch_id: run.id,
        })
      } else if (shouldFallbackToWhatsApp) {
        scheduled = await insertNextTouchIfExists({
          supabase,
          account_id: run.account_id,
          campaign_id: run.campaign_id,
          lead_id: run.lead_id,
          next_step: nextStep,
          preferred_channel: "whatsapp",
          previous_touch_id: run.id,
        })
      }
    }

    try {
      await logEvaluation(supabase, {
        scope: "lead",
        actor: "webhook",
        label: "twilio_voice_status_terminal",
        account_id: run.account_id,
        entity_id: run.lead_id,
        kpis: { terminal: 1, answered: outcome === "answered" ? 1 : 0 },
        notes: `touch_run_id=${run.id} outcome=${outcome} scheduled=${scheduled?.created ? "yes" : "no"}`,
      })
    } catch {}

    return json({ ok: true, terminal: true, outcome, scheduled, version: VERSION })
  }

  // Default: nothing to do (avoid breaking random callbacks)
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`)
})

export const config = { verify_jwt: false }


