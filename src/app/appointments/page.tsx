"use client"

import React, { useEffect, useState } from "react"
import { CalendarDays, Filter, Loader2, RefreshCcw } from "lucide-react"

import {
  AppointmentStatusBadge,
  ChannelBadge,
  LeadStateBadge,
} from "@/components/leads/badges"
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

type Appointment = {
  id: string
  lead_id: string
  channel: string | null
  scheduled_for: string
  status: string
  created_by: string | null
  notes: string | null
  created_at: string
}

type Lead = {
  id: string
  contact_name: string | null
  company: string | null
  phone: string | null
  state: string | null
  email: string | null
}

const formatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

type DateFilter = "all" | "upcoming" | "today" | "past7"

export default function AppointmentsPage() {
  const supabaseReady = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  )

  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [leads, setLeads] = useState<Record<string, Lead>>({})
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [dateFilter, setDateFilter] = useState<DateFilter>("upcoming")
  const [search, setSearch] = useState("")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function loadAppointments() {
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

      const { data: appointmentsData, error: appointmentsError } = await client
        .from("appointments")
        .select(
          "id, lead_id, channel, scheduled_for, status, created_by, notes, created_at",
        )
        .order("scheduled_for", { ascending: false })
        .limit(100)

      if (!alive) return

      if (appointmentsError) {
        console.error(appointmentsError)
        setError("Unable to fetch appointments. Please try again later.")
        setLoading(false)
        return
      }

      const safeAppointments = (appointmentsData ?? []) as Appointment[]
      setAppointments(safeAppointments)

      const leadIds = Array.from(new Set(safeAppointments.map((a) => a.lead_id)))
      if (leadIds.length === 0) {
        setLeads({})
        setLoading(false)
        return
      }

      const { data: leadsData, error: leadsError } = await client
        .from("leads")
        .select("id, contact_name, company, phone, state, email")
        .in("id", leadIds)

      if (!alive) return

      if (leadsError) {
        console.error(leadsError)
        setError(
          `Unable to fetch related leads. DB says: ${leadsError.message}`,
        )
      }

      const leadMap = (leadsData ?? []).reduce((acc, lead) => {
        acc[lead.id] = lead as Lead
        return acc
      }, {} as Record<string, Lead>)

      setLeads(leadMap)
      setLoading(false)
    }

    loadAppointments()

    return () => {
      alive = false
    }
  }, [supabaseReady])

  const filtered = (() => {
    const now = new Date()
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)

    const sevenDaysAgo = new Date(now)
    sevenDaysAgo.setDate(now.getDate() - 7)

    return appointments.filter((appt) => {
      if (statusFilter !== "all" && appt.status !== statusFilter) return false

      const scheduledDate = new Date(appt.scheduled_for)

      if (dateFilter === "upcoming" && scheduledDate < now) return false
      if (
        dateFilter === "today" &&
        (scheduledDate < startOfToday ||
          scheduledDate > new Date(startOfToday.getTime() + 86400000))
      )
        return false
      if (dateFilter === "past7" && scheduledDate < sevenDaysAgo) return false

      if (search) {
        const lead = leads[appt.lead_id]
        const haystack = `${lead?.contact_name ?? ""} ${lead?.company ?? ""} ${
          lead?.email ?? ""
        }`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }

      return true
    })
  })()

  const summary = (() => {
    const now = new Date()
    const startOfToday = new Date(now)
    startOfToday.setHours(0, 0, 0, 0)
    const endOfToday = new Date(startOfToday.getTime() + 86400000)

    let upcoming = 0
    let today = 0
    const byChannel: Record<string, number> = {}

    appointments.forEach((appt) => {
      const scheduled = new Date(appt.scheduled_for)
      if (appt.status === "scheduled" && scheduled >= now) {
        upcoming += 1
      }
      if (scheduled >= startOfToday && scheduled < endOfToday) {
        today += 1
      }
      if (appt.channel) {
        byChannel[appt.channel] = (byChannel[appt.channel] ?? 0) + 1
      }
    })

    const channelEntries = Object.entries(byChannel)
    return { upcoming, today, channelEntries }
  })()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-white/50">
            Bookings
          </p>
          <h1 className="text-3xl font-semibold text-white">
            Appointments cockpit
          </h1>
          <p className="text-white/60">
            Track booked meetings by channel and status. Showing the latest 100
            records.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDateFilter("upcoming")}
            className={
              dateFilter === "upcoming"
                ? "border-emerald-400/60 text-emerald-100"
                : undefined
            }
          >
            Upcoming
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDateFilter("today")}
            className={
              dateFilter === "today"
                ? "border-emerald-400/60 text-emerald-100"
                : undefined
            }
          >
            Today
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDateFilter("past7")}
            className={
              dateFilter === "past7"
                ? "border-emerald-400/60 text-emerald-100"
                : undefined
            }
          >
            Past 7 days
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDateFilter("all")}
            className={
              dateFilter === "all"
                ? "border-emerald-400/60 text-emerald-100"
                : undefined
            }
          >
            All
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-200">
              <CalendarDays size={20} />
            </div>
            <div>
              <p className="text-sm text-white/70">Upcoming</p>
              <p className="text-2xl font-semibold text-white">
                {summary.upcoming}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-3 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-500/15 text-sky-200">
              <CalendarDays size={20} />
            </div>
            <div>
              <p className="text-sm text-white/70">Today</p>
              <p className="text-2xl font-semibold text-white">
                {summary.today}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card className="sm:col-span-2">
          <CardContent className="flex flex-wrap items-center gap-3 py-4">
            <p className="text-sm text-white/70">By channel</p>
            <div className="flex flex-wrap gap-2">
              {summary.channelEntries.length === 0 ? (
                <Badge variant="outline">No data</Badge>
              ) : (
                summary.channelEntries.map(([channel, value]) => (
                  <Badge
                    key={channel}
                    variant="outline"
                    className="gap-2 bg-white/5"
                  >
                    <span className="capitalize">{channel}</span>
                    <span className="rounded-full bg-white/10 px-2 text-xs">
                      {value}
                    </span>
                  </Badge>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70">
              <Filter size={16} />
              <span>Filters</span>
            </div>
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-48"
            >
              <option value="all">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="no_show">No show</option>
              <option value="cancelled">Cancelled</option>
            </Select>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search lead or company"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-64"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearch("")
                  setStatusFilter("all")
                }}
              >
                <RefreshCcw size={16} /> Reset
              </Button>
            </div>
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-rose-100">
              {error}
            </div>
          ) : null}

          {loading ? (
            <div className="flex items-center gap-2 text-white/60">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading appointments...
            </div>
          ) : null}

          {!loading && filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-white/70">
              No appointments found for the selected filters.
            </div>
          ) : null}

          {!loading && filtered.length > 0 ? (
            <div className="overflow-auto">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Lead</TableHeaderCell>
                    <TableHeaderCell>Company</TableHeaderCell>
                    <TableHeaderCell>Channel</TableHeaderCell>
                    <TableHeaderCell>Scheduled</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>State</TableHeaderCell>
                    <TableHeaderCell>Created by</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {filtered.map((appt) => {
                    const lead = leads[appt.lead_id]
                    const scheduled = new Date(appt.scheduled_for)

                    const displayName =
                      lead?.contact_name ||
                      lead?.company ||
                      lead?.phone ||
                      lead?.email ||
                      "Unknown lead"

                    return (
                      <TableRow key={appt.id}>
                        <TableCell>
                          <div className="flex flex-col">
                            <a
                              href={`/leads/${appt.lead_id}`}
                              className="font-semibold text-emerald-200 hover:text-emerald-100"
                            >
                              {displayName}
                            </a>
                            <span className="text-xs text-white/50">
                              {lead?.email ?? lead?.phone ?? "No contact"}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-white/80">
                          {lead?.company ?? "—"}
                        </TableCell>
                        <TableCell>
                          <ChannelBadge channel={appt.channel ?? undefined} />
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-white/80">
                          {formatter.format(scheduled)}
                        </TableCell>
                        <TableCell>
                          <AppointmentStatusBadge status={appt.status} />
                        </TableCell>
                        <TableCell>
                          <LeadStateBadge state={lead?.state} />
                        </TableCell>
                        <TableCell className="text-sm text-white/60">
                          {appt.created_by ?? "—"}
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
