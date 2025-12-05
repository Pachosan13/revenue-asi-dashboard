"use client"

import React, { useEffect, useMemo, useState, useCallback } from "react"
import { AlertTriangle, Filter, RefreshCw } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
<<<<<<< HEAD
<<<<<<< HEAD
import LeadTable from "@/components/LeadTable"
import type { LeadEnriched, LeadState } from "@/types/lead"
import { Badge, Button, Card, CardContent, CardHeader, Input, Select } from "@/components/ui-custom"
=======
import LeadTable, { deriveLeadDisplayName } from "@/components/LeadTable"
import type { LeadEnriched } from "@/types/lead"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Input,
  Select,
  Textarea,
} from "@/components/ui-custom"
import NewLeadModal from "./new-lead-modal"
>>>>>>> origin/director-engine-core

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

<<<<<<< HEAD
=======
function getLeadStatus(lead: LeadEnriched) {
  return (lead.state ?? "new").toLowerCase()
}

const STATE_ORDER: Record<string, number> = {
  booked: 1,
  engaged: 2,
  enriched: 3,
  attempting: 4,
  new: 5,
  dead: 6,
}

// tipo para la view lead_activity_summary
type LeadActivityRow = {
  lead_id: string
  state: string | null
  source: string | null
  niche: string | null
  city: string | null
  country_code: string | null
  last_channel: string | null
  last_status: string | null
  last_step: number | null
  last_touch_at: string | null
}

>>>>>>> origin/director-engine-core
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
<<<<<<< HEAD
=======
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")
  const [stateFilter, setStateFilter] = useState("all")
  const [page, setPage] = useState(0)
  const [hasMore, setHasMore] = useState(false)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
=======
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
>>>>>>> origin/director-engine-core

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

<<<<<<< HEAD
    setIsLoadingMore(true)
    const nextPage = page + 1
    const { data, error: dbError } = await fetchInboxPage(nextPage)
=======
    const displayName = deriveLeadDisplayName(lead)

    if (searchText) {
      const matchesSearch =
        displayName.toLowerCase().includes(searchText) ||
        (lead.full_name ?? "").toLowerCase().includes(searchText) ||
        (lead.email ?? "").toLowerCase().includes(searchText) ||
        (lead.phone ?? "").toLowerCase().includes(searchText) ||
        (lead.campaign_name ?? "").toLowerCase().includes(searchText)
>>>>>>> origin/director-engine-core

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

<<<<<<< HEAD
  const filteredLeads = useMemo(() => {
    const term = activeQuery.toLowerCase()
=======
  const orderedLeads = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const stateA = getLeadStatus(a)
      const stateB = getLeadStatus(b)
      const orderA = STATE_ORDER[stateA] ?? 99
      const orderB = STATE_ORDER[stateB] ?? 99

      if (orderA !== orderB) return orderA - orderB

      const timeA = a.last_touch_at ? new Date(a.last_touch_at).getTime() : NaN
      const timeB = b.last_touch_at ? new Date(b.last_touch_at).getTime() : NaN

      const validA = Number.isFinite(timeA)
      const validB = Number.isFinite(timeB)

      if (validA && validB) return timeB - timeA
      if (validA) return -1
      if (validB) return 1
      return 0
    })
  }, [filtered])

  // --------- HANDLERS ----------
  const handleSelectLead = (lead: LeadEnriched) => {
    if (!lead?.id) return
    console.log("selected lead", lead.id)
    router.push(`/leads/${lead.id}`)
  }
>>>>>>> origin/director-engine-core

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

<<<<<<< HEAD
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Leads</h1>
            <Badge variant="outline" className="border-emerald-500/40 text-emerald-300">
              Live
            </Badge>
=======
  const handleImported = (inserted: number) => {
    console.log("Imported leads", inserted)
    loadLeads()
  }

  // --------- RENDER ----------
  return (
    <>
      <div className="space-y-5">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-white">
                Leads Inbox
              </h1>
              <Badge variant="neutral">
                {usingMock ? "Mock mode" : "Live engine"}
              </Badge>
            </div>
            <p className="text-sm text-white/60">
              {loading
                ? "Cargando..."
                : `${filtered.length} leads visibles`}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              aria-label="Refresh"
              onClick={handleRefreshClick}
            >
              <RefreshCw size={16} />
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImportOpen(true)}
            >
              Import leads
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setNewLeadOpen(true)}
            >
              New lead
            </Button>
>>>>>>> origin/director-engine-core
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
<<<<<<< HEAD
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
=======

        {/* Error banner */}
        {error ? (
          <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
            <AlertTriangle size={18} className="mt-0.5" />
            <div>
              <p className="font-semibold">{error}</p>
              <p className="text-sm text-red-200/90">
                Se muestran mocks temporalmente.
              </p>
            </div>
          </div>
        ) : null}

        {/* Filters */}
        <Card>
          <CardHeader
            title="Filters"
            description={
              usingMock
                ? "Filtrando sobre datos mock."
                : "Filtra por estado y fecha del último toque."
            }
            action={
              <Button variant="ghost" size="sm">
                <Filter size={16} />
                Save view
              </Button>
            }
          />
          <CardContent className="grid gap-4 lg:grid-cols-4">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.1em] text-white/50">
                Status
              </p>
              <Select
                value={status}
                onChange={(e) =>
                  setStatus(
                    e.target
                      .value as (typeof STATUS_OPTIONS)[number]
                  )
                }
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.1em] text-white/50">
                From
              </p>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs uppercase tracking-[0.1em] text-white/50">
                To
              </p>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardHeader
            title="Leads queue"
            description="Prioritize, contact, and annotate without leaving your desk."
            action={
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar por nombre, email, campaña..."
                className="w-64"
              />
            }
          />
          <CardContent className="p-0">
            <LeadTable
              leads={orderedLeads}
              loading={loading}
              deriveStatus={getLeadStatus}
              onSelect={handleSelectLead}
            />
          </CardContent>
        </Card>
      </div>

      {/* New lead modal */}
      <NewLeadModal
        open={newLeadOpen}
        onOpenChange={setNewLeadOpen}
        supabase={supabase}
        onCreated={loadLeads}
      />

      <ImportLeadsModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={handleImported}
        supabase={supabase}
      />
    </>
>>>>>>> origin/director-engine-core
  )
}

type ImportLeadsModalProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (inserted: number) => void
  supabase: ReturnType<typeof supabaseBrowser> | null
}

type LeadImportPayload = {
  source?: string
  niche?: string
  company_name?: string
  contact_name?: string
  phone: string
  email?: string
  city?: string
  country?: string
  website?: string
  campaign_name?: string
}

const CSV_HEADERS: (keyof LeadImportPayload)[] = [
  "source",
  "niche",
  "company_name",
  "contact_name",
  "phone",
  "email",
  "city",
  "country",
  "website",
  "campaign_name",
]

function parseCsvPayload(csvRaw: string) {
  const lines = csvRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

  if (lines.length === 0) {
    throw new Error("CSV vacío")
  }

  const header = lines[0].split(",").map((col) => col.trim().toLowerCase())
  const expectedHeader = CSV_HEADERS
    .map((col) => col.toLowerCase())
    .join(",")

  if (header.join(",") !== expectedHeader) {
    throw new Error("Encabezados inválidos")
  }

  const leads: LeadImportPayload[] = []
  let invalidWithoutPhone = 0

  for (const line of lines.slice(1)) {
    const columns = line.split(",").map((value) => value.trim())

    if (columns.length !== CSV_HEADERS.length) {
      throw new Error("Número de columnas incorrecto")
    }

    const [
      source,
      niche,
      company_name,
      contact_name,
      phone,
      email,
      city,
      country,
      website,
      campaign_name,
    ] = columns

    if (!phone) {
      invalidWithoutPhone += 1
      continue
    }

    const lead: LeadImportPayload = {
      phone,
      source: source || "manual",
    }

    if (niche) lead.niche = niche
    if (company_name) lead.company_name = company_name
    if (contact_name) lead.contact_name = contact_name
    if (email) lead.email = email
    if (city) lead.city = city
    if (country) lead.country = country
    if (website) lead.website = website
    if (campaign_name) lead.campaign_name = campaign_name

    leads.push(lead)
  }

  return { leads, invalidWithoutPhone }
}

function ImportLeadsModal({
  open,
  onOpenChange,
  onImported,
  supabase,
}: ImportLeadsModalProps) {
  const [activeTab, setActiveTab] = useState<"csv" | "json">("csv")
  const [csvPayload, setCsvPayload] = useState("")
  const [jsonPayload, setJsonPayload] = useState("")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [csvSummary, setCsvSummary] = useState<{ valid: number; invalid: number } | null>(
    null
  )

  if (!open) return null

  const mutateImport = async (leads: LeadImportPayload[]) => {
    if (!supabase) return

    setLoading(true)
    const { data, error } = await supabase.rpc("import_leads_simple", {
      p_leads: leads,
    })

    if (error) {
      console.error(error)
      setErrorMessage(
        "No se pudo importar los leads, revisa el formato o prueba con un batch más pequeño."
      )
      setLoading(false)
      return
    }

    if (data && data.ok === true) {
      onImported(data.inserted ?? 0)
      setErrorMessage(null)
      setCsvSummary(null)
      setCsvPayload("")
      setJsonPayload("")
      onOpenChange(false)
    }

    setLoading(false)
  }

  const handleCsvImport = async () => {
    setErrorMessage(null)

    let parsedCsv
    try {
      parsedCsv = parseCsvPayload(csvPayload)
    } catch (err) {
      console.error("Invalid CSV", err)
      setErrorMessage("No se pudo leer el CSV. Revisa encabezados y formato.")
      return
    }

    if (parsedCsv.leads.length === 0) {
      setErrorMessage("No hay leads válidos con phone para importar.")
      return
    }

    setCsvSummary({
      valid: parsedCsv.leads.length,
      invalid: parsedCsv.invalidWithoutPhone,
    })

    await mutateImport(parsedCsv.leads)
  }

  const handleJsonImport = async () => {
    setErrorMessage(null)

    let parsed: unknown
    try {
      parsed = JSON.parse(jsonPayload)
    } catch (err) {
      console.error("Invalid JSON", err)
      setErrorMessage("El JSON no es válido o no es un array de objetos.")
      return
    }

    if (
      !Array.isArray(parsed) ||
      !parsed.every((item) => item && typeof item === "object")
    ) {
      setErrorMessage("El JSON no es válido o no es un array de objetos.")
      return
    }

    await mutateImport(parsed as LeadImportPayload[])
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="w-full max-w-3xl">
        <CardHeader
          title="Import leads"
          description="Carga tus leads vía CSV (recomendado) o JSON (avanzado)."
        />
        <CardContent className="space-y-4">
          {!supabase ? (
            <p className="rounded-lg border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-100">
              Supabase no está configurado (faltan env vars).
            </p>
          ) : null}

          <div className="flex gap-2">
            <Button
              variant={activeTab === "csv" ? "default" : "ghost"}
              onClick={() => setActiveTab("csv")}
              disabled={loading}
            >
              CSV (recommended)
            </Button>
            <Button
              variant={activeTab === "json" ? "default" : "ghost"}
              onClick={() => setActiveTab("json")}
              disabled={loading}
            >
              JSON (advanced)
            </Button>
          </div>

          {activeTab === "csv" ? (
            <div className="space-y-3">
              <p className="text-sm text-white/80">
                Pega un CSV con los siguientes encabezados en este orden:
                <span className="ml-1 font-mono text-xs text-white">
                  {CSV_HEADERS.join(", ")}
                </span>
              </p>
              <Textarea
                value={csvPayload}
                onChange={(e) => setCsvPayload(e.target.value)}
                placeholder={`source,niche,company_name,contact_name,phone,email,city,country,website,campaign_name\nmanual,dentist,Smile Pro Clinic,Dr. Jane Doe,+13055550001,jane@smilepro.com,Miami,US,https://smilepro.com,Test Campaign`}
                className="h-60 font-mono"
              />
              {csvSummary ? (
                <p className="text-sm text-white/80">
                  {csvSummary.valid} leads listos para importar,
                  {" "}
                  {csvSummary.invalid} filas ignoradas (sin phone).
                </p>
              ) : null}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-white/80">
                Pega un array JSON de leads con campos básicos como source, niche,
                company_name, contact_name, phone, email, city, country.
              </p>
              <Textarea
                value={jsonPayload}
                onChange={(e) => setJsonPayload(e.target.value)}
                placeholder={`[
  {
    "source": "joe_dentists_q1",
    "niche": "dentist",
    "company_name": "Smile Pro Clinic",
    "contact_name": "Dr. Jane Doe",
    "phone": "+13055550001",
    "email": "jane@smilepro.com",
    "city": "Miami",
    "country": "US"
  }
]`}
                className="h-60 font-mono"
              />
            </div>
          )}

          {errorMessage ? (
            <p className="text-sm text-red-300">{errorMessage}</p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="ghost"
              onClick={() => {
                setErrorMessage(null)
                onOpenChange(false)
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            {activeTab === "csv" ? (
              <Button onClick={handleCsvImport} disabled={loading || !supabase}>
                {loading ? "Importing..." : "Import CSV"}
              </Button>
            ) : (
              <Button onClick={handleJsonImport} disabled={loading || !supabase}>
                {loading ? "Importing..." : "Import JSON"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
