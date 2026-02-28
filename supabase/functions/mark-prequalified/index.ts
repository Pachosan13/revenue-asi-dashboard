import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const VERSION = "mark-prequalified-v1_2026-02-28"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function pickString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim()
  }
  return null
}

function getInternalToken(req: Request) {
  const auth = String(req.headers.get("authorization") ?? "")
  const bearer = auth.replace(/^Bearer\s+/i, "").trim()
  const headerToken = String(req.headers.get("x-internal-token") ?? "").trim()
  return bearer || headerToken
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json({ ok: false, version: VERSION, error: "Only POST allowed" }, 405)

  const expectedToken =
    String(Deno.env.get("MARK_PREQUALIFIED_TOKEN") ?? "").trim() ||
    String(Deno.env.get("GHL_INTERNAL_TOKEN") ?? "").trim()
  if (!expectedToken) {
    return json({ ok: false, version: VERSION, error: "Missing MARK_PREQUALIFIED_TOKEN" }, 500)
  }
  const providedToken = getInternalToken(req)
  if (!providedToken || providedToken !== expectedToken) {
    return json({ ok: false, version: VERSION, error: "Unauthorized" }, 401)
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!SB_URL || !SB_KEY) {
    return json({ ok: false, version: VERSION, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" }, 500)
  }
  const supabase = createClient(SB_URL, SB_KEY, { auth: { persistSession: false } })

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const leadId = pickString(body.lead_id)
  const prequalOk = Boolean(body.prequal_ok)
  const source = pickString(body.source) ?? "enc24_ai_prequal"
  const notes = pickString(body.notes)

  if (!leadId) return json({ ok: false, version: VERSION, error: "lead_id required" }, 400)

  const { data: lead, error: leadErr } = await supabase
    .from("leads")
    .select("id, account_id, contact_name, phone, external_id")
    .eq("id", leadId)
    .maybeSingle()
  if (leadErr) return json({ ok: false, version: VERSION, error: "lead_lookup_failed", details: leadErr.message }, 500)
  if (!lead?.id) return json({ ok: false, version: VERSION, error: "lead_not_found" }, 404)

  const nowIso = new Date().toISOString()
  const leadPatch: Record<string, unknown> = {
    prequal_ok: prequalOk,
    prequal_marked_at: nowIso,
    updated_at: nowIso,
  }

  let handoffResult: Record<string, unknown> = { status: "skipped", reason: "prequal_not_ok" }
  if (prequalOk) {
    const assigneeUserId = String(Deno.env.get("GHL_DARMESH_USER_ID") ?? "").trim() || null
    const assigneeEmail =
      String(Deno.env.get("GHL_DARMESH_EMAIL") ?? "").trim() || "darmesh@unknown.local"
    const assignmentMethod =
      String(Deno.env.get("GHL_HANDOFF_ASSIGNMENT_METHOD") ?? "").trim() || "tag"
    const assignmentTarget =
      String(Deno.env.get("GHL_HANDOFF_ASSIGNMENT_TARGET") ?? "").trim() || "owner_darmesh"
    const webhookUrl = String(Deno.env.get("GHL_HANDOFF_WEBHOOK_URL") ?? "").trim()
    const webhookToken = String(Deno.env.get("GHL_HANDOFF_WEBHOOK_TOKEN") ?? "").trim()

    leadPatch.handoff_at = nowIso
    leadPatch.handoff_assignee_user_id = assigneeUserId
    leadPatch.handoff_assignee_email = assigneeEmail

    const handoffPayload = {
      event_type: "prequal_handoff",
      source,
      lead: {
        id: lead.id,
        account_id: lead.account_id ?? null,
        contact_name: lead.contact_name ?? null,
        phone_e164: lead.phone ?? null,
        external_id: lead.external_id ?? null,
      },
      prequal_ok: true,
      assignment: {
        assignee_user_id: assigneeUserId,
        assignee_email: assigneeEmail,
        method: assignmentMethod,
        target: assignmentTarget,
      },
      notes: notes ?? null,
      at: nowIso,
    }

    let status: "recorded" | "sent" | "failed" | "skipped" = "recorded"
    let webhookResponseStatus: number | null = null
    let webhookResponseText: string | null = null

    if (webhookUrl) {
      try {
        const res = await fetch(webhookUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(webhookToken ? { Authorization: `Bearer ${webhookToken}` } : {}),
          },
          body: JSON.stringify(handoffPayload),
        })
        webhookResponseStatus = res.status
        webhookResponseText = await res.text().catch(() => "")
        status = res.ok ? "sent" : "failed"
      } catch (e) {
        status = "failed"
        webhookResponseText = String((e as Error)?.message ?? e)
      }
    }

    const { error: handoffErr } = await supabase.from("ghl_handoff_events").insert({
      account_id: lead.account_id ?? null,
      lead_id: lead.id,
      prequal_ok: true,
      assignee_user_id: assigneeUserId,
      assignee_email: assigneeEmail,
      assignment_method: assignmentMethod,
      assignment_target: assignmentTarget,
      status,
      webhook_url: webhookUrl || null,
      webhook_response_status: webhookResponseStatus,
      webhook_response_text: webhookResponseText,
      payload: handoffPayload,
    })
    if (handoffErr) {
      return json({ ok: false, version: VERSION, error: "handoff_insert_failed", details: handoffErr.message }, 500)
    }
    handoffResult = {
      status,
      assignee_user_id: assigneeUserId,
      assignee_email: assigneeEmail,
      assignment_method: assignmentMethod,
      assignment_target: assignmentTarget,
      webhook_url_configured: Boolean(webhookUrl),
      webhook_response_status: webhookResponseStatus,
    }
  }

  const { error: updErr } = await supabase.from("leads").update(leadPatch).eq("id", lead.id)
  if (updErr) return json({ ok: false, version: VERSION, error: "lead_update_failed", details: updErr.message }, 500)

  return json({
    ok: true,
    version: VERSION,
    lead_id: lead.id,
    prequal_ok: prequalOk,
    handoff: handoffResult,
  })
})

export const config = { verify_jwt: false }
