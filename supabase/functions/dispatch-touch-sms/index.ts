import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-sms-v1_2025-11-24"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

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

  const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")
  const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")
  const TWILIO_FROM = Deno.env.get("TWILIO_FROM_NUMBER") // e.g. +15055550123

  const QA_SINK = Deno.env.get("QA_SMS_SINK") ?? null // opcional
  const DRY_DEFAULT = Deno.env.get("DRY_RUN_SMS") === "true"

  let body: any = {}
  try {
    body = await req.json()
  } catch {}

  const limit = Number(body.limit ?? 50)
  const dry_run = Boolean(body.dry_run ?? DRY_DEFAULT)

  if (!TWILIO_SID || !TWILIO_TOKEN || !TWILIO_FROM) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "env",
        error:
          "Missing TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  // 1) traer touch_runs sms scheduled
  const { data: runs, error } = await supabase
    .from("touch_runs")
    .select("id, lead_id, payload, scheduled_at")
    .eq("channel", "sms")
    .eq("status", "scheduled")
    .order("scheduled_at", { ascending: true })
    .limit(limit)

  if (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "select_runs",
        error: error.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  let processed = 0
  const errors: any[] = []

  for (const run of runs ?? []) {
    try {
      // 2) buscar lead phone
      const { data: lead } = await supabase
        .from("lead_enriched")
        .select("phone")
        .eq("id", run.lead_id)
        .maybeSingle()

      const toReal = lead?.phone
      if (!toReal) throw new Error("Lead missing phone")

      const to = QA_SINK ?? toReal
      const message = run.payload?.message ?? "Hola!"

      if (!dry_run) {
        const twilioResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization:
                "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: to,
              From: TWILIO_FROM,
              Body: message,
            }),
          },
        )

        if (!twilioResp.ok) {
          const txt = await twilioResp.text()
          throw new Error(`Twilio error: ${txt}`)
        }
      }

      // 3) marcar sent
      await supabase
        .from("touch_runs")
        .update({
          status: "sent",
          sent_at: new Date().toISOString(),
          payload: { ...(run.payload ?? {}), to, dry_run },
        })
        .eq("id", run.id)

      processed++
    } catch (e: any) {
      const msg = e.message ?? String(e)
      errors.push({ id: run.id, error: msg })

      await supabase
        .from("touch_runs")
        .update({
          status: "error",
          error: msg,
        })
        .eq("id", run.id)
    }
  }

  // 4) Log en core_memory_events (best-effort)
  try {
    await logEvaluation({
      supabase,
      event_type: "evaluation",
      actor: "dispatcher",
      label: "dispatch_touch_sms_v1",
      kpis: {
        channel: "sms",
        processed,
        failed: errors.length,
        dry_run,
      },
      notes:
        errors.length === 0
          ? "All SMS touches processed successfully"
          : `SMS dispatch completed with ${errors.length} errors`,
    })
  } catch (e) {
    console.error("logEvaluation failed in dispatch-touch-sms", e)
  }

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      processed,
      dry_run,
      errors,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})
