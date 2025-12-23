// supabase/functions/dispatch-touch-whatsapp-v2/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-whatsapp-v2_2025-12-10_multitenant"

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
        error: "Missing Supabase env vars",
        version: VERSION,
      }),
      { status: 500, headers: corsHeaders },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  // ENV globales Twilio WhatsApp
  const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")
  const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")
  const WA_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") // ej: "whatsapp:+14155238886"

  const QA_SINK = Deno.env.get("QA_WHATSAPP_SINK") ?? null
  const DRY_DEFAULT = Deno.env.get("DRY_RUN_WHATSAPP") === "true"

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const limit = Number(body.limit ?? 50)
  const dryRun = Boolean(body.dry_run ?? DRY_DEFAULT)

  // URL del smart-router (misma instancia)
  const projectRef = (() => {
    try {
      const url = new URL(SB_URL)
      const host = url.hostname
      return host.split(".")[0]
    } catch {
      return null
    }
  })()

  const smartRouterUrl = projectRef
    ? `https://${projectRef}.functions.supabase.co/dispatch-touch-smart-router`
    : null

  //────────────────────────────────────────
  // 1) TRAER TOUCH RUNS WHATSAPP
  //────────────────────────────────────────
  const { data: runs, error: rErr } = await supabase
    .from("touch_runs")
    .select("id, lead_id, account_id, payload, scheduled_at, step, status")
    .eq("channel", "whatsapp")
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
      label: "whatsapp_empty",
      kpis: { processed: 0, failed: 0 },
      notes: "No WhatsApp runs to dispatch",
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

  for (const run of runs) {
    try {
      // 2.1 Resolver proveedor para esta cuenta/canal
      if (!run.account_id) {
        throw new Error("missing_account_id_on_run")
      }

      const { data: providerRow, error: provErr } = await supabase
        .from("account_provider_settings")
        .select("provider, config")
        .eq("account_id", run.account_id)
        .eq("channel", "whatsapp")
        .eq("is_default", true)
        .maybeSingle()

      if (provErr) {
        throw new Error(`provider_lookup_failed:${provErr.message}`)
      }
      if (!providerRow?.provider) {
        throw new Error("no_default_provider_for_account_whatsapp")
      }

      const provider = providerRow.provider
      const config = (providerRow.config ?? {}) as Record<string, unknown>

      if (provider !== "twilio") {
        throw new Error(`unsupported_provider:${provider}`)
      }

      if (!TWILIO_SID || !TWILIO_TOKEN || !WA_FROM) {
        throw new Error("missing_twilio_env")
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

      const toReal = `whatsapp:${phoneRaw}`
      const to = QA_SINK ?? toReal

      const payload = (run.payload ?? {}) as any
      const message: string =
        payload.message ||
        payload.body ||
        "Hola!"

      // 2.3 (opcional) marcar como processing
      await supabase
        .from("touch_runs")
        .update({
          status: "processing",
          executed_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", run.id)

      // 2.4 Enviar por Twilio (a menos que dryRun)
      if (!dryRun) {
        const twilioResp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
          {
            method: "POST",
            headers: {
              Authorization: "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`),
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              To: to,
              From: WA_FROM!,
              Body: message,
            }),
          },
        )

        if (!twilioResp.ok) {
          const txt = await twilioResp.text()
          throw new Error(`Twilio error: ${txt}`)
        }
      }

      // 2.5 Marcar como enviado
      const sentAtIso = new Date().toISOString()

      await supabase
        .from("touch_runs")
        .update({
          status: "sent",
          sent_at: sentAtIso,
          payload: {
            ...(payload ?? {}),
            to,
            to_normalized: phoneRaw,
            dryRun,
            provider,
            provider_config: config,
          },
          error: null,
        })
        .eq("id", run.id)

      processed++

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "whatsapp_sent",
        kpis: { processed, failed: errors.length },
        notes: `provider=${provider}, dryRun=${dryRun}`,
      })

      // 2.6 🔗 LLAMAR AL SMART ROUTER (solo si NO es dryRun)
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
              source: "whatsapp_dispatcher",
            }),
          })
        } catch (routerErr) {
          console.error("Smart router call failed (whatsapp):", routerErr)
          // No rompemos el envío por culpa del router
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
        label: "whatsapp_failed",
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
    label: "whatsapp_summary",
    kpis: { processed, failed: errors.length },
    notes: errors.length
      ? `${errors.length} errors`
      : "All WhatsApp messages delivered",
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
