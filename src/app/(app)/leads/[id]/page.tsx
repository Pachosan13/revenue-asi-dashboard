"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowLeft, Building2, Mail, MapPin, PhoneCall, User } from "lucide-react"

import { LeadActivityTimeline, type LeadTimelineEvent } from "@/components/leads/LeadActivityTimeline"
import { Badge, Button, Card, CardContent, CardHeader } from "@/components/ui-custom"
import { StatCard } from "@/components/ui-custom/stat-card"
import { supabaseBrowser } from "@/lib/supabase"
import type { LeadEnriched } from "@/types/lead"
import {
  describeAppointmentOutcome,
  describeReminder,
  describeTouchRun,
} from "@/components/leads/lead-activity-labels"
import { touchRunSelect, type TouchRunRow } from "@/components/leads/timeline-utils"

type LeadDetail = LeadEnriched & {
  company_name?: string | null
  notes?: string | null
}

type AppointmentRow = {
  id: string
  lead_id: string | null
  channel: string | null
  status: string | null
  outcome: string | null
  notes: string | null
  starts_at: string | null
  scheduled_for: string | null
  created_at: string | null
  updated_at: string | null
}

type AppointmentNotificationRow = {
  id: string
  appointment_id: string | null
  notify_at: string | null
  status: string | null
  payload: Record<string, any> | null
  created_at?: string | null
}

type LeadGenome = {
  industry: string | null
  sub_industry: string | null
  pain_points: string[] | null
  objections: string[] | null
  emotional_state: Record<string, any> | null
  urgency_score: number | null
  budget_estimate: string | null
  decision_authority_score: number | null
  conversion_likelihood: number | null
  recommended_channel: string | null
  recommended_cadence: Record<string, any> | null
  recommended_persona: string | null
  ai_lead_score: number | null
  status: string | null
  created_at: string | null
  updated_at: string | null
}

type LeadDataResult = {
  lead: LeadDetail | null
  genome: LeadGenome | null
  events: LeadTimelineEvent[]
  stats: {
    touches: number
    appointments: number
    reminders: number
  }
}

function formatDateTime(value: string | null) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleString()
}

function deriveLeadTitle(lead: LeadDetail | null) {
  if (!lead) return "Sin nombre"
  return (
    lead.full_name ||
    (lead as any).contact_name ||
    lead.email ||
    lead.phone ||
    "Sin nombre"
  )
}

function deriveLeadSubtitle(lead: LeadDetail | null) {
  if (!lead) return "Sin contacto"
  const email = lead.email ?? "Sin email"
  const phone = lead.phone ?? "Sin teléfono"
  return `${email} · ${phone}`
}

function appointmentTime(appt: AppointmentRow) {
  return appt.starts_at ?? appt.scheduled_for ?? appt.created_at
}

function mapTouchRuns(touchRuns: TouchRunRow[]): LeadTimelineEvent[] {
  return touchRuns.map((touch) => {
    const occurredAt = touch.scheduled_at ?? touch.created_at
    const { label, description } = describeTouchRun(touch)

    return {
      id: `touch-${touch.id}`,
      occurredAt: occurredAt ?? new Date().toISOString(),
      type: "touch_run" as const,
      channel: touch.channel,
      step: touch.step,
      label,
      description,
      status: touch.status,
      meta: touch.meta ?? undefined,
    }
  })
}

function mapAppointments(appointments: AppointmentRow[]): LeadTimelineEvent[] {
  return appointments.map((appointment) => {
    const when = appointmentTime(appointment) ?? new Date().toISOString()
    const formatted = formatDateTime(when)
    const description = formatted
      ? `Scheduled for ${formatted}${
          appointment.notes ? ` · ${appointment.notes}` : ""
        }`
      : appointment.notes ?? undefined

    return {
      id: `appointment-${appointment.id}`,
      occurredAt: when,
      type: "appointment" as const,
      channel: appointment.channel,
      step: null,
      label: "Appointment scheduled",
      description,
      status: appointment.status,
      meta: { appointmentId: appointment.id },
    }
  })
}

function mapAppointmentOutcomes(
  appointments: AppointmentRow[],
): LeadTimelineEvent[] {
  return appointments
    .filter((appointment) => Boolean(appointment.outcome))
    .map((appointment) => {
      const label = describeAppointmentOutcome(appointment.outcome)
      const when =
        appointment.updated_at ??
        appointmentTime(appointment) ??
        new Date().toISOString()
      const apptTime = appointmentTime(appointment)
      const formatted = formatDateTime(apptTime)

      const description = formatted
        ? `Outcome for appointment on ${formatted}`
        : "Appointment outcome updated"

      return {
        id: `appointment-outcome-${appointment.id}`,
        occurredAt: when,
        type: "appointment_outcome" as const,
        channel: appointment.channel,
        step: null,
        label,
        description,
        status: appointment.outcome,
        meta: { appointmentId: appointment.id },
      }
    })
}

function mapAppointmentReminders(
  reminders: AppointmentNotificationRow[],
  appointmentById: Map<string, AppointmentRow>,
  leadId: string,
): LeadTimelineEvent[] {
  return reminders
    .filter((reminder) => {
      const payloadLeadId =
        (reminder.payload?.lead_id as string | undefined) ?? null
      const appointmentLeadId = reminder.appointment_id
        ? appointmentById.get(reminder.appointment_id)?.lead_id ?? null
        : null
      return payloadLeadId === leadId || appointmentLeadId === leadId
    })
    .map((reminder) => {
      const appointment = reminder.appointment_id
        ? appointmentById.get(reminder.appointment_id)
        : undefined
      const when =
        reminder.notify_at ??
        appointmentTime(
          appointment ?? ({} as AppointmentRow),
        ) ??
        new Date().toISOString()
      const kind = (reminder.payload?.kind as string | undefined) ?? null
      const reminderLabel = describeReminder(kind) ?? "Appointment reminder"
      const appointmentDate = appointmentTime(
        appointment ?? ({} as AppointmentRow),
      )
      const formatted = formatDateTime(appointmentDate)

      return {
        id: `appointment-reminder-${reminder.id}`,
        occurredAt: when,
        type: "appointment_reminder" as const,
        channel: appointment?.channel ?? null,
        step: null,
        label: reminderLabel,
        description: formatted
          ? `Reminder for appointment on ${formatted}`
          : undefined,
        status: reminder.status,
        meta: { appointmentId: reminder.appointment_id, kind },
      }
    })
}

async function loadLeadDataBrowser(leadId: string): Promise<LeadDataResult> {
  const client = supabaseBrowser()

  // 1) Vista rica: lead_enriched
  const { data: enrichedRow, error: enrichedError } = await client
    .from("lead_enriched")
    .select(
      "id, full_name, email, phone, state, last_touch_at, channel_last, campaign_id, campaign_name, company_name, enriched",
    )
    .eq("id", leadId)
    .maybeSingle()

  let lead: LeadDetail | null = null

  if (enrichedRow) {
    lead = {
      ...(enrichedRow as any),
      company_name:
        (enrichedRow as any).company_name ??
        (enrichedRow as any).company ??
        null,
    }
  } else {
    // 2) Fallback: tabla leads (import original)
    const { data: baseRow } = await client
      .from("leads")
      .select(
        "id, contact_name, email, phone, state, last_touched_at, last_channel, campaign_id, campaign_name, company_name, enriched",
      )
      .eq("id", leadId)
      .maybeSingle()

    if (baseRow) {
      lead = {
        id: baseRow.id,
        full_name: (baseRow as any).contact_name ?? null,
        email: baseRow.email ?? null,
        phone: baseRow.phone ?? null,
        state: baseRow.state ?? null,
        last_touch_at: (baseRow as any).last_touched_at ?? null,
        campaign_id: (baseRow as any).campaign_id ?? null,
        campaign_name: (baseRow as any).campaign_name ?? null,
        channel_last: (baseRow as any).last_channel ?? null,
        company_name: (baseRow as any).company_name ?? null,
        enriched: (baseRow as any).enriched ?? null,
      } as any
    }

    if (!baseRow && enrichedError) {
      console.warn("lead_enriched error:", enrichedError)
    }
  }

  // Si aún no tenemos lead, devolvemos dummy pero con ID
  if (!lead) {
    lead = {
      id: leadId,
      full_name: null,
      email: null,
      phone: null,
      state: "unknown",
      last_touch_at: null,
      campaign_id: null,
      campaign_name: null,
      channel_last: null,
      company_name: null,
      notes: null,
      enriched: null,
    } as any
  }

  // 3) Lead Genome: último enrichment_v2 completado
  let genome: LeadGenome | null = null

  const { data: enrichmentRow, error: enrichmentError } = await client
    .from("lead_enrichments_v2")
    .select(
      `
      industry,
      sub_industry,
      pain_points,
      objections,
      emotional_state,
      urgency_score,
      budget_estimate,
      decision_authority_score,
      conversion_likelihood,
      recommended_channel,
      recommended_cadence,
      recommended_persona,
      ai_lead_score,
      status,
      created_at,
      updated_at
    `,
    )
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (enrichmentError) {
    console.warn("lead_enrichments_v2 error:", enrichmentError)
  }

  if (enrichmentRow) {
    genome = {
      industry: enrichmentRow.industry ?? null,
      sub_industry: enrichmentRow.sub_industry ?? null,
      pain_points: (enrichmentRow.pain_points as string[] | null) ?? null,
      objections: (enrichmentRow.objections as string[] | null) ?? null,
      emotional_state:
        (enrichmentRow.emotional_state as Record<string, any> | null) ?? null,
      urgency_score:
        typeof enrichmentRow.urgency_score === "number"
          ? enrichmentRow.urgency_score
          : enrichmentRow.urgency_score != null
          ? Number(enrichmentRow.urgency_score)
          : null,
      budget_estimate: enrichmentRow.budget_estimate ?? null,
      decision_authority_score:
        typeof enrichmentRow.decision_authority_score === "number"
          ? enrichmentRow.decision_authority_score
          : enrichmentRow.decision_authority_score != null
          ? Number(enrichmentRow.decision_authority_score)
          : null,
      conversion_likelihood:
        typeof enrichmentRow.conversion_likelihood === "number"
          ? enrichmentRow.conversion_likelihood
          : enrichmentRow.conversion_likelihood != null
          ? Number(enrichmentRow.conversion_likelihood)
          : null,
      recommended_channel: enrichmentRow.recommended_channel ?? null,
      recommended_cadence:
        (enrichmentRow.recommended_cadence as Record<string, any> | null) ??
        null,
      recommended_persona: enrichmentRow.recommended_persona ?? null,
      ai_lead_score:
        typeof enrichmentRow.ai_lead_score === "number"
          ? enrichmentRow.ai_lead_score
          : enrichmentRow.ai_lead_score != null
          ? Number(enrichmentRow.ai_lead_score)
          : null,
      status: enrichmentRow.status ?? null,
      created_at: enrichmentRow.created_at ?? null,
      updated_at: enrichmentRow.updated_at ?? null,
    }
  }

  // 4) Timeline y stats
  const [touchRunsResult, appointmentsResult, remindersResult] =
    await Promise.all([
      client
        .from("touch_runs")
        .select(touchRunSelect)
        .eq("lead_id", leadId)
        .order("scheduled_at", {
          ascending: false,
          nullsLast: true,
        } as any)
        .order("created_at", { ascending: false }),
      client
        .from("appointments")
        .select(
          "id, lead_id, channel, status, outcome, notes, starts_at, scheduled_for, created_at, updated_at",
        )
        .eq("lead_id", leadId),
      client
        .from("appointments_notifications")
        .select(
          "id, appointment_id, notify_at, status, payload, created_at",
        ),
    ])

  const touchRuns = (touchRunsResult.data ?? []) as TouchRunRow[]
  const appointments = (appointmentsResult.data ?? []) as AppointmentRow[]
  const reminders =
    (remindersResult.data ?? []) as AppointmentNotificationRow[]

  const appointmentById = new Map<string, AppointmentRow>()
  appointments.forEach((row) => appointmentById.set(row.id, row))

  const events: LeadTimelineEvent[] = [
    ...mapTouchRuns(touchRuns),
    ...mapAppointments(appointments),
    ...mapAppointmentOutcomes(appointments),
    ...mapAppointmentReminders(reminders, appointmentById, leadId),
  ].sort((a, b) => {
    const aTime = new Date(a.occurredAt).getTime()
    const bTime = new Date(b.occurredAt).getTime()
    const safeA = Number.isNaN(aTime) ? 0 : aTime
    const safeB = Number.isNaN(bTime) ? 0 : bTime
    return safeB - safeA
  })

  return {
    lead,
    genome,
    events,
    stats: {
      touches: touchRuns.length,
      appointments: appointments.length,
      reminders: reminders.length,
    },
  }
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const leadId = params.id

  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  )

  const [lead, setLead] = useState<LeadDetail | null>(null)
  const [genome, setGenome] = useState<LeadGenome | null>(null)
  const [events, setEvents] = useState<LeadTimelineEvent[]>([])
  const [stats, setStats] = useState({
    touches: 0,
    appointments: 0,
    reminders: 0,
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!supabaseReady || !leadId) return

    let alive = true

    ;(async () => {
      setLoading(true)
      const result = await loadLeadDataBrowser(leadId)
      if (!alive) return
      setLead(result.lead)
      setGenome(result.genome)
      setEvents(result.events)
      setStats(result.stats)
      setLoading(false)
    })()

    return () => {
      alive = false
    }
  }, [leadId, supabaseReady])

  const title = deriveLeadTitle(lead)
  const subtitle = deriveLeadSubtitle(lead)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/leads">
            <Button variant="outline" size="sm">
              <ArrowLeft size={16} />
              Back
            </Button>
          </Link>
          <div>
            <p className="text-sm uppercase tracking-[0.16em] text-white/50">
              Lead
            </p>
            <h1 className="text-3xl font-semibold text-white">
              Lead timeline
            </h1>
            <p className="text-sm text-white/80">{title}</p>
            <p className="text-xs text-white/60">
              {subtitle} · ID: {leadId}
            </p>
          </div>
        </div>
        {lead?.state ? (
          <Badge variant="outline" className="capitalize">
            {lead.state}
          </Badge>
        ) : null}
      </div>

      {/* Overview */}
      <Card>
        <CardHeader
          title="Lead overview"
          description="Basic details and last touch information"
        />
        <CardContent className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <div className="flex items-center gap-2 text-white">
              <User size={16} className="text-white/60" />
              <span className="font-semibold">{title}</span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <Mail size={14} className="text-white/50" />
              <span>{lead?.email ?? "Sin email"}</span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <PhoneCall size={14} className="text-white/50" />
              <span>{lead?.phone ?? "Sin teléfono"}</span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <Building2 size={14} className="text-white/50" />
              <span>{lead?.company_name ?? "Sin compañía"}</span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <MapPin size={14} className="text-white/50" />
              <span>{lead?.channel_last ?? "Sin canal"}</span>
            </div>
          </div>
          <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-white/80">
            <p className="text-sm text-white/60">Last touch</p>
            <p className="text-lg font-semibold text-white">
              {formatDateTime(lead?.last_touch_at ?? null) ??
                "No touches yet"}
            </p>
            <p className="text-sm text-white/60">
              Channel: {lead?.channel_last ?? "—"}
            </p>
            <p className="text-sm text-white/60">
              Campaign:{" "}
              {lead?.campaign_name ?? lead?.campaign_id ?? "—"}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Lead Genome V2 */}
      {genome && (
        <Card>
          <CardHeader
            title="Lead Genome"
            description="Industry, pains, objections and AI recommendations for this lead"
          />
          <CardContent className="grid gap-4 md:grid-cols-2 text-sm text-white/80">
            <div className="space-y-2">
              <p>
                <span className="text-white/50">Industry:</span>{" "}
                <span className="text-white">
                  {genome.industry ?? "Unknown"}
                </span>
              </p>
              <p>
                <span className="text-white/50">Sub-industry:</span>{" "}
                <span className="text-white">
                  {genome.sub_industry ?? "—"}
                </span>
              </p>
              <p>
                <span className="text-white/50">
                  Recommended channel:
                </span>{" "}
                <span className="text-white">
                  {genome.recommended_channel ?? "—"}
                </span>
              </p>
              <p>
                <span className="text-white/50">Persona:</span>{" "}
                <span className="text-white">
                  {genome.recommended_persona ?? "—"}
                </span>
              </p>
              {typeof genome.ai_lead_score === "number" && (
                <p>
                  <span className="text-white/50">AI Lead score:</span>{" "}
                  <span className="text-white">
                    {genome.ai_lead_score}
                  </span>
                </p>
              )}
              {typeof genome.urgency_score === "number" && (
                <p>
                  <span className="text-white/50">Urgency:</span>{" "}
                  <span className="text-white">
                    {genome.urgency_score}
                  </span>
                </p>
              )}
              {typeof genome.decision_authority_score === "number" && (
                <p>
                  <span className="text-white/50">
                    Decision authority:
                  </span>{" "}
                  <span className="text-white">
                    {genome.decision_authority_score}
                  </span>
                </p>
              )}
              {typeof genome.conversion_likelihood === "number" && (
                <p>
                  <span className="text-white/50">
                    Conversion likelihood:
                  </span>{" "}
                  <span className="text-white">
                    {genome.conversion_likelihood}
                  </span>
                </p>
              )}
            </div>
            <div className="space-y-3">
              {Array.isArray(genome.pain_points) &&
                genome.pain_points.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.16em] text-white/40">
                      Pain points
                    </p>
                    <ul className="space-y-1 list-disc pl-4 text-xs text-white/80">
                      {genome.pain_points.map((p, idx) => (
                        <li key={idx}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
              {Array.isArray(genome.objections) &&
                genome.objections.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs uppercase tracking-[0.16em] text-white/40">
                      Objections
                    </p>
                    <ul className="space-y-1 list-disc pl-4 text-xs text-white/80">
                      {genome.objections.map((o, idx) => (
                        <li key={idx}>{o}</li>
                      ))}
                    </ul>
                  </div>
                )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total activity"
          value={events.length.toString()}
          helper="Touches, appointments and reminders"
        />
        <StatCard
          label="Touch runs"
          value={stats.touches.toString()}
          helper="touch_runs registrados"
        />
        <StatCard
          label="Appointments"
          value={stats.appointments.toString()}
          helper="Incluye outcomes y reminders"
        />
      </div>

      {/* Timeline */}
      <LeadActivityTimeline events={events} />

      {loading ? (
        <div className="space-y-3">
          <div className="h-10 animate-pulse rounded-xl bg-white/5" />
          <div className="h-52 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
        </div>
      ) : null}
    </div>
  )
}
