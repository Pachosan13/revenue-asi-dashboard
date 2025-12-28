"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  Activity,
  Filter,
  Loader2,
  RefreshCcw,
  X,
  PhoneCall,
} from "lucide-react"

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

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type VoiceCallBase = {
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
  campaign_id: string | null
}

type CampaignMeta = {
  id: string
  name: string | null
}

type IntentFilter = "all" | "appointment" | "unknown"
type AppointmentFilter = "all" | "yes" | "no"
type CadenceFilter = "all" | "stopped" | "active"

type VoiceCallRow = VoiceCallBase & {
  transcript: string
  intent: string
  hasAppointment: boolean
  cadenceStopped: boolean
  campaign_id: string | null
  campaign_name: string | null
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export default function VoiceInsightsPage() {
  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  )

  const [calls, setCalls] = useState<VoiceCallBase[]>([])
  const [leads, setLeads] = useState<Record<string, Lead>>({})
  const [events, setEvents] = useState<LeadEvent[]>([])
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [touchRuns, setTouchRuns] = useState<TouchRun[]>([])
  const [campaigns, setCampaigns] = useState<Record<string, CampaignMeta>>({})

  const [intentFilter, setIntentFilter] = useState<IntentFilter>("all")
  const [appointmentFilter, setAppointmentFilter] =
    useState<AppointmentFilter>("all")
  const [cadenceFilter, setCadenceFilter] = useState<CadenceFilter>("all")
  const [campaignFilter, setCampaignFilter] = useState<string>("all")

  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [activeCallId, setActiveCallId] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

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

      const { data: callsData, error: callsError } = await client
        .from("voice_insights_calls_v1")
        .select(
          "id, lead_id, touch_run_id, status, provider, provider_call_id, to_phone, meta, updated_at",
        )
        .order("updated_at", { ascending: false })
        .limit(100)

      if (!alive) return

      if (callsError) {
        console.error(callsError)
        setError("Unable to fetch voice calls.")
        setLoading(false)
        return
      }

      const safeCalls = (callsData ?? []) as VoiceCallBase[]
      setCalls(safeCalls)

      const leadIds = Array.from(new Set(safeCalls.map((call) => call.lead_id)))

      if (leadIds.length === 0) {
        setLeads({})
        setEvents([])
        setAppointments([])
        setTouchRuns([])
        setCampaigns({})
        setLoading(false)
        return
      }

      const [
        leadsResult,
        eventsResult,
        appointmentsResult,
        touchRunsResult,
        campaignsResult,
      ] = await Promise.all([
        client
          .from("leads")
          .select("id, contact_name, company, phone, state, email")
          .in("id", leadIds),
        client
          .from("lead_events")
          .select("id, lead_id, event_type, payload, created_at")
          .in("event_type", [
            "voice_completed",
            "voice_failed",
            "appointment_created",
          ])
          .order("created_at", { ascending: false })
          .limit(200),
        client
          .from("appointments")
          .select("id, lead_id, scheduled_for, status")
          .in("lead_id", leadIds),
        client
          .from("touch_runs")
          .select("id, lead_id, status, error, campaign_id")
          .in("lead_id", leadIds),
        client.from("campaigns").select("id, name").limit(500),
      ])

      if (!alive) return

      if (leadsResult.error) {
        console.error(leadsResult.error)
        setError(
          `Unable to fetch leads for voice calls. DB says: ${leadsResult.error.message}`,
        )
      }

      if (eventsResult.error) console.error(eventsResult.error)
      if (appointmentsResult.error) console.error(appointmentsResult.error)
      if (touchRunsResult.error) console.error(touchRunsResult.error)
      if (campaignsResult.error) console.error(campaignsResult.error)

      const leadMap = (leadsResult.data ?? []).reduce(
        (acc, lead) => {
          acc[lead.id] = lead as Lead
          return acc
        },
        {} as Record<string, Lead>,
      )

      const campaignMap = (campaignsResult.data ?? []).reduce(
        (acc, c) => {
          acc[c.id] = c as CampaignMeta
          return acc
        },
        {} as Record<string, CampaignMeta>,
      )

      setLeads(leadMap)
      setEvents((eventsResult.data ?? []) as LeadEvent[])
      setAppointments((appointmentsResult.data ?? []) as Appointment[])
      setTouchRuns((touchRunsResult.data ?? []) as TouchRun[])
      setCampaigns(campaignMap)
      setLoading(false)
    }

    void loadData()

    return () => {
      alive = false
    }
  }, [supabaseReady])

  // ---------------------------------------------------------------------------
  // Derived maps
  // ---------------------------------------------------------------------------

  const appointmentByLead = useMemo(() => {
    const now = new Date()
    return appointments.reduce(
      (acc, appt) => {
        if (appt.status === "scheduled" && new Date(appt.scheduled_for) >= now) {
          acc[appt.lead_id] = appt
        }
        return acc
      },
      {} as Record<string, Appointment>,
    )
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

  const campaignByLead = useMemo(() => {
    const map: Record<string, string | null> = {}
    touchRuns.forEach((run) => {
      if (run.campaign_id && !map[run.lead_id]) {
        map[run.lead_id] = run.campaign_id
      }
    })
    return map
  }, [touchRuns])

  const callRows: VoiceCallRow[] = useMemo(() => {
    return calls.map((call) => {
      const voiceWebhook =
        (call.meta as { voice_webhook?: { transcript?: string } } | null)
          ?.voice_webhook ?? null
      const transcript =
        voiceWebhook?.transcript ??
        ((call.meta as { transcript?: string } | null)?.transcript ?? "")

      const relevantEvent = events.find(
        (event) =>
          event.lead_id === call.lead_id &&
          event.event_type.startsWith("voice_"),
      )

      const intentFromEvent =
        (relevantEvent?.payload as { intent?: string } | null)?.intent
      const intentFromMeta =
        (call.meta as { intent?: string } | null)?.intent ?? "unknown"

      const intent = (intentFromEvent ?? intentFromMeta ?? "unknown").toLowerCase()

      const campaignId = campaignByLead[call.lead_id] ?? null
      const campaignName =
        campaignId && campaigns[campaignId]
          ? campaigns[campaignId].name ?? "Untitled"
          : null

      return {
        ...call,
        transcript,
        intent,
        hasAppointment: Boolean(appointmentByLead[call.lead_id]),
        cadenceStopped: Boolean(cadenceStoppedByLead[call.lead_id]),
        campaign_id: campaignId,
        campaign_name: campaignName,
      }
    })
  }, [
    appointmentByLead,
    cadenceStoppedByLead,
    campaignByLead,
    campaigns,
    calls,
    events,
  ])

  const campaignOptions = useMemo(() => {
    const ids = new Set<string>()
    callRows.forEach((row) => {
      if (row.campaign_id) ids.add(row.campaign_id)
    })
    return Array.from(ids)
  }, [callRows])

  const filtered: VoiceCallRow[] = useMemo(() => {
    return callRows.filter((row) => {
      if (intentFilter !== "all" && row.intent !== intentFilter) return false
      if (appointmentFilter === "yes" && !row.hasAppointment) return false
      if (appointmentFilter === "no" && row.hasAppointment) return false
      if (cadenceFilter === "stopped" && !row.cadenceStopped) return false
      if (cadenceFilter === "active" && row.cadenceStopped) return false
      if (campaignFilter !== "all" && row.campaign_id !== campaignFilter)
        return false

      if (search) {
        const lead = leads[row.lead_id]
        const haystack = `${lead?.contact_name ?? ""} ${lead?.company ?? ""} ${
          lead?.email ?? ""
        } ${lead?.phone ?? ""}`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }

      return true
    })
  }, [
    appointmentFilter,
    campaignFilter,
    callRows,
    cadenceFilter,
    intentFilter,
    leads,
    search,
  ])

  const activeCall = useMemo(
    () => filtered.find((c) => c.id === activeCallId) ?? null,
    [filtered, activeCallId],
  )

  const activeLead = activeCall ? leads[activeCall.lead_id] ?? null : null
  const activeAppointment = activeCall
    ? appointmentByLead[activeCall.lead_id] ?? null
    : null

  // ---------------------------------------------------------------------------
  // High-level metrics
  // ---------------------------------------------------------------------------

  const metrics = useMemo(() => {
    if (callRows.length === 0) {
      return {
        total: 0,
        withAppointment: 0,
        interested: 0,
        failed: 0,
        last7d: 0,
      }
    }

    const now = Date.now()
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000

    let withAppointment = 0
    let interested = 0
    let failed = 0
    let last7d = 0

    callRows.forEach((row) => {
      if (row.hasAppointment) withAppointment += 1
      if (row.intent === "appointment") interested += 1
      if (row.status && row.status.toLowerCase() === "failed") failed += 1

      const updatedMs = new Date(row.updated_at).getTime()
      if (!Number.isNaN(updatedMs) && now - updatedMs <= sevenDaysMs) {
        last7d += 1
      }
    })

    return {
      total: callRows.length,
      withAppointment,
      interested,
      failed,
      last7d,
    }
  }, [callRows])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.16em] text-white/40">
              Voice · Calls & intents
            </p>
            <h1 className="text-3xl font-semibold text-white">
              Voice Insights
            </h1>
            <p className="text-sm text-white/60">
              Latest 100 calls with transcript previews, intent signals,
              campaign and appointment status.
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
                setCampaignFilter("all")
                setSearch("")
              }}
              className="gap-2"
            >
              <RefreshCcw size={16} />
              Reset view
            </Button>
          </div>
        </div>

        {/* KPIs */}
        <Card className="border-white/10 bg-black/40 backdrop-blur-sm">
          <CardContent className="grid gap-4 p-4 sm:grid-cols-5">
            <MetricTile
              label="Total calls"
              value={metrics.total}
              helper="Last 100 records"
            />
            <MetricTile
              label="Interested"
              value={metrics.interested}
              helper="Intent = appointment"
            />
            <MetricTile
              label="With appointment"
              value={metrics.withAppointment}
              helper="Upcoming scheduled"
            />
            <MetricTile
              label="Failed"
              value={metrics.failed}
              helper="Status = failed"
            />
            <MetricTile
              label="Calls last 7 days"
              value={metrics.last7d}
              helper="Based on updated_at"
            />
          </CardContent>
        </Card>

        {/* Filters + search + status */}
        <Card className="border-white/10 bg-black/40 backdrop-blur-sm">
          <CardContent className="space-y-4 pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium uppercase tracking-[0.14em] text-white/70">
                <Filter size={14} />
                <span>Filters</span>
              </div>

              <Select
                value={intentFilter}
                onChange={(e) =>
                  setIntentFilter(e.target.value as IntentFilter)
                }
                className="w-44"
              >
                <option value="all">All intents</option>
                <option value="appointment">Appointment</option>
                <option value="unknown">Unknown</option>
              </Select>

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

              <Select
                value={cadenceFilter}
                onChange={(e) =>
                  setCadenceFilter(e.target.value as CadenceFilter)
                }
                className="w-40"
              >
                <option value="all">Cadence</option>
                <option value="stopped">Stopped</option>
                <option value="active">Active</option>
              </Select>

              <Select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="w-56"
              >
                <option value="all">All campaigns</option>
                {campaignOptions.map((id) => (
                  <option key={id} value={id}>
                    {campaigns[id]?.name ?? id}
                  </option>
                ))}
              </Select>

              <Input
                placeholder="Search lead / company / email / phone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-72"
              />
            </div>

            {error ? (
              <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
                {error}
              </div>
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 text-sm text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading voice calls…
              </div>
            ) : (
              <div className="flex items-center gap-3 text-xs text-white/50">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {filtered.length} calls visible
                </span>
                <span className="rounded-full border border-white/5 bg-white/5/10 px-2 py-1">
                  Raw: {calls.length}
                </span>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Table / list */}
        <Card className="border-white/10 bg-black/40 backdrop-blur-sm">
          <CardContent className="pt-4">
            {!loading && filtered.length === 0 ? (
              <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
                No calls match the selected filters.
              </div>
            ) : null}

            {!loading && filtered.length > 0 ? (
              <div className="overflow-auto rounded-2xl border border-white/10">
                <Table>
                  <TableHead>
                    <TableRow className="bg-white/5">
                      <TableHeaderCell>Lead</TableHeaderCell>
                      <TableHeaderCell>Campaign</TableHeaderCell>
                      <TableHeaderCell>Phone</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Transcript</TableHeaderCell>
                      <TableHeaderCell>Intent</TableHeaderCell>
                      <TableHeaderCell>Appointment</TableHeaderCell>
                      <TableHeaderCell>Cadence</TableHeaderCell>
                      <TableHeaderCell>Updated</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {filtered.map((row) => {
                      const lead = leads[row.lead_id]
                      const transcriptPreview = row.transcript

                      const preview = transcriptPreview
                        ? `${transcriptPreview.slice(0, 140)}${
                            transcriptPreview.length > 140 ? "…" : ""
                          }`
                        : "—"

                      const updated = new Date(row.updated_at)
                      const appointment = appointmentByLead[row.lead_id]

                      const displayName =
                        lead?.contact_name ||
                        lead?.company ||
                        lead?.phone ||
                        lead?.email ||
                        "Unknown lead"

                      const campaignName = row.campaign_name ?? "—"

                      return (
                        <TableRow
                          key={row.id}
                          className="cursor-pointer border-t border-white/5 bg-black/40 transition hover:bg-white/5"
                          onClick={() => setActiveCallId(row.id)}
                        >
                          {/* Lead */}
                          <TableCell>
                            <div className="flex flex-col gap-1">
                              <a
                                href={`/leads/${row.lead_id}`}
                                className="font-semibold text-emerald-200 hover:text-emerald-100"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {displayName}
                              </a>
                              <LeadStateBadge state={lead?.state} />
                            </div>
                          </TableCell>

                          {/* Campaign */}
                          <TableCell className="text-sm text-white/80">
                            {campaignName}
                          </TableCell>

                          {/* Phone */}
                          <TableCell className="text-sm text-white/80">
                            {lead?.phone ?? row.to_phone ?? "—"}
                          </TableCell>

                          {/* Call status */}
                          <TableCell>
                            <Badge
                              variant="outline"
                              className="border-white/15 bg-white/5 text-xs text-white/80 capitalize"
                            >
                              {row.status ?? "—"}
                            </Badge>
                          </TableCell>

                          {/* Transcript */}
                          <TableCell className="max-w-md text-sm text-white/80">
                            {preview}
                          </TableCell>

                          {/* Intent */}
                          <TableCell>
                            <IntentBadge intent={row.intent} />
                          </TableCell>

                          {/* Appointment */}
                          <TableCell>
                            {row.hasAppointment ? (
                              <Badge
                                variant="outline"
                                className="gap-2 border-emerald-400/50 bg-emerald-500/10 text-xs text-emerald-100"
                              >
                                <CalendarIcon />
                                Upcoming
                                <span className="text-[11px] text-white/60">
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
                                className="border-white/15 bg-white/5 text-xs text-white/70"
                              >
                                No appointment
                              </Badge>
                            )}
                          </TableCell>

                          {/* Cadence */}
                          <TableCell>
                            {row.cadenceStopped ? (
                              <Badge
                                variant="outline"
                                className="border-amber-400/60 bg-amber-500/10 text-xs text-amber-100"
                              >
                                Cadence stopped
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="border-emerald-400/60 bg-emerald-500/10 text-xs text-emerald-100"
                              >
                                Active
                              </Badge>
                            )}
                          </TableCell>

                          {/* Updated */}
                          <TableCell className="whitespace-nowrap text-sm text-white/70">
                            {dateFormatter.format(updated)}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}

            {loading ? (
              <div className="flex items-center gap-2 py-8 text-sm text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading voice calls…
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {/* Drawer */}
      {activeCall && (
        <div className="fixed inset-0 z-40 flex">
          <button
            className="h-full flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setActiveCallId(null)}
            aria-label="Close call details"
          />
          <div className="h-full w-full max-w-md border-l border-white/10 bg-[#020617] p-5 shadow-[0_0_60px_rgba(15,23,42,0.9)]">
            <div className="mb-4 flex items-center justify-between">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.16em] text-white/50">
                  Voice call
                </p>
                <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
                  <PhoneCall className="h-4 w-4 text-emerald-300" />
                  {activeLead?.contact_name ??
                    activeLead?.company ??
                    activeLead?.phone ??
                    activeLead?.email ??
                    "Unknown lead"}
                </h2>
                {activeLead && (
                  <p className="text-xs text-white/50">
                    {activeLead.email ?? "no-email"} ·{" "}
                    {activeLead.phone ?? "no-phone"}
                  </p>
                )}
              </div>
              <button
                className="rounded-full border border-white/20 bg-white/10 p-1 text-white/70 hover:bg-white/20"
                onClick={() => setActiveCallId(null)}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Top badges */}
              <div className="flex flex-wrap gap-2">
                <Badge className="border-white/20 bg-white/10 text-xs text-white/80">
                  {activeCall.provider ?? "provider-unknown"}
                </Badge>
                <Badge className="border-white/20 bg-white/10 text-xs text-white/80 capitalize">
                  {activeCall.status ?? "status-unknown"}
                </Badge>
                <IntentBadge intent={activeCall.intent} />
                {activeCall.hasAppointment && (
                  <Badge className="border-emerald-400/60 bg-emerald-500/15 text-xs text-emerald-100">
                    Appointment scheduled
                  </Badge>
                )}
                {activeCall.cadenceStopped && (
                  <Badge className="border-amber-400/60 bg-amber-500/15 text-xs text-amber-100">
                    Cadence stopped
                  </Badge>
                )}
              </div>

              {/* Meta */}
              <Card className="border-white/10 bg-white/5">
                <CardContent className="space-y-1 p-4 text-xs text-white/70">
                  <div className="flex justify-between">
                    <span className="text-white/50">To</span>
                    <span>{activeCall.to_phone ?? "—"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-white/50">Updated</span>
                    <span>
                      {dateFormatter.format(new Date(activeCall.updated_at))}
                    </span>
                  </div>
                  {activeAppointment && (
                    <div className="flex justify-between">
                      <span className="text-white/50">Appointment</span>
                      <span>
                        {dateFormatter.format(
                          new Date(activeAppointment.scheduled_for),
                        )}
                      </span>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Transcript */}
              <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/80 p-4">
                <p className="text-xs uppercase tracking-[0.16em] text-white/50">
                  Transcript
                </p>
                {activeCall.transcript ? (
                  <p className="max-h-64 overflow-y-auto whitespace-pre-wrap text-sm text-white/80">
                    {activeCall.transcript}
                  </p>
                ) : (
                  <p className="text-xs text-white/60">
                    No transcript available for this call.
                  </p>
                )}
              </div>

              {/* Raw meta */}
              {activeCall.meta && (
                <div className="space-y-2 rounded-2xl border border-white/10 bg-black/60 p-4">
                  <p className="text-xs uppercase tracking-[0.16em] text-white/50">
                    Raw meta
                  </p>
                  <pre className="max-h-40 overflow-y-auto text-[11px] text-white/70">
                    {JSON.stringify(activeCall.meta, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function CalendarIcon() {
  return <Activity size={14} />
}

function MetricTile({
  label,
  value,
  helper,
}: {
  label: string
  value: number
  helper: string
}) {
  return (
    <div className="space-y-1 rounded-2xl border border-white/10 bg-white/5 p-3">
      <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">
        {label}
      </p>
      <p className="text-2xl font-semibold text-white">{value}</p>
      <p className="text-[11px] text-white/50">{helper}</p>
    </div>
  )
}
