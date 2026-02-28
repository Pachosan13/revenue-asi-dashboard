import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VERSION = "ghl-message-webhook-v1_2026-02-28"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-webhook-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function parseBodyAsObject(text: string): Record<string, unknown> {
  const params = new URLSearchParams(text)
  const out: Record<string, unknown> = {}
  for (const [k, v] of params.entries()) out[k] = v
  return out
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return null
}

function normalizePhone(v: string | null): string | null {
  if (!v) return null
  return v.replace(/[^\d+]/g, "")
}

function isInboundMessage(body: Record<string, unknown>) {
  const direction = String(
    pickString(
      body.direction,
      body.message_direction,
      (body as any)?.message?.direction,
      (body as any)?.data?.direction,
    ) ?? "",
  ).toLowerCase()
  const eventType = String(
    pickString(
      body.type,
      body.event,
      body.event_type,
      body.webhookType,
      (body as any)?.message?.type,
      (body as any)?.data?.type,
    ) ?? "",
  ).toLowerCase()

  if (direction === "inbound") return true
  if (eventType.includes("inbound") || eventType.includes("message_received")) return true
  return false
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") {
    return json({ ok: false, version: VERSION, error: "Only POST allowed" }, 405)
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const WEBHOOK_TOKEN = String(Deno.env.get("GHL_INBOUND_WEBHOOK_TOKEN") ?? "").trim()
  if (!SB_URL || !SB_KEY) {
    return json({ ok: false, version: VERSION, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }

  const url = new URL(req.url)
  const headerToken = (req.headers.get("x-webhook-token") ?? "").trim()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  const queryToken = (url.searchParams.get("token") ?? "").trim()
  const providedToken = headerToken || bearer || queryToken
  if (WEBHOOK_TOKEN && providedToken !== WEBHOOK_TOKEN) {
    console.log("GHL_MSG_WEBHOOK_AUTH_FAIL", {
      version: VERSION,
      has_env_token: true,
      has_provided_token: Boolean(providedToken),
    })
    return json({ ok: false, version: VERSION, error: "Unauthorized" }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    const textBody = await req.text()
    body = textBody ? parseBodyAsObject(textBody) : {}
  }

  const inbound = isInboundMessage(body)
  const messageBody = pickString(
    (body as any)?.message,
    (body as any)?.body,
    (body as any)?.text,
    (body as any)?.message?.body,
    (body as any)?.data?.message,
  )
  const accountId = pickString(
    url.searchParams.get("account_id"),
    body.account_id,
    (body as any)?.contact?.account_id,
    (body as any)?.data?.account_id,
  )
  const leadIdInput = pickString(
    body.lead_id,
    (body as any)?.contact?.lead_id,
    (body as any)?.data?.lead_id,
  )
  const email = pickString(
    body.email,
    (body as any)?.contact?.email,
    (body as any)?.data?.contact?.email,
  )
  const phone = normalizePhone(
    pickString(
      body.phone,
      body.from,
      (body as any)?.contact?.phone,
      (body as any)?.data?.contact?.phone,
      (body as any)?.message?.from,
    ),
  )

  console.log("GHL_MSG_WEBHOOK_IN", {
    version: VERSION,
    inbound,
    has_message: Boolean(messageBody),
    has_account_id: Boolean(accountId),
    has_phone: Boolean(phone),
    has_email: Boolean(email),
    has_lead_id: Boolean(leadIdInput),
  })

  if (!inbound) {
    return json({ ok: true, version: VERSION, ignored: true, reason: "not_inbound_message_event" })
  }
  if (!leadIdInput && !phone && !email) {
    return json({ ok: true, version: VERSION, ignored: true, reason: "missing_lead_identifiers" })
  }

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

  let leadId = leadIdInput
  let resolvedBy: string | null = null

  if (!leadId) {
    let query = supabase.from("leads").select("id, account_id").order("created_at", { ascending: false }).limit(1)
    if (accountId) query = query.eq("account_id", accountId)
    const orFilters: string[] = []
    if (email) orFilters.push(`email.eq.${email}`)
    if (phone) orFilters.push(`phone.eq.${phone}`)
    if (orFilters.length > 0) query = query.or(orFilters.join(","))
    const { data: leadRow, error: leadErr } = await query.maybeSingle()
    if (leadErr) {
      console.log("GHL_MSG_WEBHOOK_LEAD_LOOKUP_ERR", { version: VERSION, error: leadErr.message })
      return json({ ok: false, version: VERSION, error: "lead_lookup_failed", details: leadErr.message }, 500)
    }
    leadId = leadRow?.id ?? null
    resolvedBy = leadId ? "phone_or_email" : null
  } else {
    const { data: leadRow, error: leadErr } = await supabase
      .from("leads")
      .select("id")
      .eq("id", leadId)
      .maybeSingle()
    if (leadErr) {
      console.log("GHL_MSG_WEBHOOK_LEAD_CHECK_ERR", { version: VERSION, error: leadErr.message })
      return json({ ok: false, version: VERSION, error: "lead_lookup_failed", details: leadErr.message }, 500)
    }
    leadId = leadRow?.id ?? null
    resolvedBy = leadId ? "lead_id" : null
  }

  if (!leadId) {
    return json({ ok: true, version: VERSION, updated: false, reason: "lead_not_found" })
  }

  // Stop scheduling/execution by taking the lead out of run-cadence eligibility.
  const { error: leadUpdErr } = await supabase
    .from("leads")
    .update({
      lead_status: "REPLIED",
      status: "suppressed",
      lead_state: "engaged",
      updated_at: new Date().toISOString(),
    })
    .eq("id", leadId)
  if (leadUpdErr) {
    console.log("GHL_MSG_WEBHOOK_LEAD_UPDATE_ERR", { version: VERSION, lead_id: leadId, error: leadUpdErr.message })
    return json({ ok: false, version: VERSION, error: "lead_update_failed", details: leadUpdErr.message }, 500)
  }

  const { data: activeRuns, error: activeErr } = await supabase
    .from("touch_runs")
    .select("id")
    .eq("lead_id", leadId)
    .in("status", ["queued", "scheduled", "executing"])
  if (activeErr) {
    console.log("GHL_MSG_WEBHOOK_TOUCH_SELECT_ERR", { version: VERSION, lead_id: leadId, error: activeErr.message })
    return json({ ok: false, version: VERSION, error: "touch_runs_lookup_failed", details: activeErr.message }, 500)
  }

  const activeIds = (activeRuns ?? []).map((r: any) => r.id).filter(Boolean)
  let cancelledCount = 0
  if (activeIds.length > 0) {
    const { error: cancelErr } = await supabase
      .from("touch_runs")
      .update({
        status: "canceled",
        error: "stopped_due_to_inbound_reply",
        updated_at: new Date().toISOString(),
      })
      .in("id", activeIds)
    if (cancelErr) {
      console.log("GHL_MSG_WEBHOOK_TOUCH_CANCEL_ERR", {
        version: VERSION,
        lead_id: leadId,
        count: activeIds.length,
        error: cancelErr.message,
      })
      return json({ ok: false, version: VERSION, error: "touch_runs_cancel_failed", details: cancelErr.message }, 500)
    }
    cancelledCount = activeIds.length
  }

  console.log("GHL_MSG_WEBHOOK_OK", {
    version: VERSION,
    lead_id: leadId,
    resolved_by: resolvedBy,
    cancelled_touch_runs: cancelledCount,
  })

  return json({
    ok: true,
    version: VERSION,
    updated: true,
    lead_id: leadId,
    resolved_by: resolvedBy,
    lead_status: "REPLIED",
    cancelled_touch_runs: cancelledCount,
  })
})

export const config = { verify_jwt: false }
