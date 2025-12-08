// supabase/functions/dispatch-touch/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1"
import { logEvaluation } from "../_shared/eval.ts"

type TouchRunRow = {
  id: string
  lead_id: string
  channel: string
  payload: any
  status: string
}

type LeadRow = {
  id: string
  phone: string | null
}

const VERSION = "dispatch-touch-v2_fixed_2025-12-08"

const SB_URL = Deno.env.get("SUPABASE_URL")!
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
const TWILIO_WHATSAPP_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || ""

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

//────────────────── Helpers ──────────────────

function cleanPhone(p?: string | null) {
  return p ? p.replace(/\s+/g, "").trim() : null
}

function isValidE164(p?: string | null) {
  return !!p && /^\+\d{8,15}$/.test(p)
}

// WhatsApp mock sender
async function sendWhatsAppMock(from: string, to: string, body: string) {
  console.log("[MOCK SEND WA]", { from, to, body })
  return { status: "sent" as const }
}

//────────────────── Handler ──────────────────

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })

  const body = await req.json().catch(() => ({}))
  const limit = Number(body.limit ?? 50)
  const dry_run = Boolean(body.dry_run ?? false)

  const supabase = createClient(SB_URL, SB_KEY, {
    auth: { persistSession: false },
  })

  // 1) Traer touch_runs queued solo WhatsApp
  const { data: runs, error: runsErr } = await supabase
    .from("touch_runs")
    .select("id, lead_id, channel, payload")
    .eq("status", "queued")
    .eq("channel", "whatsapp")
    .order("scheduled_at", { ascending: true })
    .limit(limit)

  if (runsErr) {
    return new Response(JSON.stringify({
      ok: false,
      stage: "select_touch_runs",
      error: runsErr.message,
      version: VERSION,
    }), { status: 500, headers: corsHeaders })
  }

  if (!runs?.length) {
    await logEvaluation(supabase, {
      event_source: "dispatcher",
      label: "dispatch_touch_run_empty",
      kpis: { processed: 0, sent: 0, failed: 0 },
      notes: "No queued whatsapp touch_runs"
    })

    return new Response(JSON.stringify({
      ok: true,
      version: VERSION,
      processed: 0,
      sent: 0,
      failed: 0,
      dry_run,
      errors: []
    }), { headers: corsHeaders })
  }

  // 2) Leads
  const leadIds = [...new Set(runs.map(r => r.lead_id))]
  const { data: leads } = await supabase
    .from("leads")
    .select("id, phone")
    .in("id", leadIds)

  const leadMap = new Map(leads?.map((l: any) => [l.id, l]))

  let processed = 0
  let sent = 0
  let failed = 0
  const errors: any[] = []

  for (const run of runs) {
    processed++

    const lead = leadMap.get(run.lead_id)
    const phone = cleanPhone(lead?.phone)

    if (!isValidE164(phone)) {
      failed++

      if (!dry_run) {
        await supabase.from("touch_runs")
          .update({ status: "failed", error: "invalid_phone" })
          .eq("id", run.id)
      }

      errors.push({ id: run.id, error: "invalid_phone" })

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "dispatch_touch_invalid_phone",
        kpis: { processed, sent, failed },
        notes: "Invalid phone"
      })

      continue
    }

    try {
      if (!dry_run) {
        const from = TWILIO_WHATSAPP_FROM || "whatsapp:+000000000"
        const to = `whatsapp:${phone}`
        const body = run.payload?.body ?? run.payload?.message ?? ""

        await sendWhatsAppMock(from, to, body)

        await supabase.from("touch_runs")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            error: null,
          })
          .eq("id", run.id)
      }

      sent++

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "dispatch_touch_sent",
        kpis: { processed, sent, failed }
      })

    } catch (e) {
      failed++

      const msg = e instanceof Error ? e.message : String(e)

      if (!dry_run) {
        await supabase.from("touch_runs")
          .update({ status: "failed", error: msg })
          .eq("id", run.id)
      }

      errors.push({ id: run.id, error: msg })

      await logEvaluation(supabase, {
        lead_id: run.lead_id,
        event_source: "dispatcher",
        label: "dispatch_touch_error",
        kpis: { processed, sent, failed },
        notes: msg
      })
    }
  }

  // Respuesta final
  await logEvaluation(supabase, {
    event_source: "dispatcher",
    label: "dispatch_touch_summary",
    kpis: { processed, sent, failed },
  })

  return new Response(JSON.stringify({
    ok: true,
    version: VERSION,
    processed,
    sent,
    failed,
    dry_run,
    errors
  }), { headers: corsHeaders })
})
