// supabase/functions/dispatch-touch-email/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-email-v4_2025-12-08"

//────────────────────────────────────────
// ELASTIC EMAIL (driver real)
//────────────────────────────────────────
async function sendElasticEmail({
  apiKey,
  from,
  fromName,
  to,
  subject,
  bodyHtml,
  bodyText,
  replyTo,
}: any) {

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
      isTransactional: "false"
    }),
  })

  const json = await res.json()
  if (!res.ok || json?.success === false) {
    throw new Error(JSON.stringify(json))
  }

  return json
}

//────────────────────────────────────────
// HANDLER PRINCIPAL
//────────────────────────────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const ELASTIC_KEY = Deno.env.get("ELASTICEMAIL_API_KEY") || ""

  // QA OVERRIDES
  const QA_TO = Deno.env.get("QA_EMAIL_SINK") || ""   // enviar SIEMPRE acá en free tier
  const QA_FROM = Deno.env.get("QA_EMAIL_FROM") || "" // sender fake QA

  if (!SB_URL || !SB_KEY) {
    return new Response(JSON.stringify({
      ok: false,
      stage: "env",
      error: "Missing Supabase env vars",
      version: VERSION
    }), { status: 500, headers: corsHeaders })
  }

  const supabase = createClient(SB_URL, SB_KEY)

  try {
    //────────────────────────────────────────
    // 1) TRAER RUNS
    //────────────────────────────────────────
    const { data: runs, error: runsErr } = await supabase
      .from("touch_runs")
      .select("id, lead_id, payload")
      .eq("channel", "email")
      .eq("status", "scheduled")
      .order("scheduled_at", { ascending: true })
      .limit(50)

    if (runsErr) throw runsErr

    if (!runs?.length) {
      // Log vacío (no requiere lead_id porque no hay ninguno)
      await logEvaluation(supabase, {
        event_source: "dispatcher",
        label: "dispatch_touch_email_empty",
        kpis: { processed: 0, failed: 0 }
      })

      return new Response(JSON.stringify({
        ok: true,
        version: VERSION,
        processed: 0,
        failed: 0
      }), { headers: corsHeaders })
    }

    let processed = 0
    const errors: any[] = []

    //────────────────────────────────────────
    // 2) LOOP POR RUN
    //────────────────────────────────────────
    for (const run of runs) {
      try {
        // Preferimos lead_enriched
        const { data: leadE } = await supabase
          .from("lead_enriched")
          .select("email, name")
          .eq("id", run.lead_id)
          .maybeSingle()

        const { data: lead } = await supabase
          .from("leads")
          .select("email, contact_name")
          .eq("id", run.lead_id)
          .maybeSingle()

        const email = (leadE?.email || lead?.email || "").trim()
        if (!email) throw new Error("Lead has no email")

        // Sender activo (o QA sender)
        const { data: senderAcc } = await supabase
          .from("domain_accounts")
          .select("email")
          .eq("status", "active")
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle()

        const fromEmail = QA_FROM || senderAcc?.email || "no-reply@test.com"
        const toEmail = QA_TO || email

        const subject = run.payload?.subject || "Hello"
        const body = run.payload?.body || "Hi there"
        const bodyHtml = `<p>${body}</p>`

        //────────────────────────────────────────
        // SEND (real)
        //────────────────────────────────────────
        await sendElasticEmail({
          apiKey: ELASTIC_KEY,
          from: fromEmail,
          to: toEmail,
          subject,
          bodyHtml,
          bodyText: body,
        })

        // UPDATE STATUS
        await supabase
          .from("touch_runs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", run.id)

        processed++

        // LOG EVENTO
        await logEvaluation(supabase, {
          lead_id: run.lead_id,
          event_source: "dispatcher",
          label: "dispatch_touch_email_sent",
          kpis: { processed, failed: errors.length },
        })

      } catch (e: any) {
        const msg = e?.message ?? String(e)

        errors.push({ run_id: run.id, lead_id: run.lead_id, error: msg })

        await supabase
          .from("touch_runs")
          .update({ status: "failed", error: msg })
          .eq("id", run.id)

        // log error individual
        await logEvaluation(supabase, {
          lead_id: run.lead_id,
          event_source: "dispatcher",
          label: "dispatch_touch_email_error",
          kpis: { processed, failed: errors.length },
          notes: msg
        })
      }
    }

    //────────────────────────────────────────
    // 3) Log resumen final
    //────────────────────────────────────────
    await logEvaluation(supabase, {
      event_source: "dispatcher",
      label: "dispatch_touch_email_summary",
      kpis: { processed, failed: errors.length },
      notes: errors.length
        ? `${errors.length} failed`
        : "All email messages delivered"
    })

    return new Response(JSON.stringify({
      ok: true,
      version: VERSION,
      processed,
      failed: errors.length,
      errors
    }), { headers: corsHeaders })

  } catch (e: any) {
    return new Response(JSON.stringify({
      ok: false,
      stage: "fatal",
      error: e?.message ?? String(e),
      version: VERSION
    }), { status: 500, headers: corsHeaders })
  }
})
