// supabase/functions/ghl-appointment-webhook/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { setLeadState } from "../_shared/state.ts"

const VERSION = "ghl-appointment-webhook-v10_2025-12-10"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function parseBodyAsObject(text: string): Record<string, unknown> {
  const params = new URLSearchParams(text)
  const out: Record<string, unknown> = {}
  for (const [k, v] of params.entries()) {
    out[k] = v
  }
  return out
}

function firstNonEmpty(...vals: (string | null | undefined)[]): string | null {
  for (const v of vals) {
    if (v && String(v).trim().length > 0) return String(v).trim()
  }
  return null
}

serve(async (req) => {
  // Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        error: "Only POST allowed",
      }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")
  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  const url = new URL(req.url)
  const accountIdFromUrl = url.searchParams.get("account_id")

  // 1) Leer body (JSON o form-urlencoded)
  let rawBody: any = null
  let textBody = ""
  try {
    rawBody = await req.json()
  } catch {
    textBody = await req.text()
    if (textBody) {
      rawBody = parseBodyAsObject(textBody)
    } else {
      rawBody = {}
    }
  }

  // 2) Extraer campos clave del payload REAL de GHL
  const contactName = firstNonEmpty(
    rawBody.full_name,
    rawBody.first_name && rawBody.last_name
      ? `${rawBody.first_name} ${rawBody.last_name}`
      : null,
    rawBody.first_name,
    rawBody.last_name,
  )

  const contactEmail = firstNonEmpty(
    rawBody.email,
    rawBody?.contact?.email,
    rawBody["contact.email"] as string,
  )

  const contactPhone = firstNonEmpty(
    rawBody.phone,
    rawBody?.contact?.phone,
    rawBody["contact.phone"] as string,
  )

  const appointmentId = firstNonEmpty(
    rawBody?.calendar?.appointmentId,
    rawBody.appointment_id as string,
  )

  const appointmentTime = firstNonEmpty(
    rawBody?.calendar?.startTime,
    rawBody.appointment_time as string,
  )

  const calendarId = firstNonEmpty(
    rawBody?.calendar?.id,
    rawBody.calendar_id as string,
  )

  if (!contactEmail && !contactPhone) {
    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        lead_found: false,
        reason: "missing_email_or_phone",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 3) Resolver / crear lead
  let leadId: string | null = null
  let accountId: string | null = null
  let resolvedBy: string | null = null

  const orFilters: string[] = []
  if (contactEmail) orFilters.push(`email.eq.${contactEmail}`)
  if (contactPhone) orFilters.push(`phone.eq.${contactPhone}`)

  try {
    if (orFilters.length > 0) {
      const { data: ld, error: ldErr } = await supabase
        .from("leads")
        .select("id, account_id")
        .or(orFilters.join(","))
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()

      if (!ldErr && ld?.id) {
        leadId = ld.id
        accountId = ld.account_id
        resolvedBy = "leads"
      } else if (ldErr) {
        console.error("leads lookup error:", ldErr.message)
      }
    }

    // Si no existe lead → crearlo
    if (!leadId && accountIdFromUrl) {
      const { data: newLead, error: nErr } = await supabase
        .from("leads")
        .insert({
          account_id: accountIdFromUrl,
          contact_name: contactName ?? contactEmail ?? contactPhone,
          email: contactEmail,
          phone: contactPhone,
          source: "ghl_webhook",
        })
        .select("id, account_id")
        .single()

      if (nErr) {
        console.error("leads insert error:", nErr.message)
      } else if (newLead?.id) {
        leadId = newLead.id
        accountId = newLead.account_id
        resolvedBy = "created"
      }
    }
  } catch (e) {
    console.error("lead resolve/insert exception:", e)
  }

  if (!leadId) {
    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        lead_found: false,
        reason: "no_matching_lead",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // 4) Upsert appointment en tabla appointments
  let appointmentInserted = false
  try {
    if (appointmentTime) {
      const startsAtIso = new Date(appointmentTime).toISOString()
      const channel = "calendar"

      const { data: existingAppt, error: apptErr } = await supabase
        .from("appointments")
        .select("id")
        .eq("lead_id", leadId)
        .eq("starts_at", startsAtIso)
        .eq("channel", channel)
        .maybeSingle()

      if (apptErr && apptErr.message !== "No rows found") {
        console.error("appointments lookup error:", apptErr.message)
      }

      const accountIdFinal = accountId ?? accountIdFromUrl

      if (existingAppt?.id) {
        const { error: updApptErr } = await supabase
          .from("appointments")
          .update({
            account_id: accountIdFinal,
            status: "scheduled",
            created_by: "ghl_webhook",
            notes: "Updated via GHL webhook",
          })
          .eq("id", existingAppt.id)

        if (updApptErr) {
          console.error("appointments update error:", updApptErr.message)
        } else {
          appointmentInserted = true
        }
      } else {
        const { error: insApptErr } = await supabase
          .from("appointments")
          .insert({
            lead_id: leadId,
            account_id: accountIdFinal,
            channel,
            scheduled_for: startsAtIso,
            starts_at: startsAtIso,
            status: "scheduled",
            created_by: "ghl_webhook",
            notes: "Created via GHL webhook",
          })

        if (insApptErr) {
          console.error("appointments insert error:", insApptErr.message)
        } else {
          appointmentInserted = true
        }
      }
    }
  } catch (e) {
    console.error("appointments upsert exception:", e)
  }

  // 5) Cambiar estado del lead a booked
  try {
    await setLeadState({
      supabase,
      leadId,
      newState: "booked",
      reason: "appointment_booked_via_ghl",
      actor: "system",
      source: "ghl_webhook",
      meta: {
        appointment_id: appointmentId,
        calendar_id: calendarId,
        appointment_time: appointmentTime,
        raw: rawBody,
      },
    })
  } catch (e) {
    console.error("setLeadState error:", e)
  }

  // 6) Cancelar touch_runs pendientes
  let cancelledCount = 0
  try {
    const { data: pending, error: pErr } = await supabase
      .from("touch_runs")
      .select("id")
      .eq("lead_id", leadId)
      .in("status", ["queued", "scheduled"])

    if (pErr) {
      console.error("select pending touch_runs error:", pErr.message)
    } else if (pending && pending.length > 0) {
      const ids = pending.map((r: any) => r.id)
      const { error: uErr } = await supabase
        .from("touch_runs")
        .update({
          status: "cancelled",
          error: "stopped_due_to_appointment_booked",
        })
        .in("id", ids)

      if (uErr) {
        console.error("update touch_runs error:", uErr.message)
      } else {
        cancelledCount = ids.length
      }
    }
  } catch (e) {
    console.error("cancel touch_runs exception:", e)
  }

  // 7) Respuesta final
  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      lead_found: true,
      lead_id: leadId,
      account_id: accountId ?? accountIdFromUrl,
      resolved_by: resolvedBy,
      appointment_time: appointmentTime,
      appointment_inserted: appointmentInserted,
      cancelled_touch_runs: cancelledCount,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  )
})
