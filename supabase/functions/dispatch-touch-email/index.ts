// supabase/functions/dispatch-touch-email/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-email-v3_2025-11-24_fix_errors_qa"

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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const ELASTIC_KEY = Deno.env.get("ELASTICEMAIL_API_KEY") || ""

  // QA overrides (para free tier)
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
    // 1) trae touch_runs email scheduled
    const { data: runs, error: rErr } = await supabase
      .from("touch_runs")
      .select("id, lead_id, payload")
      .eq("channel", "email")
      .eq("status", "scheduled")
      .limit(50)

    if (rErr) throw rErr

    let processed = 0
    const errors: any[] = []

    for (const run of runs ?? []) {
      try {
        // 2) trae lead email (prioriza lead_enriched)
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

        // 3) elige sender activo (primero gmail QA si existe)
        const { data: senderAcc, error: sErr } = await supabase
          .from("domain_accounts")
          .select("email, status")
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()
        if (sErr || !senderAcc?.email) {
          throw new Error("No active sender account")
        }

        const subject = run.payload?.subject || "Hello"
        const body = run.payload?.body || "Hi there"
        const bodyHtml = `<p>${body}</p>`

        // 4) QA overrides para elastic free tier
        const finalFrom = QA_FROM || senderAcc.email
        const finalTo = QA_TO || toEmail

        // 5) send
        await sendElasticEmail({
          apiKey: ELASTIC_KEY,
          from: finalFrom,
          to: finalTo,
          subject,
          bodyHtml,
          bodyText: body,
        })

        // 6) mark sent
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

    // 7) Log en core_memory_events (best-effort)
    try {
      await logEvaluation({
        supabase,
        event_type: "evaluation",
        actor: "dispatcher",
        label: "dispatch_touch_email_v3",
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
