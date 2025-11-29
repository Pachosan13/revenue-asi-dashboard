"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  Clock4,
  Mail,
  PhoneCall,
  ServerCrash,
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"

import {
  channelLabel,
  fetchLeadTouchRuns,
  formatPreview,
  getWhen,
  statusVariant,
  type TouchRunRow,
} from "@/components/leads/timeline-utils"
import {
  AppointmentStatusBadge,
  IntentBadge,
  LeadStateBadge,
} from "@/components/leads/badges"
import { supabaseBrowser } from "@/lib/supabase"
import {
  Badge,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"
import { StatCard } from "@/components/ui-custom/stat-card"

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
})
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

type LeadRecord = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  state: string | null
  last_touch_at: string | null
  channel_last: string | null
}

type NormalizedStep = TouchRunRow & {
  when: string | null
  dateKey: string
  dateLabel: string
  timeLabel: string
  preview: string
}

function normalizeSteps(steps: TouchRunRow[]): NormalizedStep[] {
  return steps
    .map((step) => {
      const when = getWhen(step)
      const whenDate = when ? new Date(when) : null
      const valid = whenDate && !Number.isNaN(whenDate.getTime())

      const dateKey = valid ? whenDate!.toISOString().slice(0, 10) : "unknown"

      return {
        ...step,
        when,
        dateKey,
        dateLabel: valid
          ? dateFormatter.format(whenDate!)
          : "Fecha desconocida",
        timeLabel: valid ? timeFormatter.format(whenDate!) : "—",
        preview: formatPreview(step.payload),
      }
    })
    .sort((a, b) => {
      const aDate = new Date(a.when ?? 0).getTime()
      const bDate = new Date(b.when ?? 0).getTime()
      return bDate - aDate
    })
}

function channelBadgeVariant(channel: string | null) {
  const normalized = channel?.toLowerCase()
  if (normalized === "email") return "info" as const
  if (normalized === "voice") return "warning" as const
  if (normalized === "sms" || normalized === "whatsapp") return "success" as const
  return "neutral" as const
}

function channelIcon(channel?: string | null) {
  if (channel === "voice") return <PhoneCall size={16} />
  if (channel === "email") return <Mail size={16} />
  return <Clock4 size={16} />
}

function deriveLeadTitle(lead: LeadRecord | null) {
  if (!lead) return "Sin nombre"
  return lead.full_name || lead.email || lead.phone || "Sin nombre"
}

function deriveLeadSubtitle(lead: LeadRecord | null) {
  if (!lead) return "Sin contacto"
  const email = lead.email ?? "Sin email"
  const phone = lead.phone ?? "Sin teléfono"
  return `${email} · ${phone}`
}

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
    }

    loadLead()

    return () => {
      alive = false
    }
  }, [leadId, supabaseReady])

  const totalSteps = steps.length
  const sentSteps = steps.filter(
    (step) => step.status?.toLowerCase() === "sent",
  ).length
  const errorSteps = steps.filter((step) => {
    const normalized = step.status?.toLowerCase()
    return normalized === "failed" || normalized === "error"
  }).length

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
    })

    return Array.from(groups.values()).sort((a, b) =>
      a.date > b.date ? -1 : 1,
    )
  }, [steps])

  const title = deriveLeadTitle(lead)
  const subtitle = deriveLeadSubtitle(lead)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/leads-inbox")}
          >
            <ArrowLeft size={16} />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-white">
                Lead timeline
              </h1>
              <Badge variant="neutral">Detalle</Badge>
              {usingMock ? <Badge variant="warning">Mock</Badge> : null}
            </div>
            <p className="text-sm text-white/80">{title}</p>
            <p className="text-xs text-white/60">
              {subtitle} · ID: {leadId}
            </p>
          </div>
        </div>
        {lead?.state ? (
          <Badge variant={statusVariant(lead.state)} className="capitalize">
            {lead.state}
          </Badge>
        ) : null}
      </div>

      {/* Error banner solo en error real */}
      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">
              Revisa la configuración de touch_runs o vuelve a intentar más
              tarde.
            </p>
          </div>
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total steps"
          value={totalSteps.toString()}
          helper="Pasos registrados en touch_runs"
        />
        <StatCard
          label="Sent"
          value={sentSteps.toString()}
          helper="Pasos marcados como sent"
        />
        <StatCard
          label="Errores"
          value={errorSteps.toString()}
          helper="failed o error"
        />
      </div>

      {/* Last touch card */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-white/70">
              Last touch:{" "}
              {lead?.last_touch_at
                ? new Date(lead.last_touch_at).toLocaleString()
                : "No touches yet"}
            </p>
            <p className="text-xs text-white/50">
              Último canal: {lead?.channel_last ?? "—"}
            </p>
            <p className="text-xs text-white/50">
              Email: {lead?.email ?? "—"} · Phone: {lead?.phone ?? "—"}
            </p>
          </div>
          <Badge variant="outline" className="capitalize">
            {lead?.state ?? "Sin estado"}
          </Badge>
        </CardContent>
      </Card>

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

      {/* Empty state */}
      {!loading && steps.length === 0 ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-lg font-semibold text-white">No steps yet</p>
            <p className="text-sm text-white/70">
              No steps yet. Lanza una campaña para que el motor genere toques
              para este lead.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {/* Timeline */}
      {!loading && steps.length > 0 ? (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.date} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {group.label} — {group.items.length} touches
                </h3>
              </div>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Hora</TableHeaderCell>
                    <TableHeaderCell>Paso</TableHeaderCell>
                    <TableHeaderCell>Canal</TableHeaderCell>
                    <TableHeaderCell>Estado</TableHeaderCell>
                    <TableHeaderCell>Preview</TableHeaderCell>
                    <TableHeaderCell>Error</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {group.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-white/70">
                        {item.timeLabel}
                      </TableCell>
                      <TableCell className="text-white">
                        #{item.step ?? "—"}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-white">
                          <span className="rounded-full bg-white/5 p-2 text-emerald-300">
                            {channelIcon(item.channel)}
                          </span>
                          <Badge
                            variant={channelBadgeVariant(item.channel)}
                            className="capitalize"
                          >
                            {channelLabel[item.channel ?? ""] ?? "Canal"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={statusVariant(item.status)}
                          className="capitalize"
                        >
                          {item.status ?? "Sin estado"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-white/80">
                        {item.preview}
                      </TableCell>
                      <TableCell className="text-sm text-red-200">
                        {item.error ? (
                          <span className="flex items-center gap-2">
                            <ServerCrash size={16} />
                            {item.error}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
