"use client"

import React, { useEffect, useMemo, useState, useCallback } from "react"
import { AlertTriangle, Filter, RefreshCw } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
import {
  Badge,
  Button,
  Card,
  CardContent,
  Input,
} from "@/components/ui-custom"
import { LeadInboxTable, type LeadInboxEntry } from "@/components/leads/LeadInboxTable"

const PAGE_SIZE = 25

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
      const { data, error: dbError } = await fetchInboxPage(0)

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

    setLeads((prev) => [...prev, ...mapped])
    setPage(nextPage)
    if ((data?.length ?? 0) < PAGE_SIZE) {
      setHasMore(false)
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
    </div>
  )
}
