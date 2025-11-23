"use client"

import React, { useEffect, useMemo, useState } from "react"
import { Filter, RefreshCw } from "lucide-react"
import { supabaseBrowser } from "@/lib/supabase"
import LeadTable from "@/components/LeadTable"
import type { LeadEnriched } from "@/types/lead"
import { Badge, Button, Card, CardContent, CardHeader, Input, Select } from "@/components/ui-custom"

const STATUS_OPTIONS = ["All", "New", "Contacted", "Qualified"] as const

function getLeadStatus(lead: LeadEnriched) {
  const confidence = lead.confidence ?? 0
  if (confidence >= 0.8) return "Qualified"
  if (confidence >= 0.5) return "Contacted"
  return "New"
}

export default function LeadsPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])
  const [leads, setLeads] = useState<LeadEnriched[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<(typeof STATUS_OPTIONS)[number]>("All")
  const [confidence, setConfidence] = useState(30)
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  useEffect(() => {
    let alive = true

    async function load() {
      if (!supabase) {
        setLoading(false)
        return
      }

      setLoading(true)
      const { data, error } = await supabase
        .from("lead_enriched")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200)

      if (!alive) return

      if (error) {
        console.error(error)
        setLeads([])
      } else {
        setLeads((data ?? []) as LeadEnriched[])
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
        (lead.company ?? "").toLowerCase().includes(searchText) ||
        (lead.email ?? "").toLowerCase().includes(searchText) ||
        (lead.phone ?? "").toLowerCase().includes(searchText) ||
        (lead.location ?? "").toLowerCase().includes(searchText)
      if (!matchesSearch) return false
    }

    const leadStatus = getLeadStatus(lead)
    if (status !== "All" && leadStatus !== status) return false

    if ((lead.confidence ?? 0) * 100 < confidence) return false

    if (dateFrom) {
      const created = new Date(lead.created_at)
      if (Number.isFinite(created.getTime()) && created < new Date(dateFrom)) return false
    }
    if (dateTo) {
      const created = new Date(lead.created_at)
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
          <Button variant="outline" size="sm" aria-label="Refresh">
            <RefreshCw size={16} />
            Refresh
          </Button>
          <Button variant="primary" size="sm">
            New lead
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader
          title="Filters"
          description="Tighten the funnel view by status, confidence, and created date."
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
            <div className="flex items-center justify-between text-xs uppercase tracking-[0.1em] text-white/50">
              <span>Confidence</span>
              <span className="font-semibold text-white/70">{confidence}%+</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={confidence}
              onChange={(e) => setConfidence(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
            <p className="text-xs text-white/50">Keep the strongest signals in focus.</p>
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
              placeholder="Buscar por nombre, empresa, email..."
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
