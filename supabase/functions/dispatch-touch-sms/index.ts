// supabase/functions/dispatch-touch-sms/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-sms-v2_2025-12-09_multitenant"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

// ----------------------------------------------
// PHONE CLEANUP
// ----------------------------------------------
function cleanPhone(p: string | null): string | null {
  if (!p) return null
  return p.replace(/\s+/g, "").trim()
}

function isValidE164(p: string | null) {
  if (!p) return false
  return /^\+\d{8,15}$/.test(p)
}

// ----------------------------------------------
// TWILIO SMS
// ----------------------------------------------
async function sendTwilioSMS({
  sid,
  token,
  from,
  to,
  body,
}: {
  sid: string
  token: string
  from: string
  to: string
  body: string
}) {
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: "Basic " + btoa(`${sid}:${token}`),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        To: to,
        From: from,
        Body: body,
      }),
    },
  )

  if (!res.ok) throw new Error(await res.text())
  return await res.json()
}

// ----------------------------------------------
// HANDLER
// ----------------------------------------------
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({ ok: false, error: "Missing Supabase env" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  // global QA
  const QA_SINK = Deno.env.get("QA_SMS_SINK") ?? null
  const DRY_DEFAULT = Deno.env.get("DRY_RUN_SMS") === "true"

  // body parsing
  let body: any = {}
  try {
    body = await req.json()
  } catch {}

  const limit = Math.min(100, Number(body.limit ?? 50))
  const dry_run = Boolean(body.dry_run ?? DRY_DEFAULT)

  // ----------------------------------------------
  // 1) GET touch_runs (now uses account_id)
  // ----------------------------------------------
  const { data: runs, error: rErr } = await supabase
    .from("touch_runs")
    .select("id, lead_id, account_id, payload, scheduled_at")
    .eq("channel", "sms")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true })
    .limit(limit)

  if (rErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "select_runs",
        error: rErr.message,
      }),
      {
        status: 500,
        headers: corsHeaders,
      },
    )
  }

  if (!runs?.length) {
    await logEvaluation({
      supabase,
      event_type: "evaluation",
      actor: "dispatcher",
      label: "dispatch_touch_sms_v2",
      kpis: { channel: "sms", processed: 0, failed: 0 },
      notes: "No SMS runs to dispatch",
    })

    return new Response(
      JSON.stringify({ ok: true, version: VERSION, processed: 0 }),
      { headers: corsHeaders },
    )
  }

  let processed = 0
  const errors: any[] = []

  // ----------------------------------------------
  // PROCESS EACH RUN
  // ----------------------------------------------
  for (const run of runs) {
    try {
      if (!run.account_id) {
        throw new Error("missing_account_id_on_touch_run")
      }

      // 1) Resolve provider from account settings
      const { data: providerRow, error: provErr } = await supabase
        .from("account_provider_settings")
        .select("provider, config")
        .eq("account_id", run.account_id)
        .eq("channel", "sms")
        .eq("is_default", true)
        .maybeSingle()

      if (provErr) throw new Error(`provider_lookup_failed:${provErr.message}`)
      if (!providerRow?.provider) {
        throw new Error("no_default_provider_for_sms")
      }

      const provider = providerRow.provider
      const providerConfig =
        (providerRow.config ?? {}) as Record<string, unknown>

      if (provider !== "twilio") {
        throw new Error(`unsupported_provider:${provider}`)
      }

      // Twilio global env (por ahora)
      const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID") || ""
      const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN") || ""
      const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER") || ""

      if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
        throw new Error("missing_twilio_env")
      }

      // 2) Fetch lead number
      const { data: lead } = await supabase
        .from("lead_enriched")
        .select("phone")
        .eq("id", run.lead_id)
        .maybeSingle()

      const phone = cleanPhone(lead?.phone ?? null)
      if (!isValidE164(phone)) throw new Error("invalid_or_missing_phone")

      const to = QA_SINK ?? phone
      const message = run.payload?.message ?? run.payload?.body ?? "Hola!"

      // 3) Send SMS
      if (!dry_run) {
        await sendTwilioSMS({
          sid: TWILIO_SID,
          token: TWILIO_TOKEN,
          from: TWILIO_FROM,
          to,
          body: message,
        })
      }

      // 4) Update run
      await supabase
        .from("touch_runs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          error: null,
          payload: { ...(run.payload ?? {}), provider, providerConfig, to, dry_run },
        })
        .eq("id", run.id)

      processed++
    } catch (e: any) {
      const msg = e.message ?? String(e)
      errors.push({ id: run.id, lead_id: run.lead_id, error: msg })

      await supabase
        .from("touch_runs")
        .update({ status: "failed", error: msg })
        .eq("id", run.id)
    }
  }

  // ----------------------------------------------
  // 5) LOG SUMMARY
  // ----------------------------------------------
  try {
    await logEvaluation({
      supabase,
      event_type: "evaluation",
      actor: "dispatcher",
      label: "dispatch_touch_sms_v2",
      kpis: {
        channel: "sms",
        processed,
        failed: errors.length,
        dry_run,
      },
      notes:
        errors.length === 0
          ? "All SMS dispatched successfully"
          : `SMS dispatch completed with ${errors.length} errors`,
    })
  } catch (e) {
    console.error("logEvaluation failed", e)
  }

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      processed,
      failed: errors.length,
      dry_run,
      errors,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})
