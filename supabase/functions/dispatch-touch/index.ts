// supabase/functions/dispatch-touch/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1"

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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!

const TWILIO_WHATSAPP_FROM = Deno.env.get("TWILIO_WHATSAPP_FROM") || "" 
// ejemplo esperado: "whatsapp:+14155238886" (sandbox)
// IMPORTANT: si está vacío, no invento nada: marco failed.

function cleanPhone(p?: string | null) {
  if (!p) return null
  return p.replace(/\s+/g, "").trim()
}
function isValidE164(p?: string | null) {
  if (!p) return false
  return /^\+\d{8,15}$/.test(p)
}

// tu helper real de envío (ya lo tienes en v3)
// aquí dejo placeholder seguro:
async function sendWhatsApp(from: string, to: string, body: string) {
  // ... tu implementación Twilio ...
  // debe lanzar error si falla
  return true
}

serve(async (_req) => {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  })

  // 1) busca queued
  const { data: runs, error: runsErr } = await supabase
    .from("touch_runs")
    .select("id, lead_id, channel, payload, status")
    .eq("status", "queued")
    .limit(50)

  if (runsErr) {
    return Response.json({ ok: false, error: runsErr.message }, { status: 500 })
  }

  const touchRuns = (runs ?? []) as TouchRunRow[]
  if (!touchRuns.length) {
    return Response.json({ ok: true, processed: 0, version: "dispatch-touch-v4_2025-11-23" })
  }

  // 2) carga phones
  const leadIds = [...new Set(touchRuns.map((r) => r.lead_id))]
  const { data: leads, error: leadsErr } = await supabase
    .from("leads")
    .select("id, phone")
    .in("id", leadIds)

  if (leadsErr) {
    return Response.json({ ok: false, error: leadsErr.message }, { status: 500 })
  }

  const leadMap = new Map<string, LeadRow>()
  for (const l of (leads ?? []) as LeadRow[]) leadMap.set(l.id, l)

  let processed = 0
  const errors: any[] = []

  for (const run of touchRuns) {
    const lead = leadMap.get(run.lead_id)
    const rawPhone = cleanPhone(lead?.phone)

    // 3) validación dura, sin inventar
    if (!rawPhone || !isValidE164(rawPhone)) {
      await supabase
        .from("touch_runs")
        .update({
          status: "failed",
          error: `invalid_to_phone:${rawPhone ?? "null"}`,
          sent_at: null,
        })
        .eq("id", run.id)

      errors.push({ touch_run_id: run.id, lead_id: run.lead_id, error: "invalid_to_phone" })
      continue
    }

    try {
      if (run.channel === "whatsapp") {
        if (!TWILIO_WHATSAPP_FROM) {
          throw new Error("missing_TWILIO_WHATSAPP_FROM")
        }
        const from = TWILIO_WHATSAPP_FROM.startsWith("whatsapp:")
          ? TWILIO_WHATSAPP_FROM
          : `whatsapp:${TWILIO_WHATSAPP_FROM}`

        const to = `whatsapp:${rawPhone}`
        const body = run.payload?.body || run.payload?.message || ""

        await sendWhatsApp(from, to, body)
      } else {
        throw new Error(`unsupported_channel:${run.channel}`)
      }

      await supabase
        .from("touch_runs")
        .update({
          status: "sent",
          error: null,
          sent_at: new Date().toISOString(),
        })
        .eq("id", run.id)

      processed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)

      await supabase
        .from("touch_runs")
        .update({
          status: "failed",
          error: msg,
          sent_at: null,
        })
        .eq("id", run.id)

      errors.push({ touch_run_id: run.id, lead_id: run.lead_id, error: msg })
    }
  }

  return Response.json({
    ok: true,
    version: "dispatch-touch-v4_2025-11-23",
    processed,
    errors,
  })
})
