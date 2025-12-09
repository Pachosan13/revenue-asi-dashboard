// supabase/functions/dispatch-touch-email/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { logEvaluation } from "../_shared/eval.ts"
import { getChannelProvider } from "../_shared/providers.ts"

const VERSION = "dispatch-touch-email-v4_2025-12-09_multitenant"

// --- Elastic Email helper ----------------------------------------------------

async function sendElasticEmail({
  apiKey,
  from,
  fromName,
  to,
  subject,
  bodyHtml,
  bodyText,
  replyTo,
}: {
  apiKey: string
  from: string
  fromName?: string
  to: string
  subject: string
  bodyHtml: string
  bodyText?: string
  replyTo?: string
}) {
  const res = await fetch("https://api.elasticemail.com/v2/email/send", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      apikey: apiKey,
      from,
      fromName: fromName || from,
      to,
      subject,
      bodyHtml,
      bodyText: bodyText || "",
      replyTo: replyTo || from,
      isTransactional: "false",
    }),
  })

  const json = await res.json()
  if (!res.ok || json?.success === false) {
    throw new Error(JSON.stringify(json))
  }
  return json
}

// --- Handler -----------------------------------------------------------------

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const ELASTIC_KEY = Deno.env.get("ELASTICEMAIL_API_KEY") || ""

  // QA overrides (para free tier / sandbox)
  const QA_TO = Deno.env.get("QA_EMAIL_SINK") || ""
  const QA_FROM = Deno.env.get("QA_EMAIL_FROM") || ""

  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "env",
        error: "Missing supabase env",
        version: VERSION,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  try {
    // 1) Trae touch_runs de canal email pendientes
    const { data: runs, error: rErr } = await supabase
      .from("touch_runs")
      .select("id, lead_id, account_id, payload")
      .eq("channel", "email")
      .eq("status", "scheduled")
      .limit(50)

    if (rErr) throw rErr

    let processed = 0
    const errors: any[] = []

    for (const run of runs ?? []) {
      try {
        const accountId: string =
          (run as any).account_id ||
          Deno.env.get("DEFAULT_ACCOUNT_ID") ||
          "a0e3fc34-0bc4-410f-b363-a25b00fa16b8"

        // 2) Resolver provider multitenant para email
        const providerCfg = await getChannelProvider(supabase, accountId, "email")

        if (!providerCfg) {
          throw new Error(
            `No provider configured for account_id=${accountId} channel=email`,
          )
        }

        if (providerCfg.provider !== "elastic_email") {
          throw new Error(
            `Unsupported email provider: ${providerCfg.provider}. Only elastic_email is implemented.`,
          )
        }

        if (!ELASTIC_KEY) {
          throw new Error("Missing ELASTICEMAIL_API_KEY env var")
        }

        const cfg = (providerCfg.config || {}) as Record<string, unknown>
        const cfgFrom = (cfg.from as string) || ""
        const cfgFromName = (cfg.from_name as string) || ""

        // 3) Trae lead email (prioriza lead_enriched si existe)
        const { data: leadE } = await supabase
          .from("lead_enriched")
          .select("email, name")
          .eq("id", run.lead_id)
          .maybeSingle()

        const { data: lead } = await supabase
          .from("leads")
          .select("email, contact_name, company_name")
          .eq("id", run.lead_id)
          .maybeSingle()

        const toEmail = (leadE?.email || lead?.email || "").trim()
        if (!toEmail) throw new Error("Lead has no email")

        // 4) Elige sender activo por cuenta (domain_accounts)
        const { data: senderAcc, error: sErr } = await supabase
          .from("domain_accounts")
          .select("email, status")
          .eq("status", "active")
          .eq("account_id", accountId)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()

        if (sErr || !senderAcc?.email) {
          throw new Error("No active sender account for this account_id")
        }

        const subject = (run as any).payload?.subject || "Hello"
        const body = (run as any).payload?.body || "Hi there"
        const bodyHtml = `<p>${body}</p>`

        // 5) QA overrides para elastic free tier
        const providerFrom = cfgFrom || senderAcc.email
        const providerFromName = cfgFromName || senderAcc.email

        const finalFrom = QA_FROM || providerFrom
        const finalTo = QA_TO || toEmail

        // 6) Enviar usando Elastic Email
        await sendElasticEmail({
          apiKey: ELASTIC_KEY,
          from: finalFrom,
          fromName: providerFromName,
          to: finalTo,
          subject,
          bodyHtml,
          bodyText: body,
        })

        // 7) Marcar como enviado
        await supabase
          .from("touch_runs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", run.id)

        processed++
      } catch (e: any) {
        const msg = e?.message ?? String(e)
        errors.push({ run_id: run.id, lead_id: run.lead_id, error: msg })

        await supabase
          .from("touch_runs")
          .update({ status: "failed", error: msg })
          .eq("id", run.id)
      }
    }

    // 8) Log en core_memory_events (best-effort)
    try {
      await logEvaluation({
        supabase,
        event_type: "evaluation",
        actor: "dispatcher",
        label: "dispatch_touch_email_v4",
        kpis: {
          channel: "email",
          processed,
          failed: errors.length,
        },
        notes:
          errors.length === 0
            ? "All email touches processed successfully"
            : `Email dispatch completed with ${errors.length} errors`,
      })
    } catch (e) {
      console.error("logEvaluation failed in dispatch-touch-email", e)
    }

    return new Response(
      JSON.stringify({ ok: true, version: VERSION, processed, errors }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  } catch (e: any) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "fatal",
        error: e?.message ?? String(e),
        version: VERSION,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }
})
