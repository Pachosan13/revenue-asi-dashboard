"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Activity, Filter, Loader2, RefreshCcw } from "lucide-react"

import { IntentBadge, LeadStateBadge } from "@/components/leads/badges"
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"
import { supabaseBrowser } from "@/lib/supabase"

type VoiceCall = {
  id: string
  lead_id: string
  touch_run_id: string | null
  status: string | null
  provider: string | null
  provider_call_id: string | null
  to_phone: string | null
  meta: Record<string, unknown> | null
  updated_at: string
}

type Lead = {
  id: string
  contact_name: string | null
  company: string | null
  phone: string | null
  state: string | null
  email: string | null
}

type LeadEvent = {
  id: string
  lead_id: string
  event_type: string
  payload: Record<string, unknown> | null
  created_at: string
}

type Appointment = {
  id: string
  lead_id: string
  scheduled_for: string
  status: string
}

type TouchRun = {
  id: string
  lead_id: string
  status: string
  error: string | null
}

type IntentFilter = "all" | "appointment" | "unknown"
type AppointmentFilter = "all" | "yes" | "no"
type CadenceFilter = "all" | "stopped" | "active"

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

export default function VoiceInsightsPage() {
<<<<<<< HEAD
  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
=======
  const supabaseReady = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
>>>>>>> origin/director-engine-core
  )

  const [calls, setCalls] = useState<VoiceCall[]>([])
  const [leads, setLeads] = useState<Record<string, Lead>>({})
  const [events, setEvents] = useState<LeadEvent[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [touchRuns, setTouchRuns] = useState<TouchRun[]>([])
  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all")
  const [appointmentFilter, setAppointmentFilter] =
    useState<AppointmentFilter>("all")
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>("all")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function loadData() {
      if (!supabaseReady) {
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load data.",
        )
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const client = supabaseBrowser()

<<<<<<< HEAD
      // 🔹 Vista consolidada para llamadas de voz
      const { data: callsData, error: callsError } = await client
=======
      const { data: callsData, error: callsError } = await client
        // use view backed by public.calls to ensure consistent shape
>>>>>>> origin/director-engine-core
        .from("voice_insights_calls_v1")
        .select(
          "id, lead_id, touch_run_id, status, provider, provider_call_id, to_phone, meta, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(100)

      if (!alive) return
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
      if (callsError) {
        console.error(callsError)
        setError("Unable to fetch voice calls.")
        setLoading(false)
        return
      }

      const safeCalls = (callsData ?? []) as VoiceCall[]
      setCalls(safeCalls)

      const leadIds = Array.from(new Set(safeCalls.map((call) => call.lead_id)))

      if (leadIds.length === 0) {
        setLeads({})
        setEvents([])
        setAppointments([])
        setTouchRuns([])
        setLoading(false)
        return
      }

      const [leadsResult, eventsResult, appointmentsResult, touchRunsResult] =
        await Promise.all([
          client
            .from("leads")
            .select("id, contact_name, company, phone, state, email")
            .in("id", leadIds),
          client
            .from("lead_events")
            .select("id, lead_id, event_type, payload, created_at")
            .in("event_type", ["voice_completed", "voice_failed", "appointment_created"])
            .order("created_at", { ascending: false })
            .limit(200),
          client
            .from("appointments")
            .select("id, lead_id, scheduled_for, status")
            .in("lead_id", leadIds),
          client
            .from("touch_runs")
            .select("id, lead_id, status, error")
            .in("lead_id", leadIds),
        ])

      if (!alive) return

      if (leadsResult.error) {
        console.error(leadsResult.error)
        setError(
          `Unable to fetch leads for voice calls. DB says: ${leadsResult.error.message}`,
        )
      }

      if (eventsResult.error) {
        console.error(eventsResult.error)
      }

      if (appointmentsResult.error) {
        console.error(appointmentsResult.error)
      }

      if (touchRunsResult.error) {
        console.error(touchRunsResult.error)
      }

<<<<<<< HEAD
      const leadMap = (leadsResult.data ?? []).reduce(
        (acc, lead) => {
          acc[lead.id] = lead as Lead
          return acc
        },
        {} as Record<string, Lead>,
      )
=======
      const leadMap = (leadsResult.data ?? []).reduce((acc, lead) => {
        acc[lead.id] = lead as Lead
        return acc
      }, {} as Record<string, Lead>)
>>>>>>> origin/director-engine-core

      setLeads(leadMap)
      setEvents((eventsResult.data ?? []) as LeadEvent[])
      setAppointments((appointmentsResult.data ?? []) as Appointment[])
      setTouchRuns((touchRunsResult.data ?? []) as TouchRun[])
      setLoading(false)
    }

<<<<<<< HEAD
    void loadData()
=======
    loadData()
>>>>>>> origin/director-engine-core

    return () => {
      alive = false
    }
  }, [supabaseReady])

  const appointmentByLead = useMemo(() => {
    const now = new Date()
<<<<<<< HEAD
    return appointments.reduce(
      (acc, appt) => {
        if (appt.status === "scheduled" && new Date(appt.scheduled_for) >= now) {
          acc[appt.lead_id] = appt
        }
        return acc
      },
      {} as Record<string, Appointment>,
    )
=======
    return appointments.reduce((acc, appt) => {
      if (appt.status === "scheduled" && new Date(appt.scheduled_for) >= now) {
        acc[appt.lead_id] = appt
      }
      return acc
    }, {} as Record<string, Appointment>)
>>>>>>> origin/director-engine-core
  }, [appointments])

  const cadenceStoppedByLead = useMemo(() => {
    const map: Record<string, boolean> = {}
    touchRuns.forEach((run) => {
      if (run.status === "stopped" && run.error === "appointment_created") {
        map[run.lead_id] = true
      }
    })
    return map
  }, [touchRuns])

  const callRows = useMemo(() => {
    return calls.map((call) => {
      const voiceWebhook =
        (call.meta as { voice_webhook?: { transcript?: string } } | null)
          ?.voice_webhook ?? null
      const transcript = voiceWebhook?.transcript
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
      const relevantEvent = events.find(
        (event) =>
          event.lead_id === call.lead_id &&
          event.event_type.startsWith("voice_"),
      )
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
      const intent =
        (relevantEvent?.payload as { intent?: string } | null)?.intent ??
        (call.meta as { intent?: string } | null)?.intent

      return {
        ...call,
        transcript,
        intent: intent ?? "unknown",
        hasAppointment: Boolean(appointmentByLead[call.lead_id]),
        cadenceStopped: Boolean(cadenceStoppedByLead[call.lead_id]),
      }
    })
  }, [appointmentByLead, cadenceStoppedByLead, calls, events])

  const filtered = useMemo(() => {
    return callRows.filter((row) => {
      if (intentFilter !== "all" && row.intent !== intentFilter) return false
      if (appointmentFilter === "yes" && !row.hasAppointment) return false
      if (appointmentFilter === "no" && row.hasAppointment) return false
      if (cadenceFilter === "stopped" && !row.cadenceStopped) return false
      if (cadenceFilter === "active" && row.cadenceStopped) return false
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
      if (search) {
        const lead = leads[row.lead_id]
        const haystack = `${lead?.contact_name ?? ""} ${lead?.company ?? ""} ${
          lead?.email ?? ""
        } ${lead?.phone ?? ""}`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
      return true
    })
  }, [appointmentFilter, callRows, cadenceFilter, intentFilter, leads, search])

  return (
    <div className="space-y-6">
<<<<<<< HEAD
      {/* Header */}
=======
>>>>>>> origin/director-engine-core
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-white/50">
            Voice
          </p>
          <h1 className="text-3xl font-semibold text-white">
            Voice & intents monitor
          </h1>
          <p className="text-white/60">
<<<<<<< HEAD
            Latest 100 voice calls with transcript previews, intent signals, and appointment status.
=======
            Latest 100 voice calls with transcript previews, intent signals,
            and appointment status.
>>>>>>> origin/director-engine-core
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIntentFilter("all")
              setAppointmentFilter("all")
              setCadenceFilter("all")
              setSearch("")
            }}
          >
            <RefreshCcw size={16} /> Reset filters
          </Button>
        </div>
      </div>

<<<<<<< HEAD
      {/* Filters + search */}
=======
>>>>>>> origin/director-engine-core
      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
              <Filter size={16} />
              <span>Filters</span>
            </div>
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
            <Select
              value={intentFilter}
              onChange={(e) => setIntentFilter(e.target.value as IntentFilter)}
              className="w-48"
            >
              <option value="all">All intents</option>
              <option value="appointment">Appointment</option>
              <option value="unknown">Unknown</option>
            </Select>
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
            <Select
              value={appointmentFilter}
              onChange={(e) =>
                setAppointmentFilter(e.target.value as AppointmentFilter)
              }
              className="w-48"
            >
              <option value="all">Appointment?</option>
              <option value="yes">Has upcoming</option>
              <option value="no">No appointment</option>
            </Select>
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
            <Select
              value={cadenceFilter}
              onChange={(e) =>
                setCadenceFilter(e.target.value as CadenceFilter)
              }
              className="w-48"
            >
              <option value="all">Cadence</option>
              <option value="stopped">Stopped</option>
              <option value="active">Active</option>
            </Select>
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
            <Input
              placeholder="Search lead/company/email/phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-64"
            />
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-100">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-white/60">
<<<<<<< HEAD
              <Loader2 className="h-4 w-4 animate-spin" /> Loading voice calls...
=======
              <Loader2 className="h-4 w-4 animate-spin" /> Loading voice
              calls...
>>>>>>> origin/director-engine-core
            </div>
          ) : null}

          {!loading && filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-white/70">
              No calls match the selected filters.
            </div>
          ) : null}

          {!loading && filtered.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Lead</TableHeaderCell>
                    <TableHeaderCell>Phone</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Transcript</TableHeaderCell>
                    <TableHeaderCell>Intent</TableHeaderCell>
                    <TableHeaderCell>Appointment</TableHeaderCell>
                    <TableHeaderCell>Cadence</TableHeaderCell>
                    <TableHeaderCell>Updated</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {filtered.map((row) => {
                    const lead = leads[row.lead_id]
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
                    const voiceWebhook =
                      (row.meta as {
                        voice_webhook?: { transcript?: string }
                      } | null)?.voice_webhook ?? null
                    const transcriptPreview =
<<<<<<< HEAD
                      (row as any).transcript ?? voiceWebhook?.transcript ?? ""

=======
                      (row as any).transcript ??
                      voiceWebhook?.transcript ??
                      ""
>>>>>>> origin/director-engine-core
                    const preview = transcriptPreview
                      ? `${transcriptPreview.slice(0, 140)}${
                          transcriptPreview.length > 140 ? "…" : ""
                        }`
                      : "—"
<<<<<<< HEAD

=======
>>>>>>> origin/director-engine-core
                    const updated = new Date(row.updated_at)
                    const appointment = appointmentByLead[row.lead_id]

                    const displayName =
                      lead?.contact_name ||
                      lead?.company ||
                      lead?.phone ||
                      lead?.email ||
                      "Unknown lead"

                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <a
                              href={`/leads/${row.lead_id}`}
                              className="font-semibold text-emerald-200 hover:text-emerald-100"
                            >
                              {displayName}
                            </a>
                            <LeadStateBadge state={lead?.state} />
                          </div>
                        </TableCell>
                        <TableCell className="text-white/80">
                          {lead?.phone ?? row.to_phone ?? "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">
                            {row.status ?? "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-md text-white/80">
                          {preview}
                        </TableCell>
                        <TableCell>
                          <IntentBadge intent={(row as any).intent} />
                        </TableCell>
                        <TableCell>
                          {(row as any).hasAppointment ? (
                            <Badge
                              variant="outline"
                              className="gap-2 border-emerald-400/50 text-emerald-100"
                            >
                              <CalendarIcon />
                              Upcoming
                              <span className="text-xs text-white/60">
                                {appointment
                                  ? dateFormatter.format(
                                      new Date(appointment.scheduled_for),
                                    )
                                  : null}
                              </span>
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="text-white/70"
                            >
                              No appointment
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {(row as any).cadenceStopped ? (
                            <Badge
                              variant="outline"
                              className="border-amber-400/60 text-amber-100"
                            >
                              Cadence stopped
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="border-emerald-400/60 text-emerald-100"
                            >
                              Active
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-white/70">
                          {dateFormatter.format(updated)}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function CalendarIcon() {
  return <Activity size={14} />
}
