"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Inbox, Search, Filter } from "lucide-react"
import { useRouter } from "next/navigation"
import {
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Input,
  Select,
  StatCard,
  Button,
} from "@/components/ui-custom"
import { supabaseBrowser } from "@/lib/supabase"

type LeadState =
  | "new"
  | "enriched"
  | "attempting"
  | "engaged"
  | "qualified"
  | "booked"
  | "dead"

type InboxRow = {
  lead_id: string
  lead_name: string | null
  lead_email: string | null
  lead_phone: string | null
  lead_state: LeadState | null
  last_touched_at: string | null
  last_channel: string | null
  last_step_channel: string | null
  last_step_status: string | null
  last_step_at: string | null
  campaign_id: string | null
  campaign_name: string | null
  last_message: string | null
}

const stateLabels: Record<LeadState, string> = {
  new: "New",
  enriched: "Enriched",
  attempting: "Touched",
  engaged: "Engaged",
  qualified: "Qualified",
  booked: "Booked",
  dead: "Dead",
}

const stateBadge: Record<LeadState, string> = {
  new: "bg-white/5 text-white/70 border border-white/20",
  enriched: "bg-sky-500/20 text-sky-200 border border-sky-400/40",
  attempting: "bg-sky-500/20 text-sky-200 border border-sky-400/40",
  engaged: "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40",
  qualified: "bg-indigo-500/20 text-indigo-200 border border-indigo-400/40",
  booked: "bg-purple-500/20 text-purple-200 border border-purple-400/40",
  dead: "bg-rose-500/20 text-rose-200 border border-rose-400/40",
}

const channelBadge: Record<string, string> = {
  whatsapp: "bg-emerald-500/15 text-emerald-200 border border-emerald-500/40",
  sms: "bg-sky-500/15 text-sky-200 border border-sky-500/40",
  email: "bg-indigo-500/15 text-indigo-200 border border-indigo-500/40",
  voice: "bg-amber-500/15 text-amber-100 border border-amber-500/40",
}

export default function InboxPage() {
  const supabase = useMemo(() => {
    const hasEnv =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])

  const router = useRouter()

  const [rows, setRows] = useState<InboxRow[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState<LeadState | "all">("all")
  const [channelFilter, setChannelFilter] = useState<string | "all">("all")

  async function loadInbox() {
    if (!supabase) {
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from("inbox_events")
      .select("*")
      .order("last_step_at", { ascending: false })
      .limit(300)

    if (error) {
      console.error("Failed to load inbox_events", error)
      setRows([])
      setLoading(false)
      return
    }

    setRows((data ?? []) as InboxRow[])
    setLoading(false)
  }

  useEffect(() => {
    loadInbox()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      const q = query.trim().toLowerCase()

      const matchesQuery =
        q.length === 0 ||
        (row.lead_name ?? "").toLowerCase().includes(q) ||
        (row.lead_email ?? "").toLowerCase().includes(q) ||
        (row.lead_phone ?? "").toLowerCase().includes(q)

      const matchesState =
        stateFilter === "all" || row.lead_state === stateFilter

      const chan = row.last_step_channel ?? row.last_channel ?? ""
      const matchesChannel =
        channelFilter === "all" ||
        chan.toLowerCase() === channelFilter.toLowerCase()

      return matchesQuery && matchesState && matchesChannel
    })
  }, [rows, query, stateFilter, channelFilter])

  const summary = useMemo(() => {
    const total = rows.length
    const touched = rows.filter(
      (r) => r.lead_state === "attempting" || r.lead_state === "engaged"
    ).length
    const engaged = rows.filter((r) => r.lead_state === "engaged").length
    return { total, touched, engaged }
  }, [rows])

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">
            Revenue ASI
          </p>
          <h1 className="flex items-center gap-2 text-3xl font-semibold text-white">
            <Inbox size={22} className="text-emerald-400" />
            Inbox
          </h1>
          <p className="text-sm text-white/60">
            Último toque por lead, con estado y canal. SDR cockpit.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="border border-white/10"
            onClick={loadInbox}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Leads en inbox"
          value={summary.total.toLocaleString()}
          helper="Todos los leads con o sin toques"
          delta="Live"
        />
        <StatCard
          label="Touched"
          value={summary.touched.toLocaleString()}
          helper="Leads que ya recibieron un toque"
          delta="Autopilot"
        />
        <StatCard
          label="Engaged"
          value={summary.engaged.toLocaleString()}
          helper="Listo para pipeline / deals"
          delta="Coming soon"
        />
      </div>

      {/* Card principal */}
      <Card>
        <CardHeader
          title="Leads"
          description="Filtra por estado, canal o búsqueda"
          action={
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Filter size={16} />
              Smart filters
            </div>
          }
        />
        <CardContent className="space-y-4">
          {/* Filtros */}
          <div className="grid gap-3 md:grid-cols-[1.2fr,1fr,1fr]">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 shadow-inner shadow-black/40">
              <Search size={16} className="text-white/40" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, email, phone"
                className="border-none bg-transparent px-0 text-sm"
              />
            </div>

            <Select
              value={stateFilter}
              onChange={(e) =>
                setStateFilter(
                  (e.target.value === "all" ? "all" : e.target.value) as
                    | LeadState
                    | "all"
                )
              }
            >
              <option value="all">All states</option>
              <option value="new">New</option>
              <option value="enriched">Enriched</option>
              <option value="attempting">Touched</option>
              <option value="engaged">Engaged</option>
              <option value="qualified">Qualified</option>
              <option value="booked">Booked</option>
              <option value="dead">Dead</option>
            </Select>

            <Select
              value={channelFilter}
              onChange={(e) =>
                setChannelFilter(
                  (e.target.value === "all" ? "all" : e.target.value) as
                    | string
                    | "all"
                )
              }
            >
              <option value="all">All channels</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="voice">Voice</option>
            </Select>
          </div>

          {/* Tabla */}
          {loading ? (
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              {[1, 2, 3, 4, 5].map((row) => (
                <div key={row} className="h-12 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-emerald-400/30 bg-white/5 px-6 py-10 text-center shadow-[0_20px_60px_rgba(16,185,129,0.15)]">
              <div className="rounded-full bg-emerald-500/20 p-3 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.4)]">
                <Inbox />
              </div>
              <p className="text-lg font-semibold text-white">No leads match</p>
              <p className="text-sm text-white/60">
                Ajusta filtros o lanza una campaña para poblar el inbox.
              </p>
            </div>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Lead</TableHeaderCell>
                  <TableHeaderCell>State</TableHeaderCell>
                  <TableHeaderCell>Channel</TableHeaderCell>
                  <TableHeaderCell>Last touch</TableHeaderCell>
                  <TableHeaderCell>Campaign</TableHeaderCell>
                  <TableHeaderCell>Preview</TableHeaderCell>
                  <TableHeaderCell>Timeline</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {filtered.map((row) => {
                  const state = (row.lead_state ?? "new") as LeadState
                  const chan = (row.last_step_channel ?? row.last_channel ?? "") as string
                  const channelClass =
                    channelBadge[chan as keyof typeof channelBadge] ??
                    "bg-white/5 text-white/70 border border-white/15"

                  return (
                    <TableRow
                      key={row.lead_id}
                      className="cursor-pointer hover:bg-white/5 transition"
                      onClick={() => router.push(`/leads/${row.lead_id}`)}
                    >
                      <TableCell>
                        <div className="space-y-1">
                          <p className="font-semibold text-white">
                            {row.lead_name ||
                              row.lead_email ||
                              row.lead_phone ||
                              "Unnamed lead"}
                          </p>
                          <p className="text-xs text-white/50">
                            {row.lead_email || "—"}
                            {row.lead_phone ? ` • ${row.lead_phone}` : ""}
                          </p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
                            stateBadge[state]
                          }`}
                        >
                          <span className="h-2 w-2 rounded-full bg-current" />
                          {stateLabels[state]}
                        </span>
                      </TableCell>
                      <TableCell>
                        {chan ? (
                          <span
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${channelClass}`}
                          >
                            {chan}
                          </span>
                        ) : (
                          <span className="text-xs text-white/40">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-white/70">
                        {row.last_step_at
                          ? new Date(row.last_step_at).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-white/70">
                        {row.campaign_name || "—"}
                      </TableCell>
                      <TableCell className="max-w-xs text-sm text-white/70">
                        {row.last_message
                          ? row.last_message.length > 120
                            ? row.last_message.slice(0, 120) + "…"
                            : row.last_message
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-emerald-400">
                        <Link
                          href={`/leads/${row.lead_id}`}
                          onClick={(e) => e.stopPropagation()}
                          className="underline hover:text-emerald-300"
                        >
                          Ver timeline
                        </Link>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
