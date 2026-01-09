// supabase/functions/dispatch-touch-email/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-email-v2_2025-12-10_multitenant"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function cleanEmail(e: string | null) {
  if (!e) return null
  return e.trim().toLowerCase()
}

function isValidEmail(e: string | null) {
  if (!e) return false
  // simple pero suficiente
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)
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

  // ENV para Elastic Email (ajusta nombres si ya usas otros)
  const ELASTIC_API_KEY =
    (Deno.env.get("ELASTIC_EMAIL_API_KEY") ?? "").trim() ||
    (Deno.env.get("ELASTICEMAIL_API_KEY") ?? "").trim()
  const ELASTIC_FROM = (Deno.env.get("ELASTIC_EMAIL_FROM") ?? "").trim()
  const ELASTIC_FROM_NAME = (Deno.env.get("ELASTIC_EMAIL_FROM_NAME") ?? "Revenue ASI").trim()

  const DRY_DEFAULT = Deno.env.get("DRY_RUN_EMAIL") === "true"

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

  // URL del smart-router
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
  // 1) TRAER TOUCH RUNS EMAIL
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
        JSON.stringify({ ok: false, stage: "select_runs_by_ids", error: error.message, version: VERSION }),
        { status: 500, headers: corsHeaders },
      )
    }
    runs = (data ?? []).filter((r: any) => String(r.channel || "").toLowerCase() === "email")
  } else {
    const { data, error } = await supabase
      .from("touch_runs")
      .select("id, lead_id, account_id, payload, scheduled_at, step, status, channel")
      .eq("channel", "email")
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
      event_source: "dispatcher",
      label: "email_empty",
      kpis: { processed: 0, failed: 0 },
      notes: "No email runs to dispatch",
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
    try {
      if (!run.account_id) {
        throw new Error("missing_account_id_on_run")
      }

      // 2.1 Resolver proveedor para esta cuenta/canal
      const { data: providerRow, error: provErr } = await supabase
        .from("account_provider_settings")
        .select("provider, config")
        .eq("account_id", run.account_id)
        .eq("channel", "email")
        .eq("is_default", true)
        .maybeSingle()

      if (provErr) {
        throw new Error(`provider_lookup_failed:${provErr.message}`)
      }
      if (!providerRow?.provider) {
        throw new Error("no_default_provider_for_account_email")
      }

      const provider = providerRow.provider
      const config = (providerRow.config ?? {}) as Record<string, unknown>

      if (provider !== "elastic_email") {
        throw new Error(`unsupported_provider:${provider}`)
      }

      if (!ELASTIC_API_KEY || !ELASTIC_FROM) {
        throw new Error("missing_elastic_env: set ELASTIC_EMAIL_API_KEY (or ELASTICEMAIL_API_KEY) + ELASTIC_EMAIL_FROM")
      }

      // 2.2 Resolver email del lead (lead_enriched primero)
      const { data: leadE, error: leErr } = await supabase
        .from("lead_enriched")
        .select("email")
        .eq("id", run.lead_id)
        .maybeSingle()

      if (leErr) {
        throw new Error("lead_enriched_lookup_failed")
      }

      const emailRaw = cleanEmail(leadE?.email ?? null)

      if (!isValidEmail(emailRaw)) {
        throw new Error(`invalid_email:${emailRaw}`)
      }

      const to = emailRaw!

      const payload = (run.payload ?? {}) as any
      const subject: string =
        payload.subject ||
        payload.title ||
        "Actualiza tu sistema de generación de clientes"

      const bodyHtml: string =
        payload.body_html ||
        payload.html ||
        `<p>${payload.body ?? "Hola, esto es un correo de prueba de Revenue ASI."}</p>`

      const bodyText: string =
        payload.body_text ||
        payload.body ||
        "Hola, esto es un correo de prueba de Revenue ASI."

      // 2.3 (opcional) marcar como executing (compatible con CHECK constraint)
      await supabase
        .from("touch_runs")
        .update({
          status: "executing",
          executed_at: new Date().toISOString(),
          error: null,
        })
        .eq("id", run.id)

      // 2.4 Enviar por Elastic Email (si no dryRun)
      if (!dryRun) {
        const resp = await fetch(
          "https://api.elasticemail.com/v4/emails/transactional",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-ElasticEmail-ApiKey": ELASTIC_API_KEY,
            },
            body: JSON.stringify({
              Recipients: [
                {
                  Email: to,
                },
              ],
              Content: {
                From: ELASTIC_FROM,
                FromName: ELASTIC_FROM_NAME,
                Subject: subject,
                Body: [
                  {
                    ContentType: "HTML",
                    Charset: "utf-8",
                    Content: bodyHtml,
                  },
                  {
                    ContentType: "PlainText",
                    Charset: "utf-8",
                    Content: bodyText,
                  },
                ],
              },
            }),
          },
        )

        if (!resp.ok) {
          const txt = await resp.text()
          throw new Error(`ElasticEmail error: ${txt}`)
        }
      }

      // 2.5 Marcar como enviado
      const sentAtIso = new Date().toISOString()

      await supabase
        .from("touch_runs")
        .update({
          // In dry_run, avoid polluting "success" metrics.
          status: dryRun ? "canceled" : "sent",
          sent_at: dryRun ? null : sentAtIso,
          payload: {
            ...(payload ?? {}),
            to,
            to_normalized: to,
            dryRun,
            provider,
            provider_config: config,
          },
          error: null,
        })
        .eq("id", run.id)

      processed++
      processed_ids.push(run.id)

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "email_sent",
        kpis: { processed, failed: errors.length },
        notes: `provider=${provider}, dryRun=${dryRun}`,
      })

      // 2.6 🔗 SMART ROUTER (solo si no es dryRun)
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
              source: "email_dispatcher",
            }),
          })
        } catch (routerErr) {
          console.error("Smart router call failed (email):", routerErr)
          // no rompemos el envío por culpa del router
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
        })
        .eq("id", run.id)

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "email_failed",
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
    label: "email_summary",
    kpis: { processed, failed: errors.length },
    notes: errors.length
      ? `${errors.length} errors`
      : "All email messages delivered",
  })

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
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  )
})
