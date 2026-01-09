// supabase/functions/warmup-engine/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { corsHeaders } from "../_shared/cors.ts"

const VERSION = "warmup-engine-v1_2025-11-24"

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
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const ELASTIC_KEY =
    (Deno.env.get("ELASTIC_EMAIL_API_KEY") ?? "").trim() ||
    (Deno.env.get("ELASTICEMAIL_API_KEY") ?? "").trim()
  if (!SB_URL || !SB_KEY) {
    return new Response(JSON.stringify({ ok:false, stage:"env", error:"Missing supabase env" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type":"application/json" },
    })
  }
  const supabase = createClient(SB_URL, SB_KEY)

  try {
    // 1) busca warmups scheduled
    const { data: jobs, error: jErr } = await supabase
      .from("emails_warmup_queue")
      .select("id, from_account_id, to_account_id, subject, body_html, body_text")
      .eq("status", "scheduled")
      .limit(50)

    if (jErr) throw jErr

    let processed = 0
    const errors:any[] = []

    for (const job of jobs ?? []) {
      try {
        // 2) trae cuentas
        const { data: fromAcc } = await supabase
          .from("email_accounts")
          .select("email, display_name")
          .eq("id", job.from_account_id)
          .single()

        const { data: toAcc } = await supabase
          .from("email_accounts")
          .select("email")
          .eq("id", job.to_account_id)
          .single()

        if (!fromAcc?.email || !toAcc?.email) throw new Error("Missing accounts")

        // 3) send
        await sendElasticEmail({
          apiKey: ELASTIC_KEY,
          from: fromAcc.email,
          fromName: fromAcc.display_name || fromAcc.email,
          to: toAcc.email,
          subject: job.subject,
          bodyHtml: job.body_html,
          bodyText: job.body_text || "",
        })

        // 4) mark sent
        await supabase.from("emails_warmup_queue")
          .update({ status:"sent", sent_at: new Date().toISOString() })
          .eq("id", job.id)

        processed++
      } catch (e) {
        errors.push({ job_id: job.id, error: String(e) })
        await supabase.from("emails_warmup_queue")
          .update({ status:"failed", error: String(e) })
          .eq("id", job.id)
      }
    }

    return new Response(JSON.stringify({ ok:true, version:VERSION, processed, errors }), {
      headers: { ...corsHeaders, "Content-Type":"application/json" },
    })
  } catch (e:any) {
    return new Response(JSON.stringify({ ok:false, stage:"fatal", error: e?.message ?? String(e), version:VERSION }), {
      status:500, headers:{ ...corsHeaders, "Content-Type":"application/json" },
    })
  }
})
