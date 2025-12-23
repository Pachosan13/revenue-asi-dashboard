"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
} from "@/components/ui-custom"
import type { LeadEnriched } from "@/types/lead"
import {
  LeadInboxTable,
  type LeadInboxEntry,
} from "@/components/leads/LeadInboxTable"

// Extendemos el tipo base con un campo local opcional `status`
type LeadInboxWithStatus = LeadInboxEntry & {
  status?: string | null
}

type InboxRow = {
  lead_id: string
  lead_name: string | null
  lead_email: string | null
  lead_phone: string | null
  lead_state: string | null
  last_step_at: string | null
  campaign_id: string | null
  campaign_name: string | null
  channel_last: string | null
  created_at: string | null
}

const PAGE_SIZE = 25

const REQUIRED_FIELDS = [
  "lead_id",
  "lead_name",
  "lead_email",
  "lead_phone",
  "lead_state",
  "last_step_at",
  "campaign_id/name",
  "channel_last",
]

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

const MOCK_LEADS: LeadInboxWithStatus[] = [
  {
    id: "MOCK-1001",
    name: "Ana Ruiz",
    email: "ana.ruiz@example.com",
    phone: "+34 600 111 222",
    // ⬇️ requerido por LeadInboxEntry
    state: "new",
    // ⬇️ campo adicional para filtros locales
    status: "new",
    last_touch_at: "2024-11-02T10:15:00Z",
    campaign_id: "CMP-42",
    campaign_name: "Q4 Retail Push",
    channel_last: "email",
    created_at: "2024-11-01T08:00:00Z",
  },
  {
    id: "MOCK-1002",
    name: "Carlos Soto",
    email: "carlos.soto@example.com",
    phone: "+34 600 333 444",
    state: "attempting",
    status: "attempting",
    last_touch_at: "2024-11-01T16:45:00Z",
    campaign_id: "CMP-18",
    campaign_name: "ABM EMEA",
    channel_last: "phone",
    created_at: "2024-10-28T12:20:00Z",
  },
  {
    id: "MOCK-1003",
    name: "Lucía Romero",
    email: "lucia.romero@example.com",
    phone: null,
    state: "qualified",
    status: "qualified",
    last_touch_at: null,
    campaign_id: null,
    campaign_name: null,
    channel_last: "ads",
    created_at: "2024-10-25T09:30:00Z",
  },
]

const mapLead = (row: Partial<LeadEnriched & InboxRow>): LeadInboxWithStatus => ({
  id: row.lead_id ?? row.id ?? "",
  name: row.lead_name ?? row.full_name ?? null,
  email: row.lead_email ?? row.email ?? null,
  phone: row.lead_phone ?? row.phone ?? null,
  // valor base de la DB
  state: row.lead_state ?? row.state ?? null,
  // alias local para filtros / UI
  status: row.lead_state ?? row.state ?? null,
  last_touch_at: row.last_step_at ?? row.last_touch_at ?? null,
  campaign_id: row.campaign_id ?? null,
  campaign_name: row.campaign_name ?? null,
  channel_last: row.channel_last ?? null,
  created_at: row.created_at ?? null,
})

function collectMissingFields(leads: LeadInboxWithStatus[]) {
  const missing = new Set<string>()

  leads.forEach((lead) => {
    if (!lead.id) missing.add("lead_id")
    if (!lead.name) missing.add("lead_name")
    if (!lead.email) missing.add("lead_email")
    if (!lead.phone) missing.add("lead_phone")
    if (!lead.state) missing.add("lead_state")
    if (!lead.last_touch_at) missing.add("last_step_at")
    if (!lead.campaign_id && !lead.campaign_name) missing.add("campaign_id/name")
    if (!lead.channel_last) missing.add("channel_last")
  })

  return Array.from(missing)
}

export default function Page() {
  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
    [],
  )

  const [leads, setLeads] = useState<LeadInboxWithStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [usingMock, setUsingMock] = useState(!supabaseReady)
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

    return client
      .from("lead_funnel_states")
      .select(
        "lead_id, campaign_id, campaign_name, funnel_stage, last_touch_at, has_reply, has_appointment",
      )
      .order("last_step_at", { ascending: false })
      .range(from, to)
  }, [])

  useEffect(() => {
    let alive = true

    async function loadLeads() {
      if (!supabaseReady) {
        if (!alive) return
        setError(null)
        setLeads(MOCK_LEADS)
        setMissingFields(collectMissingFields(MOCK_LEADS))
        setLoading(false)
        setUsingMock(true)
        setHasMore(false)
        setPage(0)
        return
      }

      setLoading(true)
      const { data, error: dbError } = await fetchInboxPage(0)

      if (!alive) return

      if (dbError) {
        console.error(dbError)
        setError(
          "No se pudo acceder a inbox_events. Proporciona el SQL/contrato o usa el mock.",
        )
        setLeads(MOCK_LEADS)
        setMissingFields(collectMissingFields(MOCK_LEADS))
        setUsingMock(true)
        setLoading(false)
        setHasMore(false)
        setPage(0)
        return
      }

      const mapped = (data ?? []).map(mapLead)
      setError(null)
      setLeads(mapped)
      setMissingFields(collectMissingFields(mapped))
      setUsingMock(false)
      setLoading(false)
      setPage(0)
      setHasMore((data?.length ?? 0) === PAGE_SIZE)
    }

    void loadLeads()

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

    const mapped = (data ?? []).map(mapLead)
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
      const key = (lead.status ?? lead.state ?? "unknown").toLowerCase()
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

      const normalizedState = (lead.status ?? lead.state ?? "").toLowerCase()
      const matchesState = stateFilter === "all" || normalizedState === stateFilter

      return matchesQuery && matchesState
    })
  }, [activeQuery, leads, stateFilter])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Leads Inbox</h1>
            <Badge variant="neutral">Listado</Badge>
          </div>
          <p className="text-sm text-white/60">
            Campos mínimos: {REQUIRED_FIELDS.join(", ")}
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

      {!supabaseReady && (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
          <AlertTriangle size={18} />
          <div>
            <p className="font-semibold">
              Supabase not configured, showing mock data
            </p>
            <p className="text-sm text-amber-200/90">
              Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY
              para usar datos reales.
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">
              Si la tabla no existe, comparte el contrato exacto. Se muestran
              mocks temporalmente.
            </p>
          </div>
        </div>
      )}

      {missingFields.length > 0 && (
        <Card>
          <CardHeader
            title="Campos faltantes"
            description="Se devuelven como null y se muestran en la tabla."
          />
          <CardContent className="flex flex-wrap gap-2">
            {missingFields.map((field) => (
              <Badge key={field} variant="warning">
                {field}
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader
          title="Leads"
          description={
            usingMock
              ? "Mostrando mock para permitir QA."
              : "Datos listados desde inbox_events."
          }
          action={
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre, email o teléfono"
            />
          }
        />
        <CardContent>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              {STATE_FILTERS.map((option) => {
                const isActive = stateFilter === option.value
                const count = stateCounts[option.value] ?? 0
                const variant = isActive ? "primary" : "outline"

                return (
                  <Button
                    key={option.value}
                    size="sm"
                    variant={variant}
                    className="rounded-full transition duration-150 hover:scale-[1.02]"
                    onClick={() => setStateFilter(option.value)}
                  >
                    {option.label} ({count})
                  </Button>
                )
              })}
            </div>

            {activeQuery.length > 0 && (
              <p className="text-xs text-white/60">
                Mostrando {filteredLeads.length} de {leads.length} leads (filtro: “
                {activeQuery}”)
              </p>
            )}

            <LeadInboxTable leads={filteredLeads} loading={loading} />

            {hasMore && (
              <div className="flex justify-center">
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
        </CardContent>
      </Card>
    </div>
  )
}
