// supabase/functions/dispatch-touch-sms/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-sms-v7_2025-12-28_schema_safe_no_executed_at"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-revenue-secret",
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

function safeObj(x: any) {
  return x && typeof x === "object" ? x : {}
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

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

  // Twilio ENV (opcional si dry_run)
  const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")
  const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")
  const SMS_FROM = Deno.env.get("TWILIO_SMS_FROM") // "+14155551234"
  const QA_SMS_SINK = Deno.env.get("QA_SMS_SINK") ?? null
  const DRY_DEFAULT = Deno.env.get("DRY_RUN_SMS") === "true"

  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const limit = Number(body.limit ?? 50)
  const dryRun = Boolean(body.dry_run ?? DRY_DEFAULT)
  const touchRunId = (body.touch_run_id ?? null) as string | null
  const touchRunIds = Array.isArray(body.touch_run_ids)
    ? body.touch_run_ids.filter((x: any) => typeof x === "string")
    : null

  // smart-router URL (solo si estás en hosted; en local puede quedar null)
  const projectRef = (() => {
    try {
      const url = new URL(SB_URL)
      const host = url.hostname
      // hosted: <ref>.supabase.co
      return host.includes(".") ? host.split(".")[0] : null
    } catch {
      return null
    }
  })()

  const smartRouterUrl = projectRef
    ? `https://${projectRef}.functions.supabase.co/dispatch-touch-smart-router`
    : null

  //────────────────────────────────────────
  // 1) TRAER TOUCH RUNS SMS (1 o lote)
  //────────────────────────────────────────
  let runs: any[] = []

  if (touchRunIds && touchRunIds.length) {
    const { data, error } = await supabase
      .from("touch_runs")
      .select("id, lead_id, account_id, payload, meta, scheduled_at, step, status, channel")
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
    runs = (data ?? []).filter((r: any) => String(r.channel || "").toLowerCase() === "sms")
  } else if (touchRunId) {
    const { data, error } = await supabase
      .from("touch_runs")
      .select("id, lead_id, account_id, payload, meta, scheduled_at, step, status")
      .eq("id", touchRunId)
      .maybeSingle()

    if (error) {
      return new Response(
        JSON.stringify({
          ok: false,
          stage: "select_run_by_id",
          error: error.message,
          version: VERSION,
        }),
        { status: 500, headers: corsHeaders },
      )
    }

    if (data) runs = [data]
  } else {
    const { data, error } = await supabase
      .from("touch_runs")
      .select("id, lead_id, account_id, payload, meta, scheduled_at, step, status")
      .eq("channel", "sms")
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

  if (!runs.length) {
    await logEvaluation(supabase, {
      event_source: "dispatcher",
      label: "sms_empty",
      kpis: { processed: 0, failed: 0 },
      notes: touchRunId ? "No run found by id" : "No SMS runs to dispatch",
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

  for (const run of runs) {
    const runId = run.id as string
    const leadId = run.lead_id as string
    const accountId = run.account_id as string | null

    // helper: marcar failed sin tocar columnas fantasma
    const markFailed = async (msg: string) => {
      const meta = safeObj(run.meta)
      await supabase
        .from("touch_runs")
        .update({
          status: "failed",
          error: msg,
          meta: { ...meta, dispatcher_version: VERSION },
        })
        .eq("id", runId)
    }

    try {
      if (!accountId) throw new Error("missing_account_id_on_run")
      if (!leadId) throw new Error("missing_lead_id_on_run")

      // 2.1 Resolver proveedor para esta cuenta/canal (schema real)
      const { data: providerRow, error: provErr } = await supabase
        .from("account_provider_settings")
        .select("provider, settings, is_active")
        .eq("account_id", accountId)
        .eq("channel", "sms")
        .maybeSingle()

      if (provErr) throw new Error(`provider_lookup_failed:${provErr.message}`)
      if (!providerRow?.provider) throw new Error("no_provider_settings_for_account_sms")
      if (providerRow.is_active === false) throw new Error("provider_inactive_for_account_sms")

      const provider = String(providerRow.provider)
      const providerSettings = safeObj(providerRow.settings)

      // 2.2 Resolver "to" desde inbox_identities (fuente canon en multi-tenant)
      // Si existe QA_SMS_SINK, lo usamos como destino QA (pero guardamos to_normalized = real si aplica)
      let toReal: string | null = null

      const { data: ident, error: identErr } = await supabase
        .from("inbox_identities")
        .select("identity, identity_norm")
        .eq("account_id", accountId)
        .eq("lead_id", leadId)
        .eq("channel", "sms")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (identErr) throw new Error(`inbox_identity_lookup_failed:${identErr.message}`)

      const raw = cleanPhone((ident?.identity_norm ?? ident?.identity ?? null) as string | null)
      if (raw && isValidE164(raw)) toReal = raw

      const to = QA_SMS_SINK ?? toReal
      if (!to) throw new Error("invalid_or_missing_phone:null")

      // 2.3 Construir mensaje
      const payload = safeObj(run.payload)
      const template =
        (payload.template as string | undefined) ??
        (payload.message as string | undefined) ??
        (payload.body as string | undefined) ??
        "Hola, este es un SMS de prueba de Revenue ASI."

      // 2.4 Marcar como processing (NO executed_at)
      {
        const meta = safeObj(run.meta)
        await supabase
          .from("touch_runs")
          .update({
            status: "processing",
            error: null,
            meta: { ...meta, dispatcher_version: VERSION, provider },
            payload: {
              ...payload,
              template,
              to,
              to_normalized: toReal ?? null,
              dryRun,
              provider,
              provider_settings: providerSettings,
            },
          })
          .eq("id", runId)
      }

      // 2.5 Enviar (o simular)
      let providerMessageId: string | null = null

      if (dryRun) {
        providerMessageId = "dry_run"
      } else {
        if (provider !== "twilio") throw new Error(`unsupported_provider:${provider}`)
        if (!TWILIO_SID || !TWILIO_TOKEN || !SMS_FROM) throw new Error("missing_twilio_sms_env")

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
              From: SMS_FROM,
              Body: template,
            }),
          },
        )

        const txt = await twilioResp.text()
        if (!twilioResp.ok) throw new Error(`twilio_error:${txt}`)

        try {
          const j = JSON.parse(txt)
          providerMessageId = j?.sid ?? null
        } catch {
          providerMessageId = null
        }
      }

      // 2.6 Marcar como sent (NO sent_at)
      {
        const meta = safeObj(run.meta)
        await supabase
          .from("touch_runs")
          .update({
            status: "sent",
            error: null,
            meta: {
              ...meta,
              dispatcher_version: VERSION,
              provider,
              provider_message_id: providerMessageId,
            },
            payload: {
              ...payload,
              template,
              to,
              to_normalized: toReal ?? null,
              dryRun,
              provider,
              provider_settings: providerSettings,
            },
          })
          .eq("id", runId)
      }

      processed++
      processed_ids.push(runId)

      await logEvaluation(supabase, {
        lead_id: leadId,
        event_source: "dispatcher",
        label: dryRun ? "sms_dryrun_sent" : "sms_sent",
        kpis: { processed, failed: errors.length },
        notes: `provider=${provider}, dryRun=${dryRun}`,
      })

      // 2.7 Llamar smart-router si no dryRun (opcional)
      if (!dryRun && smartRouterUrl) {
        try {
          await fetch(smartRouterUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SB_KEY,
              Authorization: `Bearer ${SB_KEY}`,
            },
            body: JSON.stringify({ lead_id: leadId, step: run.step ?? 1, dry_run: false }),
          })
        } catch {
          // No rompe dispatch. Router es best-effort.
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push({ id: run.id, lead_id: run.lead_id, error: msg })
      failed_ids.push(runId)
      await markFailed(msg)
    }
  }

  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      version: VERSION,
      processed,
      failed: errors.length,
      processed_ids,
      failed_ids,
      errors,
      dryRun,
    }),
    { headers: corsHeaders },
  )
})
