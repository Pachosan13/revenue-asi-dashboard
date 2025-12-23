"use client"

import React, { useMemo, useState, useEffect, useCallback } from "react"
import { Search, Filter, RefreshCw, ChevronRight, ArrowUpRight, Plus } from "lucide-react"
import Link from "next/link"
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
  Button,
  Input,
  Select,
  StatCard,
  Badge,
} from "@/components/ui-custom"

import { supabaseBrowser } from "@/lib/supabase"
import { CampaignStatus, CampaignType } from "@/types/campaign"

// ------------------
// Types
// ------------------

type CampaignKPI = {
  campaign_id: string
  campaign_name: string | null
  total_touches: number
  leads_touched: number
  leads_attempting: number
  leads_engaged: number
  leads_booked: number
  leads_booked_show: number
  leads_booked_no_show: number
  reply_rate: number
  error_rate: number
  first_touch_at: string | null
  last_touch_at: string | null
}

type CampaignRow = {
  id: string
  name: string
  type: CampaignType
  status: CampaignStatus
  created_at: string
  kpis: CampaignKPI | null
}

// ------------------
// Mappings
// ------------------

const typeCopy: Record<CampaignType, string> = {
  outbound: "Outbound",
  nurture: "Nurture",
  reactivation: "Reactivation",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
}

const statusMap: Record<string, CampaignStatus> = {
  active: "live",
  paused: "paused",
  draft: "draft",
}

const statusStyles: Record<CampaignStatus, string> = {
  live: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  paused: "bg-amber-500/20 text-amber-300 border border-amber-500/30",
  draft: "bg-white/10 text-white/60 border border-white/20",
}

// ------------------
// Helpers
// ------------------

function pct(value: number | null | undefined) {
  if (!value || value <= 0) return "0%"
  return `${(value * 100).toFixed(1)}%`
}

function colorizeRate(rate: number) {
  if (rate >= 0.12) return "text-emerald-300"
  if (rate >= 0.05) return "text-amber-300"
  return "text-rose-400"
}

// ------------------
// Page Component
// ------------------

export default function CampaignsPage() {
  const router = useRouter()
  const supabase = useMemo(() => {
    const hasEnv =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return hasEnv ? supabaseBrowser() : null
  }, [])

  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<CampaignStatus | "all">("all")
  const [type, setType] = useState<CampaignType | "all">("all")

  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])

  // -------------------------------
  // Load campaigns + KPIs
  // -------------------------------

  const loadCampaigns = useCallback(async () => {
    if (!supabase) {
      setCampaigns([])
      setLoading(false)
      return
    }

    setLoading(true)

    const [{ data: base }, { data: kpis }] = await Promise.all([
      supabase.from("campaigns").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("campaign_funnel_overview").select("*"),
    ])

    const kpiMap = new Map<string, CampaignKPI>()
    ;(kpis ?? []).forEach((row: CampaignKPI) => {
      kpiMap.set(row.campaign_id, row)
    })

    const mapped = (base ?? []).map((row: any) => {
      const mappedStatus = statusMap[row.status] ?? "draft"
      const mappedType = (row.type ?? "outbound") as CampaignType

      return {
        id: row.id,
        name: row.name ?? "Untitled",
        type: mappedType,
        status: mappedStatus,
        created_at: row.created_at ?? "",
        kpis: kpiMap.get(row.id) ?? null,
      } as CampaignRow
    })

    setCampaigns(mapped)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadCampaigns()
  }, [loadCampaigns])

  // -------------------------------
  // Filters
  // -------------------------------

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      const matchesQuery = !query || c.name.toLowerCase().includes(query.toLowerCase())
      const matchesStatus = status === "all" || c.status === status
      const matchesType = type === "all" || c.type === type
      return matchesQuery && matchesStatus && matchesType
    })
  }, [query, status, type, campaigns])

  // -------------------------------
  // Summary cards
  // -------------------------------

  const summary = useMemo(() => {
    const live = campaigns.filter((c) => c.status === "live").length
    const avgReply =
      campaigns.length > 0
        ? (
            campaigns.reduce(
              (acc, c) => acc + (c.kpis?.reply_rate ?? 0),
              0,
            ) / campaigns.length
          ).toFixed(2)
        : 0

    return {
      live,
      total: campaigns.length,
      avgReply,
    }
  }, [campaigns])

  // -------------------------------
  // Render
  // -------------------------------

  return (
    <div className="space-y-6">

      {/* HEADER */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/40">
            Outbound Command Center
          </p>
          <h1 className="text-3xl font-semibold text-white">Campaigns</h1>
          <p className="text-sm text-white/60">
            Control throughput, copy, errors & funnel health in real time.
          </p>
        </div>

        {/* ⭐️ RESTORED BUTTON — EXACT SPOT WHERE IT BELONGS */}
        <Link href="/campaigns/new">
          <Button variant="primary" size="sm" className="gap-2">
            <Plus size={16} /> New campaign
          </Button>
        </Link>
      </div>

      {/* Summary cards */}
      <div className="grid gap-4 md:grid-cols-3">

        <StatCard
          label="Live"
          value={`${summary.live} active`}
          helper="Running campaigns"
          delta="Synced"
        />

        <StatCard
          label="Reply rate"
          value={`${(Number(summary.avgReply) * 100).toFixed(1)}%`}
          helper="Across all programs"
          delta="+1.2%"
        />

        <StatCard
          label="Inventory"
          value={`${summary.total} programs`}
          helper="Total available"
          delta="Stable"
        />
      </div>

      {/* Filters */}
      <Card>
        <CardHeader
          title="Programs"
          description="Filter by status, type, or search"
          action={
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Filter size={16} />
              Smart filters
            </div>
          }
        />

        <CardContent className="space-y-4">

          {/* Search + selects */}
          <div className="grid gap-3 md:grid-cols-[1.2fr,1fr,1fr]">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 shadow-inner">
              <Search size={16} className="text-white/40" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search campaigns"
                className="border-none bg-transparent px-0 text-sm"
              />
            </div>

            <Select value={type} onChange={(e) => setType(e.target.value as any)}>
              <option value="all">All types</option>
              {Object.keys(typeCopy).map((key) => (
                <option key={key} value={key}>
                  {typeCopy[key as CampaignType]}
                </option>
              ))}
            </Select>

            <Select value={status} onChange={(e) => setStatus(e.target.value as any)}>
              <option value="all">All statuses</option>
              <option value="live">Live</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft</option>
            </Select>
          </div>

          {/* Table */}
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Program</TableHeaderCell>
                <TableHeaderCell>Funnel</TableHeaderCell>
                <TableHeaderCell className="text-right">Reply</TableHeaderCell>
                <TableHeaderCell className="text-right">Errors</TableHeaderCell>
                <TableHeaderCell className="text-right">Touches</TableHeaderCell>
                <TableHeaderCell className="text-right">Last activity</TableHeaderCell>
              </TableRow>
            </TableHead>

            <TableBody>

              {filtered.map((c) => {
                const k = c.kpis

                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer transition hover:bg-white/5"
                    onClick={() => router.push(`/campaigns/${c.id}`)}
                  >
                    {/* Name + type + status */}
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-semibold text-white flex items-center gap-2">
                          {c.name}
                          <Link
                            href={`/leads?campaign_id=${c.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 text-xs"
                          >
                            Inbox <ArrowUpRight size={12} />
                          </Link>
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {typeCopy[c.type]}
                          </Badge>

                          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${statusStyles[c.status]}`}>
                            <span className="h-2 w-2 rounded-full bg-current" />
                            {c.status}
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    {/* Funnel summary */}
                    <TableCell className="text-white/80">
                      {k ? (
                        <div className="space-y-1 text-sm">
                          <p>Attempting: {k.leads_attempting}</p>
                          <p>Engaged: {k.leads_engaged}</p>
                          <p>Booked: {k.leads_booked}</p>
                          <p className="text-xs text-white/40">
                            Show {k.leads_booked_show} / No-show {k.leads_booked_no_show}
                          </p>
                        </div>
                      ) : (
                        <span className="text-white/40">No data</span>
                      )}
                    </TableCell>

                    {/* Reply rate */}
                    <TableCell className={`text-right text-sm font-semibold ${colorizeRate(k?.reply_rate ?? 0)}`}>
                      {pct(k?.reply_rate)}
                    </TableCell>

                    {/* Error rate */}
                    <TableCell className="text-right text-rose-300">
                      {pct(k?.error_rate)}
                    </TableCell>

                    {/* Total touches */}
                    <TableCell className="text-right text-white/70">
                      {k?.total_touches ?? 0}
                    </TableCell>

                    {/* Last touch */}
                    <TableCell className="text-right text-white/50">
                      {k?.last_touch_at ? new Date(k.last_touch_at).toLocaleString() : "--"}
                    </TableCell>

                  </TableRow>
                )
              })}

            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
