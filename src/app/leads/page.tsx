"use client"

import React, { useEffect, useMemo, useState, useCallback } from "react"
import { AlertTriangle, Filter, RefreshCw } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
<<<<<<< HEAD
import LeadTable from "@/components/LeadTable"
import type { LeadEnriched, LeadState } from "@/types/lead"
import { Badge, Button, Card, CardContent, CardHeader, Input, Select } from "@/components/ui-custom"

const STATUS_OPTIONS = ["All", "New", "Contacted", "Qualified"] as const
const STATE_FILTERS: ("All" | LeadState)[] = [
  "All",
  "new",
  "enriched",
  "attempting",
  "engaged",
  "qualified",
  "booked",
  "dead",
]
=======
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
} from "@/components/ui-custom"
import { LeadInboxTable, type LeadInboxEntry } from "@/components/leads/LeadInboxTable"

const PAGE_SIZE = 25
>>>>>>> origin/plan-joe-dashboard-v1

const STATE_FILTERS = [
  { label: "All", value: "all" },
  { label: "New", value: "new" },
  { label: "Enriched", value: "enriched" },
  { label: "Attempting", value: "attempting" },
  { label: "Engaged", value: "engaged" },
  { label: "Qualified", value: "qualified" },
  { label: "Booked", value: "booked" },
  { label: "Dead", value: "dead" },
]

export default function LeadsPage() {
  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  )

  const [leads, setLeads] = useState<LeadInboxEntry[]>([])
  const [loading, setLoading] = useState(true)
<<<<<<< HEAD
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("All")
  const [stateFilter, setStateFilter] = useState<LeadState | "All">("All")
  const [confidence, setConfidence] = useState(30)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
=======
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [stateFilter, setStateFilter] = useState("all")
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const activeQuery = debouncedQuery.trim()

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 275)
    return () => clearTimeout(timer)
  }, [query])

  const fetchInboxPage = useCallback(async (pageIndex: number) => {
    const client = supabaseBrowser()
    const from = pageIndex * PAGE_SIZE
    const to = from + PAGE_SIZE - 1

    // 🔹 USAMOS inbox_events DIRECTO – que ya validaste con datos reales
    return client
      .from("inbox_events")
      .select(
        `
        lead_id,
        lead_name,
        lead_email,
        lead_phone,
        lead_state,
        last_step_at,
        campaign_id,
        campaign_name,
        channel_last,
        created_at
      `,
      )
      .order("last_step_at", { ascending: false, nullsLast: true } as any)
      .range(from, to)
  }, [])
>>>>>>> origin/plan-joe-dashboard-v1

  useEffect(() => {
    let alive = true

    async function load() {
      if (!supabaseReady) {
        if (!alive) return
        setError("Supabase no está configurado (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY).")
        setLeads([])
        setLoading(false)
        setHasMore(false)
        setPage(0)
        return
      }

      setLoading(true)
<<<<<<< HEAD
      const { data, error } = await supabase
        .from("lead_enriched")
        .select(
          "id, lead_raw_id, created_at, full_name, email, phone, company, title, location, confidence, data, state",
        )
        .order("created_at", { ascending: false })
        .limit(200)
=======
      const { data, error: dbError } = await fetchInboxPage(0)
>>>>>>> origin/plan-joe-dashboard-v1

      if (!alive) return

      if (dbError) {
        console.error(dbError)
        setError("No se pudo leer inbox_events para /leads.")
        setLeads([])
        setLoading(false)
        setHasMore(false)
        setPage(0)
        return
      }

      const mapped: LeadInboxEntry[] =
        (data ?? []).map((row: any) => ({
          id: row.lead_id,
          name: row.lead_name,
          email: row.lead_email,
          phone: row.lead_phone,
          status: row.lead_state,
          last_touch_at: row.last_step_at,
          campaign_id: row.campaign_id,
          campaign_name: row.campaign_name,
          channel_last: row.channel_last,
          created_at: row.created_at,
        })) ?? []

      setError(null)
      setLeads(mapped)
      setLoading(false)
      setPage(0)
      setHasMore((data?.length ?? 0) === PAGE_SIZE)
    }

    void load()

    return () => {
      alive = false
    }
  }, [fetchInboxPage, supabaseReady])

  const loadMore = useCallback(async () => {
    if (!supabaseReady || !hasMore || isLoadingMore) return

    setIsLoadingMore(true)
    const nextPage = page + 1
    const { data, error: dbError } = await fetchInboxPage(nextPage)

    if (dbError) {
      console.error(dbError)
      setHasMore(false)
      setIsLoadingMore(false)
      return
    }

    const mapped: LeadInboxEntry[] =
      (data ?? []).map((row: any) => ({
        id: row.lead_id,
        name: row.lead_name,
        email: row.lead_email,
        phone: row.lead_phone,
        status: row.lead_state,
        last_touch_at: row.last_step_at,
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        channel_last: row.channel_last,
        created_at: row.created_at,
      })) ?? []

<<<<<<< HEAD
    if (stateFilter !== "All" && lead.state !== stateFilter) return false

    if ((lead.confidence ?? 0) * 100 < confidence) return false

    if (dateFrom) {
      const created = new Date(lead.created_at)
      if (Number.isFinite(created.getTime()) && created < new Date(dateFrom)) return false
    }
    if (dateTo) {
      const created = new Date(lead.created_at)
      if (Number.isFinite(created.getTime()) && created > new Date(`${dateTo}T23:59:59`)) return false
=======
    setLeads((prev) => [...prev, ...mapped])
    setPage(nextPage)
    if ((data?.length ?? 0) < PAGE_SIZE) {
      setHasMore(false)
>>>>>>> origin/plan-joe-dashboard-v1
    }
    setIsLoadingMore(false)
  }, [fetchInboxPage, hasMore, isLoadingMore, page, supabaseReady])

  const stateCounts = useMemo(() => {
    const counts: Record<string, number> = { all: leads.length }
    leads.forEach((lead) => {
      const key = lead.status?.toLowerCase() ?? "unknown"
      counts[key] = (counts[key] ?? 0) + 1
    })
    return counts
  }, [leads])

  const filteredLeads = useMemo(() => {
    const term = activeQuery.toLowerCase()

    return leads.filter((lead) => {
      const matchesQuery =
        term.length === 0 ||
        lead.name?.toLowerCase().includes(term) ||
        lead.email?.toLowerCase().includes(term) ||
        lead.phone?.toLowerCase().includes(term)

      const normalizedState = lead.status?.toLowerCase()
      const matchesState = stateFilter === "all" || normalizedState === stateFilter

      return matchesQuery && matchesState
    })
  }, [activeQuery, leads, stateFilter])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Leads</h1>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
              Live
            </Badge>
          </div>
          <p className="text-sm text-white/60">
            Visión consolidada de leads usando inbox_events.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => window.location.reload()}
            aria-label="Refrescar leads"
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">
              Revisa la view inbox_events o las credenciales de Supabase.
            </p>
          </div>
        </div>
      )}

      <Card className="border-white/10 bg-white/5">
        <CardContent className="flex flex-col gap-4 py-4 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" className="flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Filtros
            </Button>
<<<<<<< HEAD
          }
        />
        <CardContent className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2 lg:col-span-4">
            <p className="text-xs uppercase tracking-[0.1em] text-white/50">State</p>
            <div className="flex flex-wrap gap-2">
              {STATE_FILTERS.map((state) => {
                const active = stateFilter === state
                const label = state === "All" ? "All" : state.charAt(0).toUpperCase() + state.slice(1)
                return (
                  <Button
                    key={state}
                    variant={active ? "primary" : "outline"}
                    size="sm"
                    onClick={() => setStateFilter(state)}
                    className="capitalize"
                  >
                    {label}
                  </Button>
                )
              })}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.1em] text-white/50">Status</p>
            <Select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.1em] text-white/50">
              <span>Confidence</span>
              <span className="font-semibold text-white/70">{confidence}%+</span>
=======
            <div className="flex flex-wrap items-center gap-2">
              {STATE_FILTERS.map((option) => {
                const isActive = stateFilter === option.value
                const count = stateCounts[option.value] ?? 0

                return (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={isActive ? "primary" : "outline"}
                    className="rounded-full"
                    onClick={() => setStateFilter(option.value)}
                  >
                    {option.label} ({count})
                  </Button>
                )
              })}
>>>>>>> origin/plan-joe-dashboard-v1
            </div>
          </div>
          <div className="flex flex-1 justify-end gap-3">
            <Input
              placeholder="Buscar por nombre, email o teléfono..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="max-w-xs rounded-xl border-white/10 bg-black/40 text-sm text-white placeholder:text-white/40"
            />
          </div>
        </CardContent>
      </Card>

<<<<<<< HEAD
      <Card>
        <CardHeader
          title="Leads queue"
          description="Prioritize, contact, and annotate without leaving your desk."
          action={
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Buscar por nombre, empresa, email..."
              className="w-64"
            />
          }
        />
        <CardContent className="p-0">
          <LeadTable
            leads={filtered}
            loading={loading}
            onSelect={(lead) => {
              console.log("selected lead", lead.id)
            }}
          />
        </CardContent>
      </Card>
=======
      <LeadInboxTable leads={filteredLeads} loading={loading} />

      {hasMore && (
        <div className="mt-4 flex justify-center">
          <Button
            variant="outline"
            size="sm"
            disabled={isLoadingMore}
            onClick={loadMore}
            className="min-w-[140px]"
          >
            {isLoadingMore ? "Cargando..." : "Load more"}
          </Button>
        </div>
      )}
>>>>>>> origin/plan-joe-dashboard-v1
    </div>
  )
}
