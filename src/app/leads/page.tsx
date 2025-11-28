"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { AlertTriangle, Filter, RefreshCw } from "lucide-react"
import { useRouter } from "next/navigation"

import { supabaseBrowser } from "@/lib/supabase"
import LeadTable from "@/components/LeadTable"
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

const STATUS_OPTIONS = [
  "All",
  "new",
  "enriched",
  "attempting",
  "engaged",
  "qualified",
  "booked",
  "dead",
] as const

const MOCK_LEADS: LeadEnriched[] = [
  {
    id: "MOCK-LEAD-1",
    full_name: "Ana Ruiz",
    email: "ana.ruiz@example.com",
    phone: "+34 600 111 222",
    state: "new",
    last_touch_at: "2024-11-02T10:15:00Z",
    campaign_id: "CMP-42",
    campaign_name: "Q4 Retail Push",
    channel_last: "email",
  },
  {
    id: "MOCK-LEAD-2",
    full_name: "Carlos Soto",
    email: "carlos.soto@example.com",
    phone: "+34 600 333 444",
    state: "attempting",
    last_touch_at: "2024-11-01T16:45:00Z",
    campaign_id: "CMP-18",
    campaign_name: "ABM EMEA",
    channel_last: "whatsapp",
  },
  {
    id: "MOCK-LEAD-3",
    full_name: "Lucía Romero",
    email: "lucia.romero@example.com",
    phone: null,
    state: "qualified",
    last_touch_at: null,
    campaign_id: null,
    campaign_name: null,
    channel_last: "ads",
  },
]

function getLeadStatus(lead: LeadEnriched) {
  return (lead.state ?? "new").toLowerCase()
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

export default function LeadsPage() {
  const router = useRouter()

  const supabase = useMemo(() => {
    const hasEnv =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])

  const [leads, setLeads] = useState<LeadEnriched[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingMock, setUsingMock] = useState(!supabase)

  const [q, setQ] = useState("")
  const [status, setStatus] =
    useState<(typeof STATUS_OPTIONS)[number]>("All")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [newLeadOpen, setNewLeadOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)

  // --------- LOAD LEADS (reusable) ----------
  const loadLeads = useCallback(
    async (client = supabase) => {
      if (!client) {
        setLeads(MOCK_LEADS)
        setUsingMock(true)
        setLoading(false)
        return
      }

      setLoading(true)

      // 🔥 Fuente REAL: view lead_activity_summary
      const { data, error } = await client
        .from("lead_activity_summary")
        .select("*")
        .order("last_touch_at", { ascending: false })
        .limit(200)

      if (error) {
        console.error(error)
        setError(
          "No se pudo acceder a lead_activity_summary. Se muestran datos mock mientras ajustamos el contrato."
        )
        setLeads(MOCK_LEADS)
        setUsingMock(true)
      } else {
        const rows = (data ?? []) as LeadActivityRow[]

        // mapear la view -> tipo LeadEnriched que usa la tabla
        const mapped: LeadEnriched[] = rows.map((row) => ({
          id: row.lead_id,
          full_name: null, // aún no tenemos nombre, solo id + estado + canal
          email: null,
          phone: null,
          state: (row.state ?? "new") as LeadEnriched["state"],
          last_touch_at: row.last_touch_at,
          campaign_id: null,
          campaign_name: null,
          channel_last: row.last_channel ?? undefined,
        }))

        setLeads(mapped)
        setError(null)
        setUsingMock(false)
      }

      setLoading(false)
    },
    [supabase]
  )

  // primera carga
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!alive) return
      await loadLeads()
    })()
    return () => {
      alive = false
    }
  }, [loadLeads])

  // --------- FILTERED LIST ----------
  const filtered = leads.filter((lead) => {
    const searchText = q.trim().toLowerCase()

    if (searchText) {
      const matchesSearch =
        (lead.full_name ?? "").toLowerCase().includes(searchText) ||
        (lead.email ?? "").toLowerCase().includes(searchText) ||
        (lead.phone ?? "").toLowerCase().includes(searchText) ||
        (lead.campaign_name ?? "").toLowerCase().includes(searchText)

      if (!matchesSearch) return false
    }

    const leadStatus = getLeadStatus(lead)
    if (status !== "All" && leadStatus !== status) return false

    if (dateFrom) {
      const created = new Date(lead.last_touch_at ?? 0)
      if (
        Number.isFinite(created.getTime()) &&
        created < new Date(dateFrom)
      ) {
        return false
      }
    }

    if (dateTo) {
      const created = new Date(lead.last_touch_at ?? 0)
      if (
        Number.isFinite(created.getTime()) &&
        created > new Date(`${dateTo}T23:59:59`)
      ) {
        return false
      }
    }

    return true
  })

  // --------- HANDLERS ----------
  const handleSelectLead = (lead: LeadEnriched) => {
    if (!lead?.id) return
    console.log("selected lead", lead.id)
    router.push(`/leads/${lead.id}`)
  }

  const handleRefreshClick = () => {
    loadLeads()
  }

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
          </div>
        </div>

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
              leads={filtered}
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
