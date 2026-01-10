"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"

import { Card, CardContent, CardHeader, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Button, Badge } from "@/components/ui-custom"

type ProgramRow = {
  key: string
  name: string
  status: "live" | "degraded" | "disabled" | string
  health?: {
    routing_active?: boolean
    worker_health?: boolean
    last_success_at?: string | null
  }
  throughput?: { tasks_last_60m?: { total?: number } }
  output?: { leads_last_60m?: number }
}

export default function ProgramsPage() {
  const [rows, setRows] = useState<ProgramRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    const res = await fetch("/api/programs/list", { credentials: "include" })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.ok !== true) {
      setRows([])
      setError(json?.error ?? "Failed to load programs")
      setLoading(false)
      return
    }
    setRows(Array.isArray(json?.programs) ? json.programs : [])
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  const summary = useMemo(() => {
    const live = rows.filter((r) => r.status === "live").length
    const degraded = rows.filter((r) => r.status === "degraded").length
    const disabled = rows.filter((r) => r.status === "disabled").length
    return { live, degraded, disabled, total: rows.length }
  }, [rows])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/40">LeadGen</p>
          <h1 className="text-3xl font-semibold text-white">Programs</h1>
          <p className="text-sm text-white/60">Lead generation sources (scraping + ingestion). Not outbound campaigns.</p>
        </div>
        <Button variant="secondary" size="sm" className="gap-2" onClick={load} disabled={loading}>
          <RefreshCw size={14} /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 text-sm text-white/60">
        <Badge variant="neutral">Total {summary.total}</Badge>
        <Badge variant="outline">Live {summary.live}</Badge>
        <Badge variant="warning">Degraded {summary.degraded}</Badge>
        <Badge variant="ghost">Disabled {summary.disabled}</Badge>
      </div>

      <Card>
        <CardHeader title="Programs" description="Click into a program for health + throughput + output." />
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Program</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Routing</TableHeaderCell>
                <TableHeaderCell>Worker</TableHeaderCell>
                <TableHeaderCell className="text-right">60m tasks</TableHeaderCell>
                <TableHeaderCell className="text-right">60m leads</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.key} className="transition hover:bg-white/5">
                  <TableCell className="text-white font-semibold">
                    <Link href={`/programs/${encodeURIComponent(p.key)}`} className="hover:underline">
                      {p.name}
                    </Link>
                    <div className="text-[11px] text-white/45">{p.key}</div>
                  </TableCell>
                  <TableCell className="capitalize">{p.status}</TableCell>
                  <TableCell>{p.health?.routing_active ? "on" : "off"}</TableCell>
                  <TableCell>{p.health?.worker_health ? "ok" : "—"}</TableCell>
                  <TableCell className="text-right">{p.throughput?.tasks_last_60m?.total ?? "—"}</TableCell>
                  <TableCell className="text-right">{p.output?.leads_last_60m ?? "—"}</TableCell>
                </TableRow>
              ))}
              {!rows.length && !loading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-white/60">
                    No programs found.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}


