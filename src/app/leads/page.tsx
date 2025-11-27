"use client"

import React, { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Filter, RefreshCw } from "lucide-react"
import { supabaseBrowser } from "@/lib/supabase"
import LeadTable from "@/components/LeadTable"
import type { LeadEnriched } from "@/types/lead"
import { Badge, Button, Card, CardContent, CardHeader, Input, Select } from "@/components/ui-custom"

const STATUS_OPTIONS = ["All", "new", "contacted", "qualified", "won", "lost"] as const

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
    state: "contacted",
    last_touch_at: "2024-11-01T16:45:00Z",
    campaign_id: "CMP-18",
    campaign_name: "ABM EMEA",
    channel_last: "phone",
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
  return lead.state ?? "New"
}

export default function LeadsPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])
  const [leads, setLeads] = useState<LeadEnriched[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingMock, setUsingMock] = useState(!supabase)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("All")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  useEffect(() => {
    let alive = true

    async function load() {
      if (!supabase) {
        setLeads(MOCK_LEADS)
        setUsingMock(true)
        setLoading(false)
        return
      }

      setLoading(true)
      const { data, error } = await supabase.from("lead_enriched").select("*").limit(200)

      if (!alive) return

      if (error) {
        console.error(error)
        setError("No se pudo acceder a lead_enriched. Proporciona el SQL/contrato o usa el mock.")
        setLeads(MOCK_LEADS)
        setUsingMock(true)
      } else {
        setLeads((data ?? []) as LeadEnriched[])
        setError(null)
        setUsingMock(false)
      }
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [supabase])

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

    const leadStatus = getLeadStatus(lead).toLowerCase()
    if (status !== "All" && leadStatus !== status) return false

    if (dateFrom) {
      const created = new Date(lead.last_touch_at ?? 0)
      if (Number.isFinite(created.getTime()) && created < new Date(dateFrom)) return false
    }
    if (dateTo) {
      const created = new Date(lead.last_touch_at ?? 0)
      if (Number.isFinite(created.getTime()) && created > new Date(`${dateTo}T23:59:59`)) return false
    }

    return true
  })

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-3xl font-semibold text-white">Leads Inbox</h1>
            <Badge variant="neutral">Up to date</Badge>
          </div>
          <p className="text-sm text-white/60">
            {loading ? "Cargando..." : `${filtered.length} leads visibles`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" aria-label="Refresh" onClick={() => window.location.reload()}>
            <RefreshCw size={16} />
            Refresh
          </Button>
          <Button variant="primary" size="sm">
            New lead
          </Button>
        </div>
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">Se muestran mocks temporalmente.</p>
          </div>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Filters"
          description={usingMock ? "Filtrando sobre datos mock." : "Filtra por estado y fecha del último toque."}
          action={
            <Button variant="ghost" size="sm">
              <Filter size={16} />
              Save view
            </Button>
          }
        />
        <CardContent className="grid gap-4 lg:grid-cols-4">
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.1em] text-white/50">Status</p>
            <Select value={status} onChange={(e) => setStatus(e.target.value as (typeof STATUS_OPTIONS)[number])}>
              {STATUS_OPTIONS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.1em] text-white/50">From</p>
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.1em] text-white/50">To</p>
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

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
            onSelect={(lead) => {
              console.log("selected lead", lead.id)
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
