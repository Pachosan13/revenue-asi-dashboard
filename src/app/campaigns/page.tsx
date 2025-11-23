"use client"

import React, { useMemo, useState, useEffect } from "react"
import { Plus, Search, Filter, FolderPlus, Rocket } from "lucide-react"
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
import { campaignsMock } from "./mock-data"
import { CampaignStatus, CampaignType } from "@/types/campaign"

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
  const [type, setType] = useState<CampaignType | "all">("all")
  const [status, setStatus] = useState<CampaignStatus | "all">("all")
  const [query, setQuery] = useState("")
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    const timer = setTimeout(() => setLoading(false), 450)
    return () => clearTimeout(timer)
  }, [])

  const filtered = useMemo(() => {
    return campaignsMock.filter((campaign) => {
      const matchesType = type === "all" || campaign.type === type
      const matchesStatus = status === "all" || campaign.status === status
      const matchesQuery =
        query.trim().length === 0 || campaign.name.toLowerCase().includes(query.toLowerCase())
      return matchesType && matchesStatus && matchesQuery
    })
  }, [type, status, query])

  const summary = useMemo(() => {
    const total = campaignsMock.length
    const live = campaignsMock.filter((c) => c.status === "live").length
    const avgReply = Math.round(
      campaignsMock.reduce((acc, c) => acc + c.reply_rate, 0) / campaignsMock.length,
    )
    return { total, live, avgReply }
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Outbound command center</p>
          <h1 className="text-3xl font-semibold text-white">Campaigns</h1>
          <p className="text-sm text-white/60">Control cadence, copy, and throughput with the new neon console.</p>
        </div>
        <Link href="/campaigns/new" className="inline-flex">
          <Button variant="primary" size="md" className="gap-2">
            <Plus size={16} /> New campaign
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Active" value={`${summary.live} live`} helper="Neon ops online" delta="+3 launched" />
        <StatCard label="Reply rate" value={`${summary.avgReply}%`} helper="Rolling 7d across stacks" delta="+1.2%" />
        <StatCard label="Inventory" value={`${summary.total} programs`} helper="Outbound, nurture, reactivation" delta="Stable" />
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
            <Select value={type} onChange={(e) => setType(e.target.value as CampaignType | "all")}> 
              <option value="all">All types</option>
              {Object.keys(typeCopy).map((key) => (
                <option key={key} value={key}>
                  {typeCopy[key as CampaignType]}
                </option>
              ))}
            </Select>
            <Select value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus | "all")}>
              <option value="all">All statuses</option>
              <option value="live">Live</option>
              <option value="paused">Paused</option>
              <option value="draft">Draft</option>
            </Select>
          </div>

          {loading ? (
            <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
              {[1, 2, 3].map((row) => (
                <div key={row} className="h-12 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-emerald-400/30 bg-white/5 px-6 py-10 text-center shadow-[0_20px_60px_rgba(16,185,129,0.15)]">
              <div className="rounded-full bg-emerald-500/20 p-3 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.4)]">
                <FolderPlus />
              </div>
              <p className="text-lg font-semibold text-white">No campaigns match</p>
              <p className="text-sm text-white/60">Adjust filters or launch a new outbound stream.</p>
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
                    onClick={() => router.push(`/campaigns/${campaign.id}`)}
                  >
                    <TableCell>
                      <div className="space-y-1">
                        <p className="font-semibold text-white">{campaign.name}</p>
                        <p className="text-xs text-white/50">{campaign.leads_contacted ?? 0} touched</p>
                      </div>
                    </TableCell>
                    <TableCell className="capitalize text-white/70">{typeCopy[campaign.type]}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs ${statusStyles[campaign.status]}`}
                      >
                        <span className="h-2 w-2 rounded-full bg-current" />
                        {campaign.status}
                      </span>
                    </TableCell>
                    <TableCell>{campaign.leads_count.toLocaleString()}</TableCell>
                    <TableCell>{campaign.reply_rate}%</TableCell>
                    <TableCell>{campaign.meetings_booked}</TableCell>
                    <TableCell>{campaign.conversion}%</TableCell>
                    <TableCell className="text-white/60">{campaign.created_at}</TableCell>
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
