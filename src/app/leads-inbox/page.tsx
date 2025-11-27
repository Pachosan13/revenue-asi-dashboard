"use client"

import React, { useEffect, useMemo, useState } from "react"
import { AlertTriangle, RefreshCw } from "lucide-react"
import { supabaseBrowser } from "@/lib/supabase"
import { Card, CardContent, CardHeader, Input, Badge, Button } from "@/components/ui-custom"
import type { LeadEnriched } from "@/types/lead"
import { LeadInboxTable, type LeadInboxEntry } from "@/components/leads/LeadInboxTable"

const REQUIRED_FIELDS = ["id", "name/full_name", "email", "phone", "state", "last_touch_at", "campaign_id/name", "channel_last"]

const MOCK_LEADS: LeadInboxEntry[] = [
  {
    id: "MOCK-1001",
    name: "Ana Ruiz",
    email: "ana.ruiz@example.com",
    phone: "+34 600 111 222",
    status: "New",
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
    status: "Contacted",
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
    status: "Qualified",
    last_touch_at: null,
    campaign_id: null,
    campaign_name: null,
    channel_last: "ads",
    created_at: "2024-10-25T09:30:00Z",
  },
]

const mapLead = (row: Partial<LeadEnriched>): LeadInboxEntry => ({
  id: row.id ?? "",
  name: row.full_name ?? null,
  email: row.email ?? null,
  phone: row.phone ?? null,
  status: row.state ?? null,
  last_touch_at: row.last_touch_at ?? null,
  campaign_id: row.campaign_id ?? null,
  campaign_name: row.campaign_name ?? null,
  channel_last: row.channel_last ?? null,
  created_at: null,
})

function collectMissingFields(leads: LeadInboxEntry[]) {
  const missing = new Set<string>()

  leads.forEach((lead) => {
    if (!lead.id) missing.add("id")
    if (!lead.name) missing.add("name/full_name")
    if (!lead.email) missing.add("email")
    if (!lead.phone) missing.add("phone")
    if (!lead.status) missing.add("state")
    if (!lead.last_touch_at) missing.add("last_touch_at")
    if (!lead.campaign_id && !lead.campaign_name) missing.add("campaign_id/name")
    if (!lead.channel_last) missing.add("channel_last")
  })

  return Array.from(missing)
}

export default function LeadsInboxPage() {
  const supabaseReady = useMemo(() => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY), [])
  const [leads, setLeads] = useState<LeadInboxEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missingFields, setMissingFields] = useState<string[]>([])
  const [usingMock, setUsingMock] = useState(!supabaseReady)
  const [query, setQuery] = useState("")

  useEffect(() => {
    let alive = true

    async function loadLeads() {
      if (!supabaseReady) {
        if (!alive) return
        setLeads(MOCK_LEADS)
        setMissingFields(collectMissingFields(MOCK_LEADS))
        setLoading(false)
        setUsingMock(true)
        return
      }

      setLoading(true)
      const client = supabaseBrowser()
      const { data, error: dbError } = await client.from("lead_enriched").select("*").limit(100)

      if (!alive) return

      if (dbError) {
        console.error(dbError)
        setError("No se pudo acceder a lead_enriched. Proporciona el SQL/contrato o usa el mock.")
        setLeads(MOCK_LEADS)
        setMissingFields(collectMissingFields(MOCK_LEADS))
        setUsingMock(true)
        setLoading(false)
        return
      }

      const mapped = (data ?? []).map(mapLead)
      setLeads(mapped)
      setMissingFields(collectMissingFields(mapped))
      setUsingMock(false)
      setLoading(false)
    }

    loadLeads()
    return () => {
      alive = false
    }
  }, [supabaseReady])

  const filteredLeads = leads.filter((lead) => {
    const term = query.trim().toLowerCase()
    if (!term) return true
    return (
      lead.name?.toLowerCase().includes(term) ||
      lead.email?.toLowerCase().includes(term) ||
      lead.phone?.toLowerCase().includes(term) ||
      lead.campaign_name?.toLowerCase().includes(term) ||
      lead.channel_last?.toLowerCase().includes(term)
    )
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Leads Inbox</h1>
            <Badge variant="neutral">Listado</Badge>
          </div>
          <p className="text-sm text-white/60">Campos mínimos: {REQUIRED_FIELDS.join(", ")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => window.location.reload()} aria-label="Refrescar leads">
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </div>

      {!supabaseReady ? (
        <div className="flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-100">
          <AlertTriangle size={18} />
          <div>
            <p className="font-semibold">Supabase not configured, showing mock data</p>
            <p className="text-sm text-amber-200/90">Define NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY para usar datos reales.</p>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">Si la tabla no existe, comparte el contrato exacto. Se muestran mocks temporalmente.</p>
          </div>
        </div>
      ) : null}

      {missingFields.length > 0 ? (
        <Card>
          <CardHeader title="Campos faltantes" description="Se devuelven como null y se muestran en la tabla." />
          <CardContent className="flex flex-wrap gap-2">
            {missingFields.map((field) => (
              <Badge key={field} variant="warning">
                {field}
              </Badge>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Leads"
          description={usingMock ? "Mostrando mock para permitir QA." : "Datos listados desde lead_enriched."}
          action={<Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar por nombre, email o campaña" />}
        />
        <CardContent>
          <LeadInboxTable leads={filteredLeads} loading={loading} />
        </CardContent>
      </Card>
    </div>
  )
}
