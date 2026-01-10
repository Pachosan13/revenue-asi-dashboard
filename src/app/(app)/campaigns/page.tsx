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

type LeadGenProgramRow = {
  key: string
  name: string
  enabled: boolean
  last_started_at: string | null
}

type CampaignRow = {
  id: string
  name: string
  type: CampaignType
  is_active: boolean
  created_at: string
  kpis: CampaignKPI | null
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
  const [programs, setPrograms] = useState<LeadGenProgramRow[]>([])
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const [accountId, setAccountId] = useState<string | null>(null)
  const [confirmPauseAll, setConfirmPauseAll] = useState(false)

  // -------------------------------
  // Load campaigns + KPIs
  // -------------------------------

  const loadCampaigns = useCallback(async () => {
    if (!supabase) {
      setCampaigns([])
      setPrograms([])
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
      setPrograms([])
      setRuntimeError("No account membership")
      setLoading(false)
      return
    }
    setAccountId(accountId)

    const [{ data: outbound, error: oErr }, { data: kpis }, { data: orgSettings }, { data: clRecent, error: ldErr }] =
      await Promise.all([
        supabase
          .from("campaigns")
          .select("id,name,type,is_active,created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(200),
      supabase.from("campaign_funnel_overview").select("*"),
        supabase.from("org_settings").select("leadgen_routing").limit(1).maybeSingle(),
        supabase
          .schema("lead_hunter")
          .from("craigslist_tasks_v1")
          .select("status,task_type,created_at,updated_at")
          .eq("account_id", accountId)
          .eq("city", "miami")
          .in("status", ["queued", "claimed"])
          .gte("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
          .order("created_at", { ascending: false })
          .limit(50),
      ])

    if (oErr) {
      setCampaigns([])
      setPrograms([])
      setRuntimeError(`Failed to load campaigns: ${oErr.message}`)
      setLoading(false)
      return
    }

    if (ldErr) {
      setCampaigns([])
      setPrograms([])
      setRuntimeError(`Failed to load LeadGen program state: ${ldErr.message}`)
      setLoading(false)
      return
    }

    const kpiMap = new Map<string, CampaignKPI>()
    ;(kpis ?? []).forEach((row: CampaignKPI) => {
      kpiMap.set(row.campaign_id, row)
    })

    const mappedOutbound = (outbound ?? []).map((row: any) => {
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
        id: String(row.id),
        name: row.name ?? "Untitled",
        type: mappedType,
        is_active: Boolean(row.is_active),
        created_at: row.created_at ?? "",
        kpis: row.id ? kpiMap.get(String(row.id)) ?? null : null,
      } as CampaignRow
    })

    const routing = (orgSettings as any)?.leadgen_routing as LeadgenRouting | null | undefined
    const radius = Number(routing?.radius_miles)
    const radiusMi = Number.isFinite(radius) && radius > 0 ? radius : 10
    const city = String(routing?.city_fallback ?? "miami").trim().toLowerCase() || "miami"
    const programName = `Craigslist · ${city.charAt(0).toUpperCase() + city.slice(1)} · ${radiusMi}mi · LeadGen`

    const clRows = Array.isArray(clRecent) ? clRecent : []
    const enabled = clRows.some((t: any) => t?.status === "queued" || t?.status === "claimed")
    const lastStartedAt = clRows.length > 0 ? (clRows[0] as any)?.created_at ?? null : null

    setPrograms([
      {
        key: `craigslist:${city}:${radiusMi}mi`,
        name: programName,
        enabled,
        last_started_at: lastStartedAt,
      },
    ])
    setCampaigns(mappedOutbound)
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

  const toggleOutbound = useCallback(
    async (campaignId: string, desired: boolean) => {
      try {
        await fetch("/api/campaigns/toggle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ campaign_id: campaignId, is_active: desired }),
        })
      } finally {
        await loadCampaigns()
      }
    },
    [loadCampaigns],
  )

  const pauseAllRunning = useCallback(async () => {
    try {
      await fetch("/api/campaigns/toggle-bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ apply_to: "is_active_true", set_active: false, confirm: true }),
      })
    } finally {
      setConfirmPauseAll(false)
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
      const derivedStatus: CampaignStatus = c.is_active ? "live" : "paused"
      const matchesStatus = status === "all" || derivedStatus === status
      const matchesType = type === "all" || c.type === type
      return matchesQuery && matchesStatus && matchesType
    })
  }, [query, status, type, campaigns])

  // -------------------------------
  // Summary cards
  // -------------------------------

  const summary = useMemo(() => {
    const live = campaigns.filter((c) => c.is_active === true).length
    const running = live
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
          <p className="text-xs uppercase tracking-[0.16em] text-white/40">LeadGen</p>
          <h1 className="text-3xl font-semibold text-white">LeadGen</h1>
          <p className="text-sm text-white/60">Programs (sources) + outbound cadences. Same truth as Command OS.</p>
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
          helper="Enabled outbound campaigns"
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

      {/* LeadGen Programs */}
      <Card>
        <CardHeader title="Programs" description="Lead generation sources (scraping + ingestion). Not outbound cadences." />
        <CardContent className="space-y-4">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Program</TableHeaderCell>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">Last start</TableHeaderCell>
                <TableHeaderCell className="text-right">Actions</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {programs.map((p) => (
                <TableRow key={p.key} className="transition hover:bg-white/5">
                  <TableCell className="text-white font-semibold">
                    <Link href={`/programs/${encodeURIComponent(p.key)}`} className="hover:underline">
                      {p.name}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">LeadGen Program</Badge>
                  </TableCell>
                  <TableCell>
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${p.enabled ? statusStyles.live : statusStyles.paused}`}>
                      <span className="h-2 w-2 rounded-full bg-current" />
                      {p.enabled ? "Enabled" : "Disabled"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right text-white/60">{p.last_started_at ? new Date(p.last_started_at).toLocaleString() : "--"}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button variant="secondary" size="sm" onClick={() => startCraigslistMiami()}>
                        Start
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => stopCraigslistMiami()}>
                        Stop
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Outbound Campaigns */}
      <Card>
        <CardHeader
          title="Outbound Campaigns"
          description="Outbound cadences live in campaigns table. is_active is the only runtime truth."
          action={
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Filter size={16} />
              Smart filters
            </div>
          }
        />

        <CardContent className="space-y-4">
          <div className="flex items-center justify-end gap-2">
            {!confirmPauseAll ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setConfirmPauseAll(true)}
                disabled={summary.running === 0}
              >
                Pause all running
              </Button>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
                <span>Confirm pause all running?</span>
                <Button variant="secondary" size="sm" onClick={pauseAllRunning}>
                  Confirm
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmPauseAll(false)}>
                  Cancel
                </Button>
              </div>
            )}
          </div>
          {runtimeError ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200 flex items-center justify-between gap-3">
              <div>
                <div className="font-semibold">Data unavailable</div>
                <div className="text-rose-200/80">{runtimeError}</div>
              </div>
              <Button variant="secondary" size="sm" className="gap-2" onClick={() => loadCampaigns()}>
                <RefreshCw size={14} /> Retry
              </Button>
            </div>
          ) : null}

          {/* Search + selects */}
          <div className="grid gap-3 md:grid-cols-[1.2fr,1fr,1fr]">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 shadow-inner">
              <Search size={16} className="text-white/40" />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search campaigns" className="border-none bg-transparent px-0 text-sm" />
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
            </Select>
          </div>

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
                const derivedStatus: CampaignStatus = c.is_active ? "live" : "paused"

                return (
                  <TableRow key={c.id} className="cursor-pointer transition hover:bg-white/5" onClick={() => router.push(`/campaigns/${c.id}`)}>
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-semibold text-white flex items-center gap-2">
                          {c.name}
                          <Link href={`/leads?campaign_id=${c.id}`} onClick={(e) => e.stopPropagation()} className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 text-xs">
                            Inbox <ArrowUpRight size={12} />
                          </Link>
                        </p>
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">Outbound Campaign</Badge>
                          <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${statusStyles[derivedStatus]}`}>
                            <span className="h-2 w-2 rounded-full bg-current" />
                            {derivedStatus}
                          </span>
                        </div>
                      </div>
                    </TableCell>

                    <TableCell className="text-white/80">
                      {k ? (
                        <div className="space-y-1 text-sm">
                          <p>Attempting: {k.leads_attempting}</p>
                          <p>Engaged: {k.leads_engaged}</p>
                          <p>Booked: {k.leads_booked}</p>
                          <p className="text-xs text-white/40">Show {k.leads_booked_show} / No-show {k.leads_booked_no_show}</p>
                        </div>
                      ) : (
                        <span className="text-white/40">No data</span>
                      )}
                    </TableCell>

                    <TableCell className={`text-right text-sm font-semibold ${colorizeRate(k?.reply_rate ?? 0)}`}>{pct(k?.reply_rate)}</TableCell>
                    <TableCell className="text-right text-rose-300">{pct(k?.error_rate)}</TableCell>
                    <TableCell className="text-right text-white/70">{k?.total_touches ?? 0}</TableCell>
                    <TableCell className="text-right text-white/50">{k?.last_touch_at ? new Date(k.last_touch_at).toLocaleString() : "--"}</TableCell>

                    <TableCell className="text-right">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation()
                          toggleOutbound(c.id, !c.is_active)
                        }}
                      >
                        Toggle
                      </Button>
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
