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
import { createClient } from "jsr:@supabase/supabase-js@2"
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
  // heartbeat: ensure updated_at moves so DB reapers don't kill active runs
  await supabase.from("touch_runs").update({ meta: next, updated_at: new Date().toISOString() }).eq("id", touchRunId)
}

async function emitDispatchEvent(
  supabase: any,
  args: { touch_run_id: string; account_id: string; provider: string; event: string; payload: any },
) {
  try {
    await supabase.from("dispatch_events").insert({
      touch_run_id: args.touch_run_id,
      account_id: args.account_id,
      channel: "voice",
      provider: args.provider,
      event: args.event,
      payload: args.payload ?? {},
    })
  } catch {
    // best-effort
  }
}

function mapTelnyxEventToVoiceStatus(eventType: string | null, hangupCause: string | null) {
  const t = String(eventType ?? "").toLowerCase()
  if (!t) return "unknown"
  if (t.includes("call.answered")) return "answered"
  if (t.includes("call.ringing") || t.includes("call.initiated")) return "ringing"
  if (t.includes("call.failed")) return "failed"
  if (t.includes("call.hangup") || t.includes("call.completed") || t.includes("streaming.stopped")) {
    // if Telnyx provides a hard failure cause we can still mark completed but keep last_error
    return "completed"
  }
  // fallback: keep raw type (but cap length)
  return t.slice(0, 64)
}

async function upsertVoiceCallMerged(
  supabase: any,
  args: {
    touch_run_id: string
    lead_id: string
    provider: "telnyx" | "twilio"
    from_phone: string | null
    to_phone: string | null
    provider_call_id: string | null
    provider_job_id: string | null
    status: string
    last_error: string | null
    meta_patch: any
    started_at?: string | null
    ended_at?: string | null
  },
) {
  const nowIso = new Date().toISOString()
  let existing: any = null
  try {
    const { data } = await supabase
      .from("voice_calls")
      .select("meta, from_phone, to_phone, provider_call_id, provider_job_id, provider")
      .eq("touch_run_id", args.touch_run_id)
      .maybeSingle()
    existing = data ?? null
  } catch {
    existing = null
  }

  const mergedMeta = {
    ...((existing?.meta ?? {}) as any),
    ...(args.meta_patch ?? {}),
    updated_at: nowIso,
    version: VERSION,
  }

  const fromPhone = args.from_phone ?? existing?.from_phone ?? null
  const toPhone = args.to_phone ?? existing?.to_phone ?? null

  // voice_calls requires from_phone/to_phone NOT NULL. If we can't resolve them, skip (but do not throw).
  if (!fromPhone || !toPhone) return

  try {
    await supabase.from("voice_calls").upsert(
      {
        id: args.touch_run_id, // stable id (uuid)
        lead_id: args.lead_id,
        touch_run_id: args.touch_run_id,
          channel: "voice",
        provider: args.provider,
        provider_call_id: args.provider_call_id ?? existing?.provider_call_id ?? null,
        provider_job_id: args.provider_job_id ?? existing?.provider_job_id ?? null,
        from_phone: fromPhone,
        to_phone: toPhone,
        status: args.status,
        scheduled_at: nowIso,
        started_at: args.started_at ?? null,
        ended_at: args.ended_at ?? null,
        last_error: args.last_error,
        meta: mergedMeta,
        created_at: nowIso,
        updated_at: nowIso,
      },
      { onConflict: "touch_run_id" },
    )
  } catch {
    // best-effort
  }
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
  const TELNYX_API_KEY = Deno.env.get("TELNYX_API_KEY") ?? Deno.env.get("Telnyx_Api") ?? null
  const VOICE_GATEWAY_TOKEN = String(Deno.env.get("VOICE_GATEWAY_TOKEN") ?? "").trim()
  const STREAM_URL = `wss://revenue-asi-voice-gateway.fly.dev/telnyx?token=${VOICE_GATEWAY_TOKEN}`
  const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } }) : null

  const url = new URL(req.url)
  const audioUrl = url.searchParams.get("audio_url")
  const mode = url.searchParams.get("mode") // twiml | status | telnyx_status | tts_smoke | null
  const touchRunId = url.searchParams.get("touch_run_id")
  const state = url.searchParams.get("state") ?? "start"

  function safeBase64Json(s: string | null): any | null {
    if (!s) return null
    try {
      const raw = atob(s)
      return JSON.parse(raw)
    } catch {
      try {
        return JSON.parse(s)
      } catch {
        return null
      }
    }
  }

  function isMissingMedia(bodyText: string, status: number | null) {
    const s = String(bodyText || "").toLowerCase()
    if (status === 404) return true
    // Telnyx commonly returns 422 with "Invalid media name" when media is not present.
    if (s.includes("invalid media name")) return true
    if (s.includes("\"code\": \"90039\"") || (s.includes("code") && s.includes("90039"))) return true
    return (
      s.includes("media") &&
      (s.includes("not found") || s.includes("does not exist") || s.includes("unknown") || s.includes("missing"))
    )
  }

  async function openaiIntroTtsMp3Bytes(args: { text: string }) {
    const OPENAI_KEY = Deno.env.get("OPENAI_API_KEY") ?? null
    if (!OPENAI_KEY) return { ok: false, bytes: null as Uint8Array | null, error: "missing_openai_api_key" }

    const controller = new AbortController()
    const t = setTimeout(() => controller.abort(), 2000) // keep it fast

    try {
      const res = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${OPENAI_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o-mini-tts",
          voice: "alloy",
          input: String(args.text || ""),
          format: "mp3",
        }),
      })

      if (!res.ok) {
        const txt = await res.text().catch(() => "")
        return { ok: false, bytes: null, error: txt || `openai_http_${res.status}` }
      }

      const buf = await res.arrayBuffer()
      const bytes = new Uint8Array(buf)
      if (!bytes.length) return { ok: false, bytes: null, error: "empty_audio" }
      return { ok: true, bytes, error: null }
      } catch (e) {
      const msg = String((e as any)?.message ?? e)
      if (msg.toLowerCase().includes("aborted")) return { ok: false, bytes: null, error: "openai_timeout" }
      return { ok: false, bytes: null, error: msg }
    } finally {
      clearTimeout(t)
    }
  }

  // ---- TTS smoke test (NO Telnyx call) ----
  if (mode === "tts_smoke") {
    const t0 = Date.now()
    console.log("TTS_SMOKE_START")

    const key = Deno.env.get("OPENAI_API_KEY") ?? ""
    const keyPrefix = key ? key.slice(0, 7) : null

    const tts = await openaiIntroTtsMp3Bytes({ text: "Hola—prueba." })
    const ms = Date.now() - t0

    console.log("TTS_SMOKE_DONE", {
      ok: tts.ok,
      bytes: tts.bytes?.length ?? null,
      ms,
      err: String(tts.error ?? "").slice(0, 120),
      key_present: Boolean(key),
      key_prefix: keyPrefix,
    })

    return json(
      {
        ok: tts.ok,
        bytes: tts.bytes?.length ?? null,
        error: tts.ok ? null : String(tts.error ?? "tts_failed"),
        key_present: Boolean(key),
        key_prefix: keyPrefix,
        ms,
      },
      tts.ok ? 200 : 500,
    )
  }
  // ---- end smoke test ----

  async function telnyxSpeak(args: { call_control_id: string; text: string }) {
    if (!TELNYX_API_KEY) return { ok: false, status: null, body: "missing_telnyx_api_key" }
    const ccid = String(args.call_control_id || "").trim()
    if (!ccid) return { ok: false, status: null, body: "missing_call_control_id" }

    // Telnyx payload formats vary across docs/versions. We attempt the simplest first,
    // then fall back to the structured payload.
    const url = `https://api.telnyx.com/v2/calls/${encodeURIComponent(ccid)}/actions/speak`
    const headers = {
      Authorization: `Bearer ${TELNYX_API_KEY}`,
      "Content-Type": "application/json",
    }

    const attempt = async (bodyObj: any) => {
      const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(bodyObj) })
      const txt = await res.text().catch(() => "")
      return { ok: res.ok, status: res.status, body: txt }
    }

    // Attempt A: common call-control shape (voice is required in some accounts)
    const a = await attempt({ payload: String(args.text || ""), voice: "female", language: "es-PA" })
    if (a.ok) return a

    // Attempt B: payload as a plain string
    const b1 = await attempt({ payload: String(args.text || "") })
    if (b1.ok) return b1

    // Attempt C: structured payload (tts settings)
    const b = await attempt({
      payload: {
        language: "es-PA",
        voice: "female",
        text: String(args.text || ""),
      },
    })
    return b
  }

  async function telnyxAnswer(args: { call_control_id: string }) {
    if (!TELNYX_API_KEY) return { ok: false, status: null, body: "missing_telnyx_api_key" }
    const ccid = String(args.call_control_id || "").trim()
    if (!ccid) return { ok: false, status: null, body: "missing_call_control_id" }
    const res = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(ccid)}/actions/answer`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    })
    const txt = await res.text().catch(() => "")
    return { ok: res.ok, status: res.status, body: txt }
  }

  async function telnyxPlaybackStart(args: { call_control_id: string; audio_url: string }) {
    if (!TELNYX_API_KEY) return { ok: false, status: null, body: "missing_telnyx_api_key" }
    const ccid = String(args.call_control_id || "").trim()
    const audioUrl = String(args.audio_url || "").trim()
    if (!ccid) return { ok: false, status: null, body: "missing_call_control_id" }
    if (!audioUrl) return { ok: false, status: null, body: "missing_audio_url" }

    const res = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(ccid)}/actions/playback_start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ audio_url: audioUrl }),
    })
    const txt = await res.text().catch(() => "")
    return { ok: res.ok, status: res.status, body: txt }
  }

  async function telnyxPlaybackStartByMediaName(args: { call_control_id: string; media_name: string; command_id: string }) {
    if (!TELNYX_API_KEY) return { ok: false, status: null, body: "missing_telnyx_api_key" }
    const ccid = String(args.call_control_id || "").trim()
    const mediaName = String(args.media_name || "").trim()
    if (!ccid) return { ok: false, status: null, body: "missing_call_control_id" }
    if (!mediaName) return { ok: false, status: null, body: "missing_media_name" }

    const res = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(ccid)}/actions/playback_start`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TELNYX_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        media_name: mediaName,
        target_legs: "self",
        overlay: false,
        cache_audio: true,
        command_id: args.command_id,
      }),
    })
    const txt = await res.text().catch(() => "")
    return { ok: res.ok, status: res.status, body: txt }
  }

  async function telnyxUploadMedia(args: { media_name: string; ttl_secs: number; mp3_bytes: Uint8Array }) {
    if (!TELNYX_API_KEY) return { ok: false, status: null, body: "missing_telnyx_api_key" }
    const mediaName = String(args.media_name || "").trim()
    if (!mediaName) return { ok: false, status: null, body: "missing_media_name" }

    const form = new FormData()
    form.set("media_name", mediaName)
    // Telnyx validates ttl_secs strictly (< 630720000 in our observed error).
    const ttl = Math.max(60, Math.min(Number(args.ttl_secs || 0), 630719999))
    form.set("ttl_secs", String(ttl))
    const blob = new Blob([args.mp3_bytes], { type: "audio/mpeg" })
    // Telnyx expects "media" (or media_url), not "file".
    form.set("media", blob, `${mediaName}.mp3`)

    const res = await fetch("https://api.telnyx.com/v2/media", {
      method: "POST",
      headers: { Authorization: `Bearer ${TELNYX_API_KEY}` },
      body: form,
    })
    const txt = await res.text().catch(() => "")
    return { ok: res.ok, status: res.status, body: txt }
  }

  function prettySource(s: string) {
    const v = String(s || "").trim().toLowerCase()
    if (!v) return "internet"
    if (v.includes("encuentra24") || v === "enc24") return "Encuentra24"
    return s
  }

  async function resolveLeadSource(args: { supabase: any; lead_id: string }) {
    const { supabase, lead_id } = args
    try {
      const { data: l } = await supabase.from("leads").select("source, enriched").eq("id", lead_id).maybeSingle()
      const src = String((l as any)?.source ?? "").trim()
      if (src) return src
      const enc = (l as any)?.enriched?.enc24 ? "encuentra24" : ""
      return enc || ""
    } catch {
      return ""
    }
  }

  function buildGreetingText(args: { sourceLabel: string }) {
    const source = args.sourceLabel || "internet"
    return (
      "Hola, ¿hablo con el dueño del carro? " +
      `Te llamo porque vi el anuncio que acabas de subir hace unos minutos en ${source}. ` +
      "¿Todavía está disponible y listo para mostrarse? " +
      "Si sí, ¿hoy a qué hora te va bien y en qué zona estás? " +
      "Perfecto. Con eso te paso de inmediato con Darmesh para coordinar y ver si lo cerramos hoy."
    )
  }

  async function renderVoiceUrl(args: { lead_id: string; text: string }) {
    const leadId = String(args.lead_id || "").trim()
    const text = String(args.text || "").trim()
    if (!SB_URL || !SB_KEY) return { ok: false, publicUrl: null, error: "missing_supabase_env" }
    if (!leadId || !text) return { ok: false, publicUrl: null, error: "missing_lead_id_or_text" }

    const projectRef = (() => {
      try {
        const u = new URL(SB_URL)
        return u.hostname.split(".")[0]
      } catch {
        return null
      }
    })()
    if (!projectRef) return { ok: false, publicUrl: null, error: "missing_project_ref" }

    const endpoint = `https://${projectRef}.functions.supabase.co/render-voice`
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SB_KEY,
        Authorization: `Bearer ${SB_KEY}`,
      },
      body: JSON.stringify({
        lead_id: leadId,
        text,
        // defaults in render-voice: model=gpt-4o-mini-tts, voice=alloy, bucket=voice
        timeout_ms: 8000,
      }),
    })
    const txt = await res.text().catch(() => "")
    let j: any = null
    try {
      j = txt ? JSON.parse(txt) : null
    } catch {
      j = { raw: txt }
    }
    const publicUrl = (j as any)?.publicUrl ?? null
    if (!res.ok || !publicUrl) {
      return {
        ok: false,
        publicUrl: publicUrl ?? null,
        error: j?.error?.message ?? j?.error ?? txt ?? `http_${res.status}`,
      }
    }
    return { ok: true, publicUrl, error: null }
  }

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

    const { data: tr } = await supabase.from("touch_runs").select("id, lead_id, payload").eq("id", touchRunId).maybeSingle()

    if (!tr?.id) {
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Gracias. Te escribo por WhatsApp para coordinar.</Say><Hangup/></Response>`,
      )
    }

    const payload: any = tr.payload ?? {}
    const buyer = String(payload?.voice?.buyer_name ?? "Darmesh").trim() || "Darmesh"
    const listing = payload?.voice?.listing ?? {}
    const carLabel = String(listing?.car_label ?? "").trim() || String(listing?.model ?? "").trim() || "carro"

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
        return xmlResponse(
          buildGather({
            actionUrl: action("available_busy"),
            say: "Tranquilo, lo hago rápido. ¿Todavía está disponible? Marca 1 sí, 2 no.",
            numDigits: 1,
            timeoutSec: 5,
          }),
        )
      }
      if (cls === "no" || cls === "wrong") {
        return xmlResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Perfecto, disculpa la molestia. Gracias.</Say><Hangup/></Response>`,
        )
      }
      if (cls === "sold") {
        return xmlResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Perfecto, gracias por avisar. Que tengas buena tarde.</Say><Hangup/></Response>`,
        )
      }
      if (cls === "dealer") {
        return xmlResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Gracias. En este momento buscamos trato directo con dueño. Que tengas buena tarde.</Say><Hangup/></Response>`,
        )
      }
      return xmlResponse(buildGather({ actionUrl: action("available"), say: "Perfecto. ¿Todavía está disponible? Marca 1 sí, 2 no.", numDigits: 1, timeoutSec: 5 }))
    }

    if (state === "available" || state === "available_busy") {
      const yn = classifyYesNo(speech, digits)
      await patchVoiceMeta(supabase, touchRunId, { available: { digits, speech, confidence, value: yn } }).catch(() => {})
      if (yn === "no") {
        return xmlResponse(
          `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">Listo, gracias. Que tengas buena tarde.</Say><Hangup/></Response>`,
        )
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
      return xmlResponse(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice" language="es-PA">${escXml(
          yn === "yes" ? "Perfecto. Te escribo por WhatsApp en este mismo número para confirmar. Gracias." : "Perfecto. Gracias por tu tiempo.",
        )}</Say><Hangup/></Response>`,
      )
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
      // heartbeat: ensure updated_at moves so DB reapers don't kill active runs
      await supabase.from("touch_runs").update({ status: "executing", meta: metaPatch, updated_at: new Date().toISOString() }).eq("id", run.id)

      await emitDispatchEvent(supabase, {
        touch_run_id: run.id,
        account_id: run.account_id,
        provider: "twilio",
        event: "webhook_event",
        payload: { call_status: callStatus, answered_by: answeredBy, call_sid: callSid, terminal: false },
      })

      const runPayload = (run.payload ?? {}) as any
      const fromPhone = (runPayload?.from ?? runPayload?.provider_config?.from ?? null) as string | null
      const toPhone = (runPayload?.to ?? runPayload?.to_normalized ?? null) as string | null
      await upsertVoiceCallMerged(supabase, {
        touch_run_id: run.id,
        lead_id: run.lead_id,
          provider: "twilio",
        from_phone: fromPhone,
        to_phone: toPhone,
        provider_call_id: callSid ?? (runPayload?.twilio_call_sid ?? null),
        provider_job_id: callSid ?? (runPayload?.twilio_call_sid ?? null),
        status: String(outcome || "unknown"),
        last_error: null,
        meta_patch: { twilio: metaPatch.twilio ?? null },
      })
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
        updated_at: new Date().toISOString(),
      })
      .eq("id", run.id)

    await emitDispatchEvent(supabase, {
      touch_run_id: run.id,
      account_id: run.account_id,
      provider: "twilio",
      event: "webhook_event",
      payload: { call_status: callStatus, answered_by: answeredBy, call_sid: callSid, terminal: true, outcome },
    })

    {
      const runPayload = (run.payload ?? {}) as any
      const fromPhone = (runPayload?.from ?? runPayload?.provider_config?.from ?? null) as string | null
      const toPhone = (runPayload?.to ?? runPayload?.to_normalized ?? null) as string | null
      const vcStatus = outcome === "answered" ? "answered" : (outcome === "failed" ? "failed" : "completed")
      await upsertVoiceCallMerged(supabase, {
        touch_run_id: run.id,
        lead_id: run.lead_id,
        provider: "twilio",
        from_phone: fromPhone,
        to_phone: toPhone,
        provider_call_id: callSid ?? (runPayload?.twilio_call_sid ?? null),
        provider_job_id: callSid ?? (runPayload?.twilio_call_sid ?? null),
        status: vcStatus,
        last_error: outcome === "answered" ? null : `twilio_${outcome}`,
        meta_patch: { twilio: metaPatch.twilio ?? null, outcome },
        ended_at: new Date().toISOString(),
      })
    }

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

  // ---- Telnyx webhook (call status events) ----
  if (mode === "telnyx_status") {
    if (!supabase) return json({ ok: true, ignored: true, reason: "missing_supabase_env", version: VERSION })

    const event = (await req.json().catch(() => ({}))) as any
    const eventType: string | null =
      (event?.data?.event_type as string | undefined) ??
      (event?.data?.eventType as string | undefined) ??
      (event?.event_type as string | undefined) ??
      null

    const payload = (event?.data?.payload ?? event?.payload ?? {}) as any
    const callControlId: string | null =
      (payload?.call_control_id as string | undefined) ??
      (payload?.callControlId as string | undefined) ??
      null

    // Deterministic logging for every Telnyx event
    console.log("TELNYX_IN", {
      event_type: eventType,
      call_control_id_present: Boolean(callControlId),
    })

    const clientStateRaw: string | null =
      (payload?.client_state as string | undefined) ??
      (payload?.clientState as string | undefined) ??
      null

    const clientState = safeBase64Json(clientStateRaw)
    const inferredTouchRunId =
      touchRunId ??
      (typeof clientState?.touch_run_id === "string" ? clientState.touch_run_id : null) ??
      (typeof clientState?.touchRunId === "string" ? clientState.touchRunId : null)

    if (!inferredTouchRunId) {
      // Manual Telnyx calls (portal / ad-hoc):
      // If there's no touch_run_id but we have call_control_id, start realtime streaming so the call isn't mute.
      if (eventType === "call.answered" && callControlId) {
        if (!VOICE_GATEWAY_TOKEN) {
          console.log("VOICE_GATEWAY_TOKEN_MISSING", { token_len: 0, token_prefix: "" })
          return json({ ok: false, error: "missing_voice_gateway_token", version: VERSION }, 500)
        }
        console.log("STREAM_URL_BUILT", { token_len: VOICE_GATEWAY_TOKEN.length, token_prefix: VOICE_GATEWAY_TOKEN.slice(0, 6) })
        if (TELNYX_API_KEY) {
          const manualTouchRunId = `manual_${String(callControlId).replace("v3:", "")}`
          const client_state_obj = {
            touch_run_id: manualTouchRunId,
            source: "manual_test",
            intent: "sell_only",
          }
          const client_state_b64 = btoa(JSON.stringify(client_state_obj))

          try {
            const url = `https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/streaming_start`
            const body = {
              stream_url: STREAM_URL,
              stream_track: "both_tracks",
              stream_codec: "PCMU",
              client_state: client_state_b64,
            }
            console.log("TELNYX_STREAMING_START_REQ", {
              call_control_id: callControlId,
              url,
              payload: JSON.stringify(body),
              stream_url: STREAM_URL,
            })

            const res = await fetch(
              url,
              {
              method: "POST",
              headers: {
                  Authorization: `Bearer ${TELNYX_API_KEY}`,
                "Content-Type": "application/json",
                },
                body: JSON.stringify(body),
              },
            )
            const txt = await res.text().catch(() => "")
            console.log("TELNYX_STREAMING_START_RES", {
              call_control_id: callControlId,
              status: res.status,
              ok: res.ok,
              response_preview: txt.slice(0, 300),
              content_type: String(res.headers.get("content-type") || ""),
            })

            // Required structured log (no secrets)
            console.log("TELNYX_MANUAL_FALLBACK", {
              event: "TELNYX_MANUAL_FALLBACK",
              call_control_id: callControlId,
              touch_run_id: manualTouchRunId,
              streaming_start_ok: res.ok,
              status: res.status,
            })
          } catch (e) {
            console.log("TELNYX_STREAMING_START_ERR", {
              call_control_id: callControlId,
              err: String((e as any)?.message ?? e),
            })
            console.log("TELNYX_MANUAL_FALLBACK", {
              event: "TELNYX_MANUAL_FALLBACK",
              call_control_id: callControlId,
              touch_run_id: manualTouchRunId,
              streaming_start_ok: false,
              status: null,
              err: String((e as any)?.message ?? e),
            })
          }

          return json({ ok: true, manual_fallback: true, touch_run_id: manualTouchRunId, version: VERSION })
        }
      }

      return json({ ok: true, ignored: true, reason: "missing_touch_run_id", event_type: eventType, version: VERSION })
    }

    const { data: run, error: rErr } = await supabase
      .from("touch_runs")
      .select("id, account_id, campaign_id, lead_id, step, channel, payload, meta")
      .eq("id", inferredTouchRunId)
      .maybeSingle()

    if (rErr) return json({ ok: false, error: rErr.message, version: VERSION }, 500)
    if (!run) return json({ ok: true, ignored: true, reason: "touch_run_not_found", version: VERSION })

    const runPayload = (run.payload ?? {}) as any
    const meta = (run.meta ?? {}) as any

    const hangupCause: string | null =
      (payload?.hangup_cause as string | undefined) ??
      (payload?.hangupCause as string | undefined) ??
      null

    const metaPatch = {
      ...meta,
      telnyx: {
        ...(meta?.telnyx ?? {}),
        event_type: eventType,
        call_control_id: callControlId ?? (runPayload?.telnyx_call_control_id ?? null),
        hangup_cause: hangupCause,
        client_state: clientState ?? null,
        in_last: {
          event_type: eventType,
          id: callControlId ?? null,
          has_call_control_id: Boolean(callControlId),
          received_at: new Date().toISOString(),
        },
        last_callback_at: new Date().toISOString(),
        version: VERSION,
      },
    }

    // Always record webhook event in dispatch_events (best-effort)
    await emitDispatchEvent(supabase, {
      touch_run_id: run.id,
      account_id: run.account_id,
      provider: "telnyx",
      event: "webhook_event",
      payload: {
        event_type: eventType,
        call_control_id: callControlId,
        hangup_cause: hangupCause,
      },
    })

    // Always update voice_calls for Telnyx events (best-effort)
    {
      const fromPhone =
        (runPayload?.provider_config?.telnyx_from as string | undefined) ??
        (runPayload?.provider_config?.from as string | undefined) ??
        (runPayload?.from as string | undefined) ??
        (payload?.from as string | undefined) ??
        null
      const toPhone =
        (runPayload?.to as string | undefined) ??
        (runPayload?.to_normalized as string | undefined) ??
        (payload?.to as string | undefined) ??
        null

      const vcStatus = mapTelnyxEventToVoiceStatus(eventType, hangupCause)
      const terminalEnded = vcStatus === "completed" || vcStatus === "failed"
      await upsertVoiceCallMerged(supabase, {
        touch_run_id: run.id,
        lead_id: run.lead_id,
        provider: "telnyx",
        from_phone: fromPhone,
        to_phone: toPhone,
        provider_call_id: callControlId ?? (runPayload?.telnyx_call_control_id ?? null),
        provider_job_id: null,
        status: vcStatus,
        last_error: vcStatus === "failed" ? (hangupCause ?? "telnyx_failed") : null,
        meta_patch: { telnyx: metaPatch.telnyx ?? null },
        started_at: vcStatus === "answered" ? new Date().toISOString() : null,
        ended_at: terminalEnded ? new Date().toISOString() : null,
      })
    }

    // Log playback events (if Telnyx sends them)
    if (eventType === "call.playback.started" || eventType === "call.playback.ended") {
      console.log("TELNYX_PLAYBACK_EVT", { event_type: eventType, call_control_id_present: Boolean(callControlId) })
    }

    // Answered flow: no fire-and-forget; no public URLs.
    if (eventType === "call.answered") {
      const ccid = (metaPatch?.telnyx?.call_control_id as string | null) ?? null
      console.log("TELNYX_ANSWERED", { call_control_id: ccid, touch_run_id: run.id, lead_id: run.lead_id })

      // update meta (fast)
      // heartbeat: ensure updated_at moves so DB reapers don't kill active runs
      await supabase.from("touch_runs").update({ status: "executing", meta: metaPatch, updated_at: new Date().toISOString() }).eq("id", run.id)

      // Realtime streaming calls: NEVER start playback here.
      // (1) check run payload voice mode, (2) check client_state voice_mode
      try {
        const payloadVoiceMode =
          (typeof runPayload?.voice?.mode === "string" ? runPayload.voice.mode : null) ??
          (typeof runPayload?.payload?.voice?.mode === "string" ? runPayload.payload.voice.mode : null)

        const cs =
          (clientState && typeof clientState === "object" ? clientState : null) ??
          safeBase64Json(clientStateRaw) ??
          null
        const clientVoiceMode = (cs?.voice_mode ?? cs?.voiceMode ?? null) as string | null

        const isRealtime =
          (typeof payloadVoiceMode === "string" && payloadVoiceMode.startsWith("realtime")) ||
          clientVoiceMode === "realtime"

        if (isRealtime) {
          console.log("TELNYX_REALTIME_SKIP_PLAYBACK", { touch_run_id: run.id, payloadVoiceMode, clientVoiceMode })
          return json({ ok: true, terminal: false, event_type: eventType, version: VERSION })
        }
      } catch {}

      // If the caller is configured for realtime streaming (Fly gateway), DO NOT start playback here.
      // The WS bridge will handle the greeting + conversation.
      try {
        const cs =
          (clientState && typeof clientState === "object" ? clientState : null) ??
          safeBase64Json(clientStateRaw) ??
          null
        const voiceMode = (cs?.voice_mode ?? cs?.voiceMode ?? null) as string | null
        if (voiceMode === "realtime") {
          console.log("TELNYX_STREAMING_MODE_SKIP_PLAYBACK", { touch_run_id: run.id })
          return json({ ok: true, terminal: false, event_type: eventType, version: VERSION })
        }
      } catch {}

      const MEDIA_NAME = String(Deno.env.get("TELNYX_INTRO_MEDIA_NAME") ?? "ra_intro_v1").trim()
      const INTRO_TEXT = String(Deno.env.get("INTRO_TEXT") ?? "Hola—un segundo.").trim()
      const INTRO_TTL_SECS = Number(Deno.env.get("INTRO_TTL_SECS") ?? "630720000")

      if (!ccid) {
        console.log("TELNYX_PLAYBACK_RES", { status: null, body: "missing_call_control_id" })
        return json({ ok: true, terminal: false, event_type: eventType, version: VERSION })
      }

      // 1) Playback by media_name
      const cmd1 = crypto.randomUUID()
      const pr1 = await telnyxPlaybackStartByMediaName({ call_control_id: ccid, media_name: MEDIA_NAME, command_id: cmd1 })
      console.log("TELNYX_PLAYBACK_RES", { status: pr1.status, body: String(pr1.body || "") })

      // 2) If missing media: bootstrap once (OpenAI TTS -> upload to Telnyx media -> retry playback)
      let finalPlayback = { status: pr1.status ?? null, ok: Boolean(pr1.ok), body: String(pr1.body || "") }
      let introTtsMeta: any = null
      let mediaUploadMeta: any = null
      let retryPlaybackMeta: any = null

      if (!pr1.ok && isMissingMedia(String(pr1.body || ""), pr1.status)) {
        const tts = await openaiIntroTtsMp3Bytes({ text: INTRO_TEXT })
        if (tts.ok && tts.bytes) {
          console.log("INTRO_TTS_OK", { bytes: tts.bytes.length })
          introTtsMeta = { ok: true, bytes: tts.bytes.length }

          const up = await telnyxUploadMedia({ media_name: MEDIA_NAME, ttl_secs: INTRO_TTL_SECS, mp3_bytes: tts.bytes })
          console.log("TELNYX_MEDIA_UPLOAD_RES", { status: up.status, body: String(up.body || "") })
          mediaUploadMeta = { ok: Boolean(up.ok), status: up.status ?? null, body: String(up.body || "").slice(0, 800) }

          const cmd2 = crypto.randomUUID()
          const pr2 = await telnyxPlaybackStartByMediaName({ call_control_id: ccid, media_name: MEDIA_NAME, command_id: cmd2 })
          console.log("TELNYX_PLAYBACK_RETRY_RES", { status: pr2.status, body: String(pr2.body || "") })
          finalPlayback = { status: pr2.status ?? null, ok: Boolean(pr2.ok), body: String(pr2.body || "") }
          retryPlaybackMeta = { ok: Boolean(pr2.ok), status: pr2.status ?? null, body: String(pr2.body || "").slice(0, 800), command_id: cmd2 }
        } else {
          console.log("INTRO_TTS_OK", { bytes: 0 })
          console.log("TELNYX_MEDIA_UPLOAD_RES", { status: null, body: String(tts.error || "tts_failed").slice(0, 400) })
          introTtsMeta = { ok: false, error: String(tts.error || "tts_failed").slice(0, 800) }
          mediaUploadMeta = { ok: false, status: null, body: String(tts.error || "tts_failed").slice(0, 800) }
        }
      }

      // Persist deterministic evidence in DB meta (so we don't depend on runtime logs)
      try {
        const nextMeta = {
          ...metaPatch,
          telnyx: {
            ...(metaPatch?.telnyx ?? {}),
            answered_at: new Date().toISOString(),
            playback_last: {
              media_name: MEDIA_NAME,
              status: finalPlayback.status,
              ok: finalPlayback.ok,
              body: finalPlayback.body.slice(0, 800),
              command_id: cmd1,
            },
            intro_tts_last: introTtsMeta,
            media_upload_last: mediaUploadMeta,
            playback_retry_last: retryPlaybackMeta,
          },
        }
        // heartbeat: ensure updated_at moves so DB reapers don't kill active runs
        await supabase.from("touch_runs").update({ meta: nextMeta, updated_at: new Date().toISOString() }).eq("id", run.id)
      } catch {}

      return json({ ok: true, terminal: false, event_type: eventType, version: VERSION })
    }

    // Initiated: keep storing meta (no blocking commands here).
    if (eventType === "call.initiated") {
      // heartbeat: ensure updated_at moves so DB reapers don't kill active runs
      await supabase.from("touch_runs").update({ status: "executing", meta: metaPatch, updated_at: new Date().toISOString() }).eq("id", run.id)
      return json({ ok: true, terminal: false, event_type: eventType, version: VERSION })
    }

    // Terminal: hangup maps outcome; schedule retries/fallback if advance_on=call_status.
    if (eventType === "call.hangup") {
      const cause = String(hangupCause ?? "").toLowerCase()
      const outcome =
        cause.includes("busy") ? "busy" :
        (cause.includes("no_answer") || cause.includes("no-answer") || cause.includes("timeout")) ? "no_answer" :
        cause.includes("machine") ? "machine" :
        "answered"

      const advanceOn = runPayload?.routing?.advance_on ?? runPayload?.routing?.advanceOn ?? "sent"
      const optedIn = advanceOn === "call_status"
      const isVoice = String(run.channel || "").toLowerCase() === "voice"

      const finalStatus = outcome === "answered" ? "sent" : "failed"
      await supabase
        .from("touch_runs")
        .update({
          status: finalStatus,
          meta: { ...metaPatch, outcome },
          error: outcome === "answered" ? null : `telnyx_${outcome}`,
          sent_at: new Date().toISOString(),
        })
        .eq("id", run.id)

      let scheduled: any = null
      if (optedIn && isVoice) {
        const routing = runPayload?.routing ?? {}
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
                ...(runPayload ?? {}),
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
          label: "telnyx_voice_status_terminal",
          account_id: run.account_id,
          entity_id: run.lead_id,
          kpis: { terminal: 1, answered: outcome === "answered" ? 1 : 0 },
          notes: `touch_run_id=${run.id} outcome=${outcome} scheduled=${scheduled?.created ? "yes" : "no"}`,
        })
      } catch {}

      return json({ ok: true, terminal: true, outcome, scheduled, version: VERSION })
    }

    // Non-terminal: store meta + keep executing
    // heartbeat: ensure updated_at moves so DB reapers don't kill active runs
    await supabase.from("touch_runs").update({ status: "executing", meta: metaPatch, updated_at: new Date().toISOString() }).eq("id", run.id)
    return json({ ok: true, terminal: false, event_type: eventType, version: VERSION })
  }

  // Default: nothing to do (avoid breaking random callbacks)
  return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`)
})

export const config = { verify_jwt: false }
