"use client"

import React, { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { RefreshCw } from "lucide-react"

import { Card, CardContent, CardHeader, Button, Badge } from "@/components/ui-custom"

type ProgramRow = {
  key: string
  name: string
  status: "live" | "degraded" | "disabled" | string
  health?: {
    routing_active?: boolean
    worker_health?: boolean
    last_success_at?: string | null
  }
  kpis?: {
    leads_last_60m?: number
    tasks_success_rate_60m?: number | null
    time_to_first_touch_avg_minutes?: number | null
  }
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
          <p className="text-sm text-white/60">
            Programs generate leads (supply). Campaigns decide what to do with them.
          </p>
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
        <CardHeader
          title="Program Health"
          description="Programs generate supply. They do not contact leads."
        />
        <CardContent className="space-y-4">
          {error ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {error}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            {rows.map((p) => {
              const badge =
                p.status === "live" ? "LIVE" : p.status === "degraded" ? "DEGRADED" : "OFF"
              const leads60 = p.kpis?.leads_last_60m
              const sr = p.kpis?.tasks_success_rate_60m
              const ttf = p.kpis?.time_to_first_touch_avg_minutes
              return (
                <Card key={p.key}>
                  <CardHeader
                    title={
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-white font-semibold">
                          <Link href={`/programs/${encodeURIComponent(p.key)}`} className="hover:underline">
                            {p.name}
                          </Link>
                          <div className="text-[11px] text-white/45">{p.key}</div>
                        </div>
                        <Badge variant="outline">{badge}</Badge>
                      </div>
                    as any}
                    description="Programs generate supply. They do not contact leads."
                  />
                  <CardContent className="grid gap-2 text-sm text-white/70">
                    <div className="flex items-center justify-between">
                      <span>leads_last_60m</span>
                      <span className="text-white">{leads60 ?? "N/A"}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>tasks_success_rate_60m</span>
                      <span className="text-white">
                        {typeof sr === "number" ? `${(sr * 100).toFixed(1)}%` : "N/A"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>time_to_first_touch_avg</span>
                      <span className="text-white">
                        {typeof ttf === "number" ? `${ttf}m` : "N/A"}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
            {!rows.length && !loading ? (
              <div className="text-sm text-white/60">No programs found.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


