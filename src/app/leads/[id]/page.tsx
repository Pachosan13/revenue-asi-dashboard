import Link from "next/link"

import { LeadActivityTimeline, type LeadTimelineEvent } from "@/components/leads/LeadActivityTimeline"
import {
<<<<<<< HEAD
  AlertTriangle,
  ArrowLeft,
  PhoneCall,
  Mail,
  Clock4
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"

import { supabaseBrowser } from "@/lib/supabase"
import { LeadTimeline } from "@/components/leads/LeadTimeline"

import {
  fetchLeadTouchRuns,
  formatPreview,
  getWhen,
  statusVariant,
  channelLabel,         // 👈 AQUI ESTÁ EL FALTANTE
  type TouchRunRow,
} from "@/components/leads/timeline-utils"
<<<<<<< HEAD

=======
  describeAppointmentOutcome,
  describeReminder,
  describeTouchRun,
} from "@/components/leads/lead-activity-labels"
import { touchRunSelect, type TouchRunRow } from "@/components/leads/timeline-utils"
>>>>>>> origin/codex/implement-lead-detail-timeline-2.0
=======
import {
  AppointmentStatusBadge,
  IntentBadge,
  LeadStateBadge,
} from "@/components/leads/badges"
import { supabaseBrowser } from "@/lib/supabase"
>>>>>>> origin/director-engine-core
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui-custom"

import { StatCard } from "@/components/ui-custom/stat-card"
import { supabaseServer } from "@/lib/supabase-server"
import type { LeadEnriched } from "@/types/lead"
import { Building2, Mail, MapPin, PhoneCall, User } from "lucide-react"

type LeadDetail = LeadEnriched & { company?: string | null; notes?: string | null }

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

type LeadDataResult = {
  lead: LeadDetail | null
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
  return lead.full_name || lead.email || lead.phone || "Sin nombre"
}

function deriveLeadSubtitle(lead: LeadDetail | null) {
  if (!lead) return "Sin contacto"
  const email = lead.email ?? "Sin email"
  const phone = lead.phone ?? "Sin teléfono"
  return `${email} · ${phone}`
}

<<<<<<< HEAD
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
      type: "touch_run",
      channel: touch.channel,
      step: touch.step,
      label,
      description,
      status: touch.status,
      meta: touch.meta ?? undefined,
=======
type VoiceCall = {
  id: string
  status: string | null
  provider_call_id: string | null
  meta: Record<string, unknown> | null
  updated_at: string
}

type Appointment = {
  id: string
  scheduled_for: string
  status: string
  channel: string | null
  created_by: string | null
}

type LeadEvent = {
  id: string
  event_type: string
  payload: Record<string, unknown> | null
  created_at: string
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const leadId = params?.id ?? ""

  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  )

  const [lead, setLead] = useState<LeadRecord | null>(null)
  const [steps, setSteps] = useState<NormalizedStep[]>([])
  const [voiceCalls, setVoiceCalls] = useState<VoiceCall[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [leadEvents, setLeadEvents] = useState<LeadEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingMock, setUsingMock] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadLead() {
      if (!leadId) return

      setLoading(true)
      setError(null)

      const isMockId = leadId.startsWith("MOCK-")

      // 🔹 Modo mock (IDs MOCK-xxxx o sin Supabase)
      if (!supabaseReady || isMockId) {
        if (!alive) return

        setLead({
          id: leadId,
          full_name: "Sin nombre",
          email: null,
          phone: null,
          state: null,
          last_touch_at: null,
          channel_last: null,
        })
        setSteps([])
        setVoiceCalls([])
        setAppointments([])
        setLeadEvents([])
        setUsingMock(true)
        setLoading(false)
        return
      }

      // 🔹 Flujo real (UUIDs con Supabase)
      const client = supabaseBrowser()

      try {
        const [
          { data: enriched, error: enrichedError },
          stepsResult,
          voiceResult,
          appointmentsResult,
          eventsResult,
        ] = await Promise.all([
          client
            .from("lead_enriched")
            .select(
              "id, full_name, email, phone, state, last_touch_at, channel_last",
            )
            .eq("id", leadId)
            .maybeSingle(),
          fetchLeadTouchRuns(client, leadId),
          client
            .from("voice_calls")
            .select("id, status, provider_call_id, meta, updated_at")
            .eq("lead_id", leadId)
            .order("updated_at", { ascending: false })
            .limit(20),
          client
            .from("appointments")
            .select("id, scheduled_for, status, channel, created_by")
            .eq("lead_id", leadId)
            .order("scheduled_for", { ascending: false })
            .limit(20),
          client
            .from("lead_events")
            .select("id, event_type, payload, created_at")
            .eq("lead_id", leadId)
            .order("created_at", { ascending: false })
            .limit(50),
        ])

        if (!alive) return

        if (enrichedError) {
          console.warn("lead_enriched error", enrichedError)
        }

        const { data: stepsData, error: stepsError } = stepsResult

        if (stepsError) {
          console.error("touch_runs error", stepsError)
          setError(
            "No se pudo obtener el timeline de touch_runs para este lead. Revisa la configuración o intenta más tarde.",
          )
        }

        if (enriched) {
          setLead({
            id: enriched.id,
            full_name: enriched.full_name ?? null,
            email: enriched.email ?? null,
            phone: enriched.phone ?? null,
            state: enriched.state ?? null,
            last_touch_at: enriched.last_touch_at ?? null,
            channel_last: enriched.channel_last ?? null,
          })
        } else {
          setLead({
            id: leadId,
            full_name: "Sin nombre",
            email: null,
            phone: null,
            state: null,
            last_touch_at: null,
            channel_last: null,
          })
        }

        setSteps(
          stepsError || !stepsData
            ? []
            : normalizeSteps(stepsData as TouchRunRow[]),
        )
        if (voiceResult.error) {
          console.error(voiceResult.error)
        }

        if (appointmentsResult.error) {
          console.error(appointmentsResult.error)
        }

        if (eventsResult.error) {
          console.error(eventsResult.error)
        }

        setVoiceCalls((voiceResult.data ?? []) as VoiceCall[])
        setAppointments((appointmentsResult.data ?? []) as Appointment[])
        setLeadEvents((eventsResult.data ?? []) as LeadEvent[])
        setUsingMock(false)
      } catch (e) {
        if (!alive) return
        console.error("loadLead unexpected error", e)
        setError(
          "No se pudo obtener el timeline de touch_runs para este lead. Revisa la configuración o vuelve a intentar.",
        )
        setSteps([])
      } finally {
        if (!alive) return
        setLoading(false)
      }
>>>>>>> origin/director-engine-core
    }
  })
}

function mapAppointments(appointments: AppointmentRow[]): LeadTimelineEvent[] {
  return appointments.map((appointment) => {
    const when = appointmentTime(appointment) ?? new Date().toISOString()
    const formatted = formatDateTime(when)
    const description = formatted
      ? `Scheduled for ${formatted}${appointment.notes ? ` · ${appointment.notes}` : ""}`
      : appointment.notes

    return {
      id: `appointment-${appointment.id}`,
      occurredAt: when,
      type: "appointment",
      channel: appointment.channel,
      step: null,
      label: "Appointment scheduled",
      description,
      status: appointment.status,
      meta: { appointmentId: appointment.id },
    }
  })
}

function mapAppointmentOutcomes(appointments: AppointmentRow[]): LeadTimelineEvent[] {
  return appointments
    .filter((appointment) => Boolean(appointment.outcome))
    .map((appointment) => {
      const label = describeAppointmentOutcome(appointment.outcome)
      const when = appointment.updated_at ?? appointmentTime(appointment) ?? new Date().toISOString()
      const formatted = formatDateTime(appointmentTime(appointment))
      const description = formatted
        ? `Outcome for appointment on ${formatted}`
        : "Appointment outcome updated"

<<<<<<< HEAD
      return {
        id: `appointment-outcome-${appointment.id}`,
        occurredAt: when,
        type: "appointment_outcome",
        channel: appointment.channel,
        step: null,
        label,
        description,
        status: appointment.outcome,
        meta: { appointmentId: appointment.id },
      }
=======
  const cadenceStopped = steps.some(
    (step) => step.status === "stopped" && step.error === "appointment_created",
  )

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { date: string; label: string; items: NormalizedStep[] }
    >()

    steps.forEach((step) => {
      const group =
        groups.get(step.dateKey) ?? {
          date: step.dateKey,
          label: step.dateLabel,
          items: [] as NormalizedStep[],
        }
      group.items.push(step)
      groups.set(step.dateKey, group)
>>>>>>> origin/director-engine-core
    })
}

function mapAppointmentReminders(
  reminders: AppointmentNotificationRow[],
  appointmentById: Map<string, AppointmentRow>,
  leadId: string,
): LeadTimelineEvent[] {
  return reminders
    .filter((reminder) => {
      const payloadLeadId = (reminder.payload?.lead_id as string | undefined) ?? null
      const appointmentLeadId = reminder.appointment_id
        ? appointmentById.get(reminder.appointment_id)?.lead_id ?? null
        : null
      return payloadLeadId === leadId || appointmentLeadId === leadId
    })
    .map((reminder) => {
      const appointment = reminder.appointment_id
        ? appointmentById.get(reminder.appointment_id)
        : undefined
      const when = reminder.notify_at ?? appointmentTime(appointment ?? ({} as AppointmentRow)) ?? new Date().toISOString()
      const kind = (reminder.payload?.kind as string | undefined) ?? null
      const reminderLabel = describeReminder(kind) ?? "Appointment reminder"
      const appointmentDate = appointmentTime(appointment ?? ({} as AppointmentRow))
      const formatted = formatDateTime(appointmentDate)

      return {
        id: `appointment-reminder-${reminder.id}`,
        occurredAt: when,
        type: "appointment_reminder",
        channel: appointment?.channel ?? null,
        step: null,
        label: reminderLabel,
        description: formatted ? `Reminder for appointment on ${formatted}` : null,
        status: reminder.status,
        meta: { appointmentId: reminder.appointment_id, kind },
      }
    })
}

async function loadLeadData(leadId: string): Promise<LeadDataResult> {
  const supabase = supabaseServer()

  if (!supabase) {
    return {
      lead: {
        id: leadId,
        full_name: "Sin nombre",
        email: null,
        phone: null,
        state: "unknown",
        last_touch_at: null,
        campaign_id: null,
        campaign_name: null,
        channel_last: null,
        company: null,
        notes: null,
      },
      events: [],
      stats: { touches: 0, appointments: 0, reminders: 0 },
    }
  }

  const [leadResult, touchRunsResult, appointmentsResult, remindersResult] = await Promise.all([
    supabase
      .from("lead_enriched")
      .select(
        "id, full_name, email, phone, state, last_touch_at, campaign_id, campaign_name, channel_last, company",
      )
      .eq("id", leadId)
      .maybeSingle(),
    supabase
      .from("touch_runs")
      .select(touchRunSelect)
      .eq("lead_id", leadId)
      .order("scheduled_at", { ascending: false, nullsLast: true } as any)
      .order("created_at", { ascending: false }),
    supabase
      .from("appointments")
      .select(
        "id, lead_id, channel, status, outcome, notes, starts_at, scheduled_for, created_at, updated_at",
      )
      .eq("lead_id", leadId),
    supabase.from("appointments_notifications").select("id, appointment_id, notify_at, status, payload, created_at"),
  ])

  const touchRuns = (touchRunsResult.data ?? []) as TouchRunRow[]
  const appointments = (appointmentsResult.data ?? []) as AppointmentRow[]
  const appointmentById = new Map<string, AppointmentRow>()
  appointments.forEach((row) => appointmentById.set(row.id, row))
  const reminders = (remindersResult.data ?? []) as AppointmentNotificationRow[]

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
    lead: (leadResult.data as LeadDetail | null) ?? null,
    events,
    stats: {
      touches: touchRuns.length,
      appointments: appointments.length,
      reminders: reminders.length,
    },
  }
}

export default async function LeadDetailPage({ params }: { params: { id: string } }) {
  const leadId = params.id
  const { lead, events, stats } = await loadLeadData(leadId)

  const title = deriveLeadTitle(lead)
  const subtitle = deriveLeadSubtitle(lead)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
<<<<<<< HEAD
          <Link href="/leads-inbox">
            <Button variant="outline" size="sm">
              <span className="sr-only">Back to leads</span>
              Back
            </Button>
          </Link>
=======
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/leads")}
          >
            <ArrowLeft size={16} />
            Back
          </Button>
>>>>>>> origin/director-engine-core
          <div>
            <p className="text-sm uppercase tracking-[0.16em] text-white/50">Lead</p>
            <h1 className="text-3xl font-semibold text-white">Lead timeline</h1>
            <p className="text-sm text-white/80">{title}</p>
            <p className="text-xs text-white/60">{subtitle} · ID: {leadId}</p>
          </div>
        </div>
        {lead?.state ? (
          <Badge variant="outline" className="capitalize">
            {lead.state}
          </Badge>
        ) : null}
      </div>

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
              <span>{lead?.company ?? "Sin compañía"}</span>
            </div>
            <div className="flex items-center gap-2 text-white/80">
              <MapPin size={14} className="text-white/50" />
              <span>{lead?.channel_last ?? "Sin canal"}</span>
            </div>
          </div>
          <div className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4 text-white/80">
            <p className="text-sm text-white/60">Last touch</p>
            <p className="text-lg font-semibold text-white">
              {formatDateTime(lead?.last_touch_at ?? null) ?? "No touches yet"}
            </p>
            <p className="text-sm text-white/60">Channel: {lead?.channel_last ?? "—"}</p>
            <p className="text-sm text-white/60">Campaign: {lead?.campaign_name ?? lead?.campaign_id ?? "—"}</p>
          </div>
        </CardContent>
      </Card>

<<<<<<< HEAD
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total activity" value={events.length.toString()} helper="Touches, appointments and reminders" />
        <StatCard label="Touch runs" value={stats.touches.toString()} helper="touch_runs registrados" />
        <StatCard label="Appointments" value={stats.appointments.toString()} helper="Incluye outcomes y reminders" />
      </div>
=======
      {/* Voice & appointments */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.14em] text-white/50">Voice</p>
                <h3 className="text-lg font-semibold text-white">Voice history</h3>
              </div>
              <Badge variant="outline" className="gap-2 text-white/70">
                <Clock4 size={14} /> Last {voiceCalls.length} calls
              </Badge>
            </div>
            {voiceCalls.length === 0 ? (
              <p className="text-sm text-white/60">No voice calls yet.</p>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHead>
                    <tr>
                      <TableHeaderCell>Date</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Intent</TableHeaderCell>
                      <TableHeaderCell>Transcript</TableHeaderCell>
                      <TableHeaderCell>Provider ID</TableHeaderCell>
                    </tr>
                  </TableHead>
                  <TableBody>
                    {voiceCalls.map((call) => {
                      const voiceWebhook =
                        (call.meta as { voice_webhook?: { transcript?: string; intent?: string } } | null)
                          ?.voice_webhook ?? null
                      const transcript = voiceWebhook?.transcript ?? "—"
                      const intent =
                        voiceWebhook?.intent ??
                        (call.meta as { intent?: string } | null)?.intent ??
                        "unknown"
                      return (
                        <TableRow key={call.id}>
                          <TableCell className="whitespace-nowrap text-white/70">
                            {call.updated_at ? new Date(call.updated_at).toLocaleString() : "—"}
                          </TableCell>
                          <TableCell>
                            <Badge variant={statusVariant(call.status)} className="capitalize">
                              {call.status ?? "—"}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <IntentBadge intent={intent} />
                          </TableCell>
                          <TableCell className="max-w-md text-white/80">
                            {transcript ? `${transcript.slice(0, 120)}${transcript.length > 120 ? "…" : ""}` : "—"}
                          </TableCell>
                          <TableCell className="text-white/60 text-sm">{call.provider_call_id ?? "—"}</TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <p className="text-xs uppercase tracking-[0.14em] text-white/50">State</p>
              <h3 className="text-lg font-semibold text-white">State & cadence</h3>
            </div>
            <div className="flex items-center gap-3">
              <LeadStateBadge state={lead?.state} />
              <Badge variant="outline" className="gap-2 text-white/70">
                <Clock4 size={14} /> {lead?.last_touch_at ? new Date(lead.last_touch_at).toLocaleString() : "No touches"}
              </Badge>
            </div>
            {cadenceStopped ? (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                Cadence stopped because an appointment was created.
              </div>
            ) : (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-100">
                Cadence active.
              </div>
            )}
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.14em] text-white/50">Appointments</p>
              {appointments.length === 0 ? (
                <p className="text-sm text-white/60">No appointments yet.</p>
              ) : (
                <div className="space-y-2">
                  {appointments.map((appt) => (
                    <div
                      key={appt.id}
                      className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm text-white/80">
                          {appt.scheduled_for
                            ? new Date(appt.scheduled_for).toLocaleString()
                            : "Unknown"}
                        </p>
                        <p className="text-xs text-white/50">
                          Channel: {appt.channel ?? "—"} · {appt.created_by ?? "—"}
                        </p>
                      </div>
                      <AppointmentStatusBadge status={appt.status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.14em] text-white/50">Events</p>
              <h3 className="text-lg font-semibold text-white">Recent events</h3>
            </div>
            <Badge variant="outline" className="text-white/70">
              Last {leadEvents.length} events
            </Badge>
          </div>
          {leadEvents.length === 0 ? (
            <p className="text-sm text-white/60">No events logged for this lead.</p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Type</TableHeaderCell>
                    <TableHeaderCell>Payload</TableHeaderCell>
                    <TableHeaderCell>When</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {leadEvents.map((event) => (
                    <TableRow key={event.id}>
                      <TableCell className="capitalize text-white">{event.event_type}</TableCell>
                      <TableCell className="max-w-xl text-white/80">
                        <pre className="whitespace-pre-wrap text-xs text-white/60">
                          {JSON.stringify(event.payload ?? {}, null, 2)}
                        </pre>
                      </TableCell>
                      <TableCell className="text-white/60">
                        {new Date(event.created_at).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {loading && !usingMock ? (
        <div className="space-y-3">
          <div className="h-10 animate-pulse rounded-xl bg-white/5" />
          <div className="h-52 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
        </div>
      ) : null}
>>>>>>> origin/director-engine-core

      <LeadActivityTimeline events={events} />
    </div>
  )
}

