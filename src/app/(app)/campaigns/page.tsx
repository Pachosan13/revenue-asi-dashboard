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
  campaign_status: string
  is_running: boolean
  created_at: string
  kpis: CampaignKPI | null
}

type RuntimeRow = {
  campaign_id: string | null
  name: string | null
  type: string | null
  campaign_status: string | null
  is_running: boolean | null
  last_touch_run_at: string | null
}

type LeadgenRouting = {
  dealer_address: string
  radius_miles: number
  city_fallback: string
  active: boolean
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
    return supabaseBrowser()
  }, [])

  const [query, setQuery] = useState("")
  const [status, setStatus] = useState<CampaignStatus | "all">("all")
  const [type, setType] = useState<CampaignType | "all">("all")

  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)

  // -------------------------------
  // Load campaigns + KPIs
  // -------------------------------

  const loadCampaigns = useCallback(async () => {
    if (!supabase) {
      setCampaigns([])
      setRuntimeError("Missing Supabase client configuration")
      setLoading(false)
      return
    }

    setLoading(true)
    setRuntimeError(null)

    const { data: userRes, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userRes?.user) {
      setCampaigns([])
      setRuntimeError("Not authenticated")
      setLoading(false)
      return
    }

    const { data: membership, error: mErr } = await supabase
      .from("account_members")
      .select("account_id, role")
      .eq("user_id", userRes.user.id)
      .limit(1)
      .maybeSingle()

    if (mErr) {
      setCampaigns([])
      setRuntimeError(`Failed to resolve account membership: ${mErr.message}`)
      setLoading(false)
      return
    }

    const accountId = membership?.account_id ? String(membership.account_id) : null
    if (!accountId) {
      setCampaigns([])
      setRuntimeError("No account membership")
      setLoading(false)
      return
    }
    setAccountId(accountId)

    const [{ data: runtime, error: rErr }, { data: kpis }, { data: clTasks }, { data: orgSettings }] = await Promise.all([
      supabase
        .from("v_campaign_runtime_status_v1")
        .select("campaign_id,name,type,campaign_status,is_running,last_touch_run_at")
        .eq("account_id", accountId)
        .order("is_running", { ascending: false })
        .order("last_touch_run_at", { ascending: false })
        .limit(200),
      supabase.from("campaign_funnel_overview").select("*"),
      supabase
        .schema("lead_hunter")
        .from("craigslist_tasks_v1")
        .select("status,task_type,created_at")
        .eq("account_id", accountId)
        .eq("city", "miami")
        .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .limit(2000),
      supabase.from("org_settings").select("leadgen_routing").limit(1).maybeSingle(),
    ])

    if (rErr) {
      setCampaigns([])
      setRuntimeError(`Runtime view query failed: ${rErr.message}`)
      setLoading(false)
      return
    }

    const kpiMap = new Map<string, CampaignKPI>()
    ;(kpis ?? []).forEach((row: CampaignKPI) => {
      kpiMap.set(row.campaign_id, row)
    })

    const mapped = (runtime ?? []).map((row: RuntimeRow) => {
      const campaign_status = String(row?.campaign_status ?? "").toLowerCase().trim()
      const is_running = Boolean(row?.is_running)

      // “Live” is enabled campaigns (campaign_status='active'), not necessarily running.
      const mappedStatus = statusMap[campaign_status] ?? "draft"

      const rawType = String(row?.type ?? "outbound").toLowerCase().trim()
      const mappedType =
        rawType === "outbound" ||
        rawType === "nurture" ||
        rawType === "reactivation" ||
        rawType === "whatsapp" ||
        rawType === "sms" ||
        rawType === "email"
          ? (rawType as CampaignType)
          : ("outbound" as CampaignType)

      return {
        id: String(row.campaign_id ?? ""),
        name: row.name ?? "Untitled",
        type: mappedType,
        status: mappedStatus,
        campaign_status,
        is_running,
        // view is our runtime truth; use last_touch_run_at for activity sorting
        created_at: row.last_touch_run_at ?? "",
        kpis: row.campaign_id ? kpiMap.get(String(row.campaign_id)) ?? null : null,
      } as CampaignRow
    })

    const clRows = clTasks ?? []
    const clQueuedOrClaimed = clRows.some((t: any) => t?.status === "queued" || t?.status === "claimed")
    const clClaimed = clRows.some((t: any) => t?.status === "claimed")
    const clLast = clRows
      .map((t: any) => (typeof t?.created_at === "string" ? t.created_at : null))
      .filter(Boolean)
      .sort()
      .slice(-1)[0] as string | undefined

    const routing = (orgSettings as any)?.leadgen_routing as LeadgenRouting | null | undefined
    const radius = Number(routing?.radius_miles)
    const radiusMi = Number.isFinite(radius) && radius > 0 ? radius : 10
    const name = `Craigslist · Miami · ${radiusMi}mi · LeadGen`

    const craigslistMiami: CampaignRow = {
      id: "craigslist:miami",
      name,
      type: "outbound",
      status: clQueuedOrClaimed ? "live" : "paused",
      campaign_status: clQueuedOrClaimed ? "active" : "paused",
      is_running: Boolean(clClaimed),
      created_at: clLast ?? "",
      kpis: null,
    }

    setCampaigns([craigslistMiami, ...mapped])
    setLoading(false)
  }, [supabase])

  const startCraigslistMiami = useCallback(async () => {
    try {
      await fetch("/api/command-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "prende craigslist miami" }),
        credentials: "include",
      })
    } finally {
      await loadCampaigns()
    }
  }, [loadCampaigns])

  const stopCraigslistMiami = useCallback(async () => {
    try {
      await fetch("/api/command-os", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: "apaga craigslist miami" }),
        credentials: "include",
      })
    } finally {
      await loadCampaigns()
    }
  }, [loadCampaigns])

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
    const live = campaigns.filter((c) => c.campaign_status === "active").length
    const running = campaigns.filter((c) => c.is_running === true).length
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
      running,
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
          helper="Enabled campaigns"
          delta={`${summary.running} running`}
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
          {runtimeError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Runtime data unavailable</div>
                <div className="text-rose-200/80">{runtimeError}</div>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="gap-2"
                onClick={() => loadCampaigns()}
              >
                <RefreshCw size={14} /> Retry
              </Button>
            </div>
          ) : null}

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
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>

            <TableBody>

              {filtered.map((c) => {
                const k = c.kpis

                return (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer transition hover:bg-white/5"
                    onClick={() => {
                      if (c.id.startsWith("craigslist:")) return
                      router.push(`/campaigns/${c.id}`)
                    }}
                  >
                    {/* Name + type + status */}
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-semibold text-white flex items-center gap-2">
                          {c.name}
                          {!c.id.startsWith("craigslist:") ? (
                            <Link
                              href={`/leads?campaign_id=${c.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 text-xs"
                            >
                              Inbox <ArrowUpRight size={12} />
                            </Link>
                          ) : null}
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="capitalize">
                            {typeCopy[c.type]}
                          </Badge>

                          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${statusStyles[c.status]}`}>
                            <span className="h-2 w-2 rounded-full bg-current" />
                            {c.status}
                          </span>

                          {c.is_running ? (
                            <Badge variant="success" className="text-xs">
                              Running
                            </Badge>
                          ) : null}
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

                    {/* Actions */}
                    <TableCell className="text-right">
                      {c.id === "craigslist:miami" ? (
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              startCraigslistMiami()
                            }}
                          >
                            Start
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              stopCraigslistMiami()
                            }}
                          >
                            Stop
                          </Button>
                        </div>
                      ) : null}
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
