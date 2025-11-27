"use client"

import React, { useMemo, useState, useEffect, useCallback } from "react"
import { Plus, Search, Filter, FolderPlus, Rocket, RefreshCw } from "lucide-react"
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
} from "@/components/ui-custom"
import { supabaseBrowser } from "@/lib/supabase"
import { campaignsMock } from "./mock-data"
import { CampaignStatus, CampaignType } from "@/types/campaign"

type CampaignRow = {
  id?: string
  uuid?: string
  name?: string
  type?: CampaignType
  status?: CampaignStatus
  leads_count?: number
  target_leads?: number
  reply_rate?: number
  reply_rate_pct?: number
  meetings_booked?: number
  meetings?: number
  conversion?: number
  conversion_rate?: number
  created_at?: string
  inserted_at?: string
  error_rate?: number
  daily_throughput?: number
  leads_contacted?: number
  contacts_processed?: number
}

const statusStyles: Record<CampaignStatus, string> = {
  live: "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-200 border border-amber-400/30",
  draft: "bg-white/5 text-white/70 border border-white/15",
}

const typeCopy: Record<CampaignType, string> = {
  outbound: "Outbound",
  nurture: "Nurture",
  reactivation: "Reactivation",
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
}

export default function CampaignsPage() {
  const router = useRouter()

  const supabase = useMemo(() => {
    const hasEnv =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])

  const [type, setType] = useState<CampaignType | "all">("all")
  const [status, setStatus] = useState<CampaignStatus | "all">("all")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const [campaigns, setCampaigns] = useState<CampaignRow[]>([])
  const [runCounts, setRunCounts] = useState({ campaignRuns: 0, touchRuns: 0 })

  const loadCampaigns = useCallback(async () => {
    if (!supabase) {
      setCampaigns(campaignsMock)
      setLoading(false)
      return
    }

    setLoading(true)
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(200)

    if (error) {
      console.error("Failed to load campaigns", error)
      setCampaigns(campaignsMock)
      setLoading(false)
      return
    }

    const mapped = (data ?? []).map((row: CampaignRow) => {
      const fallbackType = (row.type ?? "outbound") as CampaignType
      return {
        id: String(row.id ?? row.uuid ?? crypto.randomUUID()),
        name: row.name ?? "Untitled campaign",
        type: fallbackType,
        status: (row.status ?? "draft") as CampaignStatus,
        leads_count: Number(row.leads_count ?? row.target_leads ?? 0) || 0,
        reply_rate: Number(row.reply_rate ?? row.reply_rate_pct ?? 0) || 0,
        meetings_booked: Number(row.meetings_booked ?? row.meetings ?? 0) || 0,
        conversion: Number(row.conversion ?? row.conversion_rate ?? 0) || 0,
        created_at: row.created_at ?? row.inserted_at ?? "",
        error_rate: Number(row.error_rate ?? 0) || undefined,
        daily_throughput: Number(row.daily_throughput ?? 0) || undefined,
        leads_contacted: Number(row.leads_contacted ?? row.contacts_processed ?? 0) || undefined,
      }
    })

    setCampaigns(mapped.length > 0 ? mapped : campaignsMock)
    setLoading(false)
  }, [supabase])

  const loadRunCounts = useCallback(async () => {
    if (!supabase) return
    const [{ count: campaignRuns }, { count: touchRuns }] = await Promise.all([
      supabase.from("campaign_runs").select("id", { head: true, count: "exact" }),
      supabase.from("touch_runs").select("id", { head: true, count: "exact" }),
    ])
    setRunCounts({
      campaignRuns: campaignRuns ?? 0,
      touchRuns: touchRuns ?? 0,
    })
  }, [supabase])

  useEffect(() => {
    void loadCampaigns()
    void loadRunCounts()
  }, [loadCampaigns, loadRunCounts])

  const filtered = useMemo(() => {
    return campaigns.filter((campaign) => {
      const matchesType = type === "all" || campaign.type === type
      const matchesStatus = status === "all" || campaign.status === status
      const matchesQuery =
        query.trim().length === 0 ||
        (campaign.name ?? "").toLowerCase().includes(query.toLowerCase())
      return matchesType && matchesStatus && matchesQuery
    })
  }, [campaigns, type, status, query])

  const summary = useMemo(() => {
    const total = campaigns.length
    const live = campaigns.filter((c) => c.status === "live").length
    const avgReply = campaigns.length
      ? Math.round(
          campaigns.reduce((acc, c) => acc + (c.reply_rate ?? 0), 0) /
            campaigns.length
        )
      : 0
    return { total, live, avgReply }
  }, [campaigns])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">
            Outbound command center
          </p>
          <h1 className="text-3xl font-semibold text-white">Campaigns</h1>
          <p className="text-sm text-white/60">
            Control cadence, copy, and throughput with the new neon console.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={loadCampaigns} className="gap-2">
            <RefreshCw size={16} />
            Refresh list
          </Button>

          <Link href="/campaigns/new" className="inline-flex">
            <Button variant="primary" size="md" className="gap-2">
              <Plus size={16} /> New campaign
            </Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Active"
          value={`${summary.live} live`}
          helper={`${runCounts.campaignRuns} recent runs`}
          delta="Synced"
        />
        <StatCard
          label="Reply rate"
          value={`${summary.avgReply}%`}
          helper="Rolling 7d across stacks"
          delta="+1.2%"
        />
        <StatCard
          label="Inventory"
          value={`${summary.total} programs`}
          helper={`${runCounts.touchRuns} touch runs observed`}
          delta="Stable"
        />
      </div>

      <Card>
        <CardHeader
          title="Programs"
          description="Filter by type, status, or search"
          action={
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Filter size={16} />
              Smart filters
            </div>
          }
        />
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1.2fr,1fr,1fr]">
            <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-black/40 px-3 py-2 shadow-inner shadow-black/40">
              <Search size={16} className="text-white/40" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search campaigns"
                className="border-none bg-transparent px-0 text-sm"
              />
            </div>

            <Select
              value={type}
              onChange={(e) =>
                setType(e.target.value as CampaignType | "all")
              }
            >
              <option value="all">All types</option>
              {Object.keys(typeCopy).map((key) => (
                <option key={key} value={key}>
                  {typeCopy[key as CampaignType]}
                </option>
              ))}
            </Select>

            <Select
              value={status}
              onChange={(e) =>
                setStatus(e.target.value as CampaignStatus | "all")
              }
            >
              <option value="all">All statuses</option>
              <option value="live">Live</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft</option>
            </Select>
          </div>

          {loading ? (
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              {[1, 2, 3].map((row) => (
                <div
                  key={row}
                  className="h-12 animate-pulse rounded-xl bg-white/5"
                />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-emerald-400/30 bg-white/5 px-6 py-10 text-center shadow-[0_20px_60px_rgba(16,185,129,0.15)]">
              <div className="rounded-full bg-emerald-500/20 p-3 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.4)]">
                <FolderPlus />
              </div>
              <p className="text-lg font-semibold text-white">
                No campaigns match
              </p>
              <p className="text-sm text-white/60">
                Adjust filters or launch a new outbound stream.
              </p>
              <Link href="/campaigns/new" className="inline-flex">
                <Button variant="primary" size="sm" className="gap-2">
                  <Rocket size={16} /> Start from template
                </Button>
              </Link>
            </div>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Name</TableHeaderCell>
                  <TableHeaderCell>Type</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Leads</TableHeaderCell>
                  <TableHeaderCell>Reply rate</TableHeaderCell>
                  <TableHeaderCell>Meetings</TableHeaderCell>
                  <TableHeaderCell>Conversion</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                </tr>
              </TableHead>

              <TableBody>
                {filtered.map((campaign) => (
                  <TableRow
                    key={campaign.id}
                    className="cursor-pointer"
                    onClick={() =>
                      router.push(`/campaigns/${campaign.id}`)
                    }
                  >
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-semibold text-white">
                          {campaign.name}
                        </p>
                        <p className="text-xs text-white/50">
                          {campaign.leads_contacted ?? 0} touched
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-white/70">
                      {typeCopy[campaign.type as CampaignType]}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${
                          statusStyles[campaign.status as CampaignStatus]
                        }`}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        {campaign.status}
                      </span>
                    </TableCell>
                    <TableCell>
                      {Number(campaign.leads_count ?? 0).toLocaleString()}
                    </TableCell>
                    <TableCell>{campaign.reply_rate ?? 0}%</TableCell>
                    <TableCell>{campaign.meetings_booked ?? 0}</TableCell>
                    <TableCell>{campaign.conversion ?? 0}%</TableCell>
                    <TableCell className="text-white/60">
                      {campaign.created_at}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
