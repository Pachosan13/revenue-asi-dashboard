"use client"

import React, { useEffect, useMemo, useState, useCallback } from "react"
import { useParams } from "next/navigation"
import Link from "next/link"
import { RefreshCw, ArrowLeft } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
import { Card, CardContent, CardHeader, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Button, Badge } from "@/components/ui-custom"

type ProgramDetail = {
  key: string
  program: string
  city?: string
  radius_mi?: number | null
  status: string
  health: {
    routing_active: boolean
    worker_health: boolean
    last_success_at: string | null
    autopilot_enabled: boolean
    next_action: string
  }
  throughput: {
    tasks_last_60m: { queued: number; claimed: number; done: number; failed: number; total: number }
    top_errors: { error: string; count: number }[]
  }
  output: {
    leads_last_60m: number
    leads_last_24h: number
    listings_last_60m: number | null
    listings_last_24h: number | null
  }
  events: any[]
}

export default function ProgramDetailPage() {
  const params = useParams<{ key: string }>()
  const programKey = useMemo(() => decodeURIComponent(String(params?.key ?? "")), [params?.key])

  const [data, setData] = useState<ProgramDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionMsg, setActionMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!programKey) return
    setLoading(true)
    setError(null)
    const res = await fetch(`/api/programs/${encodeURIComponent(programKey)}`, { credentials: "include" })
    const json = await res.json().catch(() => null)
    if (!res.ok || json?.ok !== true) {
      setData(null)
      setError(json?.error ?? "Failed to load program")
      setLoading(false)
      return
    }
    setData(json as ProgramDetail)
    setLoading(false)
  }, [programKey])

  useEffect(() => {
    void load()
  }, [load])

  const city = data?.city ?? "miami"

  const start = useCallback(async () => {
    setActionMsg(null)
    await fetch("/api/command-os", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ message: `prende craigslist ${city}` }),
    })
    setActionMsg("Start requested via Command OS.")
    await load()
  }, [city, load])

  const stop = useCallback(async () => {
    setActionMsg(null)
    await fetch("/api/command-os", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ message: `apaga craigslist ${city}` }),
    })
    setActionMsg("Stop requested via Command OS.")
    await load()
  }, [city, load])

  const runOnce = useCallback(async () => {
    setActionMsg(null)
    const supabase = supabaseBrowser()
    const { data: userRes, error: userErr } = await supabase.auth.getUser()
    if (userErr || !userRes?.user) {
      setActionMsg("Not authenticated.")
      return
    }
    const { data: membership, error: mErr } = await supabase
      .from("account_members")
      .select("account_id")
      .eq("user_id", userRes.user.id)
      .limit(1)
      .maybeSingle()
    if (mErr || !membership?.account_id) {
      setActionMsg("No account membership.")
      return
    }

    const accountId = String(membership.account_id)
    const { data: rpcData, error: rpcErr } = await supabase
      .schema("lead_hunter")
      .rpc("enqueue_craigslist_discover_v1", { p_account_id: accountId, p_city: city })

    if (rpcErr) {
      setActionMsg(`Run once failed: ${rpcErr.message}`)
      return
    }

    setActionMsg(`Enqueued discover task: ${String(rpcData)}`)
    await load()
  }, [city, load])

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link href="/campaigns" className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white">
            <ArrowLeft size={14} /> Back
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-3xl font-semibold text-white">{data?.program ?? "Program"}</h1>
            <Badge variant="neutral">{programKey}</Badge>
            <Badge variant="outline" className="capitalize">
              {data?.status ?? "—"}
            </Badge>
          </div>
          <p className="text-sm text-white/60">Health + throughput + output from real DB tables.</p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" className="gap-2" onClick={load} disabled={loading}>
            <RefreshCw size={14} /> Refresh
          </Button>
          <Button variant="secondary" size="sm" onClick={start}>
            Start
          </Button>
          <Button variant="ghost" size="sm" onClick={stop}>
            Stop
          </Button>
          <Button variant="outline" size="sm" onClick={runOnce}>
            Run once
          </Button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {actionMsg ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
          {actionMsg}
        </div>
      ) : null}

      {/* 3 cards: Health / Throughput / Output */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader title="Health" description="Routing + worker activity." />
          <CardContent className="space-y-2 text-sm text-white/70">
            <div>routing_active: {String(Boolean(data?.health?.routing_active))}</div>
            <div>worker_health: {String(Boolean(data?.health?.worker_health))}</div>
            <div>last_success_at: {data?.health?.last_success_at ?? "N/A"}</div>
            <div>next_action: {data?.health?.next_action ?? "—"}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Throughput" description="Tasks in last 60m." />
          <CardContent className="space-y-2 text-sm text-white/70">
            <div>queued: {data?.throughput?.tasks_last_60m?.queued ?? "—"}</div>
            <div>claimed: {data?.throughput?.tasks_last_60m?.claimed ?? "—"}</div>
            <div>done: {data?.throughput?.tasks_last_60m?.done ?? "—"}</div>
            <div>failed: {data?.throughput?.tasks_last_60m?.failed ?? "—"}</div>
            <div className="pt-2 text-xs text-white/50">
              top_errors: {(data?.throughput?.top_errors ?? []).slice(0, 3).map((e) => `${e.error}(${e.count})`).join(", ") || "—"}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Output" description="Leads created." />
          <CardContent className="space-y-2 text-sm text-white/70">
            <div>leads_last_60m: {data?.output?.leads_last_60m ?? "—"}</div>
            <div>leads_last_24h: {data?.output?.leads_last_24h ?? "—"}</div>
            <div>listings_last_60m: {data?.output?.listings_last_60m ?? "N/A"}</div>
            <div>listings_last_24h: {data?.output?.listings_last_24h ?? "N/A"}</div>
          </CardContent>
        </Card>
      </div>

      {/* Recent events */}
      <Card>
        <CardHeader title="Recent events" description="Last 20 task rows (best available evidence in repo-truth)." />
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>status</TableHeaderCell>
                <TableHeaderCell>task_type</TableHeaderCell>
                <TableHeaderCell>attempts</TableHeaderCell>
                <TableHeaderCell>claimed_by</TableHeaderCell>
                <TableHeaderCell>last_error</TableHeaderCell>
                <TableHeaderCell className="text-right">updated_at</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {(data?.events ?? []).map((e: any) => (
                <TableRow key={String(e.id)}>
                  <TableCell>{e.status ?? "—"}</TableCell>
                  <TableCell>{e.task_type ?? "—"}</TableCell>
                  <TableCell>{e.attempts ?? "—"}</TableCell>
                  <TableCell className="text-white/60">{e.claimed_by ?? "—"}</TableCell>
                  <TableCell className="text-white/60">{e.last_error ?? "—"}</TableCell>
                  <TableCell className="text-right text-white/60">{e.updated_at ? new Date(e.updated_at).toLocaleString() : "—"}</TableCell>
                </TableRow>
              ))}
              {!((data?.events ?? []).length) ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-sm text-white/60">
                    No recent tasks.
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


