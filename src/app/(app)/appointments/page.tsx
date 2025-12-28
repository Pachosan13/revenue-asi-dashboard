"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Filter, Loader2, RefreshCcw } from "lucide-react"

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Select,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"
import { supabaseBrowser } from "@/lib/supabase"
import {
  AppointmentStatusBadge,
  ChannelBadge,
  LeadStateBadge,
} from "@/components/leads/badges"

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

type Maybe<T> = T | null | undefined

type Lead = {
  id: string
  contact_name: Maybe<string>
  company: Maybe<string>
  phone: Maybe<string>
  email: Maybe<string>
  state: Maybe<string>
}

type AppointmentRow = {
  id: string
  lead_id: string
  scheduled_for: string
  status: string
  channel?: Maybe<string>
  location?: Maybe<string>
  created_at?: string
  updated_at?: string
  meta?: Record<string, unknown> | null
}

type StatusFilter = "all" | "scheduled" | "completed" | "cancelled" | "no_show"
type TimeFilter = "all" | "upcoming" | "past" | "today"

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
})

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
})

// -----------------------------------------------------------------------------
// Page
// -----------------------------------------------------------------------------

export default function AppointmentsPage() {
  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  )

  const [rows, setRows] = useState<AppointmentRow[]>([])
  const [leads, setLeads] = useState<Record<string, Lead>>({})

  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming")
  const [search, setSearch] = useState("")

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Load data
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let alive = true

    async function load() {
      if (!supabaseReady) {
        setError(
          "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
        )
        setLoading(false)
        return
      }

      setLoading(true)
      setError(null)

      const client = supabaseBrowser()

      // 1) citas
      const { data, error: apptErr } = await client
        .from("appointments")
        .select("*")
        .order("scheduled_for", { ascending: true })
        .limit(300)

      if (!alive) return

      if (apptErr) {
        console.error(apptErr)
        setError(`Unable to fetch appointments: ${apptErr.message}`)
        setLoading(false)
        return
      }

      const appts = (data ?? []) as AppointmentRow[]
      setRows(appts)

      // 2) leads conectados
      const leadIds = Array.from(
        new Set(appts.map((a) => a.lead_id).filter(Boolean)),
      )

      if (leadIds.length === 0) {
        setLeads({})
        setLoading(false)
        return
      }

      const { data: leadsData, error: leadsErr } = await client
        .from("leads")
        .select("id, contact_name, company, phone, email, state")
        .in("id", leadIds)

      if (!alive) return

      if (leadsErr) {
        console.error(leadsErr)
        setError(`Unable to fetch leads: ${leadsErr.message}`)
      }

      const leadMap = (leadsData ?? []).reduce(
        (acc, lead) => {
          acc[lead.id] = lead as Lead
          return acc
        },
        {} as Record<string, Lead>,
      )

      setLeads(leadMap)
      setLoading(false)
    }

    void load()

    return () => {
      alive = false
    }
  }, [supabaseReady])

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const now = new Date()

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const statusValue = row.status?.toLowerCase?.() ?? ""

      if (statusFilter !== "all") {
        if (statusFilter === "no_show" && statusValue !== "no_show") {
          if (statusValue !== "no-show") return false
        } else if (statusValue !== statusFilter) {
          return false
        }
      }

      const date = new Date(row.scheduled_for)

      if (timeFilter === "upcoming" && date < now) return false
      if (timeFilter === "past" && date >= now) return false
      if (timeFilter === "today") {
        const sameDay =
          date.getFullYear() === now.getFullYear() &&
          date.getMonth() === now.getMonth() &&
          date.getDate() === now.getDate()
        if (!sameDay) return false
      }

      if (search) {
        const lead = leads[row.lead_id]
        const haystack = `${lead?.contact_name ?? ""} ${
          lead?.company ?? ""
        } ${lead?.email ?? ""} ${lead?.phone ?? ""}`.toLowerCase()
        if (!haystack.includes(search.toLowerCase())) return false
      }

      return true
    })
  }, [rows, leads, statusFilter, timeFilter, search, now])

  const summary = useMemo(() => {
    const upcoming = rows.filter(
      (row) => new Date(row.scheduled_for) >= now,
    ).length

    const today = rows.filter((row) => {
      const d = new Date(row.scheduled_for)
      return (
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate()
      )
    }).length

    const completed = rows.filter(
      (row) => row.status?.toLowerCase() === "completed",
    ).length

    const noShow = rows.filter((row) => {
      const s = row.status?.toLowerCase()
      return s === "no_show" || s === "no-show"
    }).length

    const completionRate =
      completed + noShow > 0
        ? `${((completed / (completed + noShow)) * 100).toFixed(1)}%`
        : "0.0%"

    return {
      upcoming,
      today,
      total: rows.length,
      completionRate,
    }
  }, [rows, now])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/40">
            Pipeline & actions
          </p>
          <h1 className="text-3xl font-semibold text-white">Appointments</h1>
          <p className="text-sm text-white/60">
            Central view of all booked meetings. See who&apos;s coming, who
            no-showed, and how healthy your calendar is.
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => {
            setStatusFilter("all")
            setTimeFilter("upcoming")
            setSearch("")
          }}
        >
          <RefreshCcw size={16} />
          Reset view
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <StatCard
          label="Upcoming"
          value={summary.upcoming.toString()}
          helper="Future on the calendar"
          delta={`${summary.total} total`}
        />
        <StatCard
          label="Today"
          value={summary.today.toString()}
          helper="Booked for today"
          delta={summary.today > 0 ? "Stay sharp" : "No meetings today"}
        />
        <StatCard
          label="Completion rate"
          value={summary.completionRate}
          helper="Completed vs no-show"
          delta="Last 300 records"
        />
        <StatCard
          label="Records loaded"
          value={summary.total.toString()}
          helper="Appointments in view"
          delta="From Supabase"
        />
      </div>

      {/* Filters */}
      <Card className="border-white/10 bg-black/40 backdrop-blur-sm">
        <CardHeader
          title="Calendar control"
          description="Filter by status, time window, and lead details."
          action={<Filter className="h-4 w-4 text-white/60" />}
        />
        <CardContent className="space-y-4 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as StatusFilter)
              }
              className="w-44"
            >
              <option value="all">All statuses</option>
              <option value="scheduled">Scheduled</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no_show">No-show</option>
            </Select>

            <Select
              value={timeFilter}
              onChange={(e) =>
                setTimeFilter(e.target.value as TimeFilter)
              }
              className="w-40"
            >
              <option value="all">Any date</option>
              <option value="upcoming">Upcoming</option>
              <option value="today">Today</option>
              <option value="past">Past</option>
            </Select>

            <Input
              placeholder="Search lead / company / email / phone"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-80"
            />

            {loading ? (
              <div className="flex items-center gap-2 text-xs text-white/60">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading appointments…
              </div>
            ) : (
              <div className="flex items-center gap-2 text-xs text-white/50">
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {filtered.length} shown
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">
                  {rows.length} total loaded
                </span>
              </div>
            )}
          </div>

          {error ? (
            <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          ) : null}
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-white/10 bg-black/40 backdrop-blur-sm">
        <CardContent className="pt-4">
          {!loading && filtered.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-sm text-white/70">
              No appointments match the selected filters.
            </div>
          ) : null}

          {!loading && filtered.length > 0 ? (
            <div className="overflow-auto rounded-2xl border border-white/10">
              <Table>
                <TableHead>
                  <TableRow className="bg-white/5">
                    <TableHeaderCell>Lead</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>When</TableHeaderCell>
                    <TableHeaderCell>Channel</TableHeaderCell>
                    <TableHeaderCell>Contact</TableHeaderCell>
                    <TableHeaderCell>Meta</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {filtered.map((row) => {
                    const lead = leads[row.lead_id]
                    const when = new Date(row.scheduled_for)

                    const displayName =
                      lead?.contact_name ||
                      lead?.company ||
                      lead?.email ||
                      lead?.phone ||
                      "Unknown lead"

                    const metaNotes =
                      (row.meta as { notes?: string } | null)?.notes ?? ""

                    return (
                      <TableRow
                        key={row.id}
                        className="border-t border-white/5 bg-black/40 transition hover:bg-white/5"
                      >
                        {/* Lead */}
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <a
                              href={`/leads/${row.lead_id}`}
                              className="font-semibold text-emerald-200 hover:text-emerald-100"
                            >
                              {displayName}
                            </a>
                            <LeadStateBadge state={lead?.state} />
                          </div>
                        </TableCell>

                        {/* Status */}
                        <TableCell>
                          <AppointmentStatusBadge status={row.status} />
                        </TableCell>

                        {/* When */}
                        <TableCell className="whitespace-nowrap text-sm text-white/80">
                          <div className="flex flex-col">
                            <span>{dateTimeFormatter.format(when)}</span>
                            <span className="text-xs text-white/40">
                              {dateFormatter.format(when)}
                            </span>
                          </div>
                        </TableCell>

                        {/* Channel */}
                        <TableCell>
                          <ChannelBadge channel={row.channel ?? null} />
                        </TableCell>

                        {/* Contact */}
                        <TableCell className="text-sm text-white/80">
                          <div className="flex flex-col gap-0.5">
                            <span>{lead?.email ?? "—"}</span>
                            <span className="text-xs text-white/50">
                              {lead?.phone ?? "—"}
                            </span>
                          </div>
                        </TableCell>

                        {/* Meta / notes */}
                        <TableCell className="max-w-md text-sm text-white/80">
                          {row.location ? (
                            <div className="mb-1 text-xs text-white/60">
                              Location: {row.location}
                            </div>
                          ) : null}
                          {metaNotes ? (
                            metaNotes
                          ) : (
                            <span className="text-white/40">—</span>
                          )}
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
              Loading appointments…
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}
