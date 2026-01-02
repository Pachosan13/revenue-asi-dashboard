import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function cleanE164(pa: string) {
  const raw = String(pa ?? "").trim()
  const digits = raw.replace(/[^\d+]/g, "")
  if (digits.startsWith("+")) return digits
  // assume country code missing
  return `+${digits}`
}

function isValidE164(p: string) {
  return /^\+\d{8,15}$/.test(p)
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, error: "Use POST" }, 405)

  const SB_URL = Deno.env.get("SUPABASE_URL")?.trim()
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || Deno.env.get("SERVICE_ROLE_KEY")?.trim()
  if (!SB_URL || !SB_KEY) return json({ ok: false, error: "Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500)

  const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")?.trim()
  const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")?.trim()
  const TWILIO_FROM = (Deno.env.get("TWILIO_VOICE_FROM") ?? Deno.env.get("TWILIO_FROM_NUMBER"))?.trim()

  // We don't require Twilio creds for dry-run, but we validate them for real calls.

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const account_id = String(body.account_id || "").trim()
  if (!account_id) return json({ ok: false, error: "account_id required" }, 400)

  const to_phone = cleanE164(body.to_phone || "")
  if (!isValidE164(to_phone)) return json({ ok: false, error: "invalid to_phone (must be E.164)", to_phone }, 400)

  const dry_run = body.dry_run !== false // default true

  const make = String(body.make ?? "Jeep").trim() || "Jeep"
  const model = String(body.model ?? "Wrangler").trim() || "Wrangler"
  const year = Number(body.year ?? 2007)
  const price = Number(body.price ?? 14000)

  const listing_url = String(body.url ?? "https://www.encuentra24.com/panama-es/autos-usados/jeep-wrangler-2007-test/00000000").trim()
  const seller_name = String(body.seller_name ?? "Vendedor").trim()

  const supabase = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  })

  // Ensure provider row exists for this account/channel (voice)
  await supabase
    .from("account_provider_settings")
    .upsert(
      {
        account_id,
        channel: "voice",
        provider: "twilio",
        is_default: true,
        config: {},
      } as any,
      { onConflict: "account_id,channel,is_default" },
    )

  // Insert a lead (idempotent by partial unique index account_id+phone).
  // Note: PostgREST upsert can't target partial unique indexes directly, so we do:
  // - try insert
  // - if duplicate, select existing lead id
  const enriched = {
    source: "encuentra24",
    enc24: {
      listing_url,
      raw: {
        stage1: {
          make,
          model,
          year: Number.isFinite(year) ? year : null,
          price: Number.isFinite(price) ? price : null,
          city: "Panamá",
        },
      },
    },
    test: {
      kind: "twilio_test_call",
      at: new Date().toISOString(),
    },
  }

  let lead_id: string | null = null
  {
    const { data: ins, error: insErr } = await supabase
      .from("leads")
      .insert({
        account_id,
        phone: to_phone,
        contact_name: seller_name,
        status: "new",
        enriched,
        updated_at: new Date().toISOString(),
      } as any)
      .select("id")
      .maybeSingle()

    if (!insErr && ins?.id) {
      lead_id = String(ins.id)
    } else {
      // fallback: try select existing lead by (account_id, phone)
      const { data: ex, error: exErr } = await supabase
        .from("leads")
        .select("id")
        .eq("account_id", account_id)
        .eq("phone", to_phone)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (exErr || !ex?.id) {
        return json(
          {
            ok: false,
            stage: "insert_lead",
            error: insErr?.message ?? "lead_insert_failed",
            details: exErr?.message ?? null,
          },
          500,
        )
      }
      lead_id = String(ex.id)
    }
  }

  if (!lead_id) return json({ ok: false, stage: "lead_id", error: "lead_id_missing" }, 500)

  // Ensure the lead has the desired Enc24-style enriched payload for the voice script.
  // (If the lead already existed, we still patch it.)
  await supabase
    .from("leads")
    .update({
      contact_name: seller_name,
      phone: to_phone,
      enriched, // overwrite for deterministic test
      updated_at: new Date().toISOString(),
    } as any)
    .eq("id", lead_id)

  // Create a single voice touch_run for this lead
  const payload = {
    voice: { mode: "interactive_v1" },
    routing: { advance_on: "call_status" },
    delivery: { body: "test" },
    meta: {
      test: true,
      scenario: { make, model, year, price },
    },
  }

  const scheduled_at = new Date().toISOString()

  // If there's already a voice touch for this lead, reuse it to avoid unique constraint collisions.
  // (Some environments enforce one touch per lead/channel across multiple statuses.)
  let touch_run_id: string | null = null
  {
    const { data: existing } = await supabase
      .from("touch_runs")
      .select("id")
      .eq("account_id", account_id)
      .eq("lead_id", lead_id)
      .eq("channel", "voice")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()

    if (existing?.id) {
      touch_run_id = String(existing.id)
      // update payload + scheduled_at so the next call uses the intended scenario
      await supabase
        .from("touch_runs")
        .update({
          payload,
          scheduled_at,
          status: "queued",
          meta: { created_by: "twilio-test-call", reused: true },
        } as any)
        .eq("id", touch_run_id)
    } else {
      const { data: trRow, error: trErr } = await supabase
        .from("touch_runs")
        .insert({
          account_id,
          lead_id,
          campaign_id: null,
          campaign_run_id: null,
          // Use a high step number to avoid collisions with real campaign steps
          step: 9001,
          channel: "voice",
          payload,
          scheduled_at,
          status: "queued",
          meta: { created_by: "twilio-test-call" },
        } as any)
        .select("id")
        .single()

      if (trErr || !trRow?.id) return json({ ok: false, stage: "insert_touch_run", error: trErr?.message ?? "touch_run_insert_failed" }, 500)
      touch_run_id = String(trRow.id)
    }
  }

  if (!touch_run_id) return json({ ok: false, stage: "touch_run_id", error: "touch_run_id_missing" }, 500)

  // Build Twilio webhook URLs (cloud)
  const projectRef = (() => {
    try {
      const u = new URL(SB_URL)
      return u.hostname.split(".")[0]
    } catch {
      return null
    }
  })()

  const voiceWebhookBaseUrl = projectRef ? `https://${projectRef}.functions.supabase.co/voice-webhook` : null
  if (!voiceWebhookBaseUrl) return json({ ok: false, stage: "voice_webhook_url", error: "cannot_resolve_project_ref" }, 500)

  const twimlUrl = `${voiceWebhookBaseUrl}?mode=twiml&touch_run_id=${encodeURIComponent(touch_run_id)}&state=start`
  const statusCb = `${voiceWebhookBaseUrl}?mode=status&touch_run_id=${encodeURIComponent(touch_run_id)}`

  if (!dry_run) {
    if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
      return json({ ok: false, stage: "twilio_env", error: "missing_twilio_voice_env" }, 500)
    }
  }

  let twilio: any = null
  if (!dry_run) {
    // Twilio call create (direct) so we don't accidentally process other queued runs.
    const basic = btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`)
    const params = new URLSearchParams()
    params.set("To", to_phone)
    params.set("From", TWILIO_FROM!)
    params.set("Url", twimlUrl)
    params.set("Method", "POST")
    params.set("StatusCallback", statusCb)
    params.set("StatusCallbackMethod", "POST")
    for (const ev of ["initiated", "ringing", "answered", "completed"] as const) {
      params.append("StatusCallbackEvent", ev)
    }

    const callRes = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Calls.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    })

    const callText = await callRes.text().catch(() => "")
    let callJson: any = null
    try {
      callJson = callText ? JSON.parse(callText) : null
    } catch {
      callJson = { raw: callText }
    }

    twilio = { ok: callRes.ok, status: callRes.status, result: callJson }

    if (callRes.ok) {
      const callSid = callJson?.sid ?? null
      await supabase
        .from("touch_runs")
        .update({
          status: "executing",
          executed_at: new Date().toISOString(),
          meta: { created_by: "twilio-test-call", call: { sid: callSid, to: to_phone, from: TWILIO_FROM, twimlUrl, statusCb } },
        } as any)
        .eq("id", touch_run_id)
    }
  }

  return json({
    dry_run,
    lead_id,
    touch_run_id,
    to_phone,
    twiml_url: twimlUrl,
    status_callback_url: statusCb,
    twilio,
    note: dry_run
      ? "Dry-run: NO se hizo llamada real. Re-intenta con dry_run=false para llamar (Twilio cobra)."
      : "Llamada real disparada. Si no suena, revisa Twilio (Geo permissions Panamá + número verificado si es trial).",
  })
})


