import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VERSION = "ghl-whatsapp-webhook-v1_2026-02-28"

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

function inferEventType(body: Record<string, unknown>): "message_sent" | "message_failed" | "inbound_reply" | null {
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
      body.status,
      (body as any)?.message?.type,
      (body as any)?.data?.type,
      (body as any)?.data?.status,
    ) ?? "",
  ).toLowerCase()

  if (
    direction === "inbound" ||
    eventType.includes("inbound") ||
    eventType.includes("message_received") ||
    eventType.includes("reply")
  ) {
    return "inbound_reply"
  }
  if (
    eventType.includes("failed") ||
    eventType.includes("undeliver") ||
    eventType.includes("error") ||
    eventType.includes("bounce")
  ) {
    return "message_failed"
  }
  if (
    direction === "outbound" ||
    eventType.includes("sent") ||
    eventType.includes("deliver") ||
    eventType.includes("outbound")
  ) {
    return "message_sent"
  }
  return null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, version: VERSION, error: "Only POST allowed" }, 405)

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  const WEBHOOK_TOKEN =
    String(Deno.env.get("GHL_WHATSAPP_WEBHOOK_TOKEN") ?? "").trim() ||
    String(Deno.env.get("GHL_INBOUND_WEBHOOK_TOKEN") ?? "").trim()
  if (!SB_URL || !SB_KEY) {
    return json({ ok: false, version: VERSION, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }

  const url = new URL(req.url)
  const headerToken = (req.headers.get("x-webhook-token") ?? "").trim()
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim()
  const queryToken = (url.searchParams.get("token") ?? "").trim()
  const providedToken = headerToken || bearer || queryToken
  if (WEBHOOK_TOKEN && providedToken !== WEBHOOK_TOKEN) {
    return json({ ok: false, version: VERSION, error: "Unauthorized" }, 401)
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    const textBody = await req.text()
    body = textBody ? parseBodyAsObject(textBody) : {}
  }

  const eventType = inferEventType(body)
  if (!eventType) {
    return json({ ok: true, version: VERSION, ignored: true, reason: "unrecognized_event_type" })
  }

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
      body.to,
      (body as any)?.contact?.phone,
      (body as any)?.data?.contact?.phone,
      (body as any)?.message?.from,
      (body as any)?.message?.to,
    ),
  )
  const externalId = pickString(
    body.external_id,
    (body as any)?.contact?.external_id,
    (body as any)?.data?.external_id,
    (body as any)?.customData?.external_id,
  )
  const providerMessageId = pickString(
    body.message_id,
    body.id,
    (body as any)?.message?.id,
    (body as any)?.data?.id,
  )

  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

  let leadId = leadIdInput
  let resolvedBy: string | null = null
  if (!leadId && (phone || email)) {
    let query = supabase.from("leads").select("id").order("created_at", { ascending: false }).limit(1)
    if (accountId) query = query.eq("account_id", accountId)
    const orFilters: string[] = []
    if (email) orFilters.push(`email.eq.${email}`)
    if (phone) orFilters.push(`phone.eq.${phone}`)
    if (orFilters.length > 0) query = query.or(orFilters.join(","))
    const { data, error } = await query.maybeSingle()
    if (error) return json({ ok: false, version: VERSION, error: "lead_lookup_failed", details: error.message }, 500)
    leadId = data?.id ?? null
    resolvedBy = leadId ? "phone_or_email" : null
  } else if (leadId) {
    resolvedBy = "lead_id"
  }

  if (eventType === "inbound_reply" && leadId) {
    const now = Date.now()
    const window24h = new Date(now + 24 * 60 * 60 * 1000).toISOString()
    const { error: leadUpdErr } = await supabase
      .from("leads")
      .update({
        lead_status: "REPLIED",
        status: "suppressed",
        lead_state: "engaged",
        followup_free_text_until: window24h,
        updated_at: new Date(now).toISOString(),
      })
      .eq("id", leadId)
    if (leadUpdErr) {
      return json({ ok: false, version: VERSION, error: "lead_update_failed", details: leadUpdErr.message }, 500)
    }

    const { data: activeRuns, error: activeErr } = await supabase
      .from("touch_runs")
      .select("id")
      .eq("lead_id", leadId)
      .in("status", ["queued", "scheduled", "executing"])
    if (activeErr) {
      return json({ ok: false, version: VERSION, error: "touch_runs_lookup_failed", details: activeErr.message }, 500)
    }
    const activeIds = (activeRuns ?? []).map((r: any) => r.id).filter(Boolean)
    if (activeIds.length > 0) {
      const { error: cancelErr } = await supabase
        .from("touch_runs")
        .update({
          status: "canceled",
          error: "stopped_due_to_whatsapp_inbound_reply",
          updated_at: new Date().toISOString(),
        })
        .in("id", activeIds)
      if (cancelErr) {
        return json({ ok: false, version: VERSION, error: "touch_runs_cancel_failed", details: cancelErr.message }, 500)
      }
    }
  }

  const eventInsert: Record<string, unknown> = {
    account_id: accountId,
    lead_id: leadId,
    external_id: externalId,
    phone_e164: phone,
    provider_message_id: providerMessageId,
    event_type: eventType,
    payload: body,
  }
  const { error: eventErr } = await supabase.from("ghl_whatsapp_events").insert(eventInsert)
  if (eventErr) {
    return json({ ok: false, version: VERSION, error: "event_insert_failed", details: eventErr.message }, 500)
  }

  return json({
    ok: true,
    version: VERSION,
    event_type: eventType,
    lead_id: leadId,
    resolved_by: resolvedBy,
  })
})

export const config = { verify_jwt: false }
