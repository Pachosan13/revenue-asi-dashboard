"use client"

import React, { useCallback, useEffect, useMemo, useState } from "react"
import { RefreshCw, Shield, Signal } from "lucide-react"
import { supabaseBrowser } from "@/lib/supabase"
import { Button, Card, CardContent, CardHeader, StatCard } from "@/components/ui-custom"

type JobRun = {
  id: string
  job_name?: string | null
  status?: string | null
  created_at?: string | null
  duration_ms?: number | null
}

type TouchRun = {
  id: string
  status?: string | null
  created_at?: string | null
}

export default function HealthPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    return hasEnv ? supabaseBrowser() : null
  }, [])
  const [runs, setRuns] = useState<JobRun[]>([])
  const [loading, setLoading] = useState(true)
  const [jobCounts, setJobCounts] = useState({ success: 0, failed: 0 })
  const [touchRun, setTouchRun] = useState<TouchRun | null>(null)
  const [lastJobRun, setLastJobRun] = useState<JobRun | null>(null)

  const refreshHealth = useCallback(async () => {
    if (!supabase) {
      setLoading(false)
      return
    }

    setLoading(true)
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    const [jobResp, touchResp] = await Promise.all([
      supabase
        .from("job_runs")
        .select("id, job_name, status, created_at, duration_ms")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase.from("touch_runs").select("id, status, created_at").order("created_at", { ascending: false }).limit(1),
    ])

    if (jobResp.error) {
      console.warn("Failed to load job_runs", jobResp.error)
      setRuns([])
      setJobCounts({ success: 0, failed: 0 })
      setLastJobRun(null)
    } else {
      const filtered = (jobResp.data ?? []).filter((run) => (run.created_at ?? "") >= since)
      const success = filtered.filter((run) => (run.status ?? "").toLowerCase() === "succeeded").length
      const failed = filtered.filter((run) => (run.status ?? "").toLowerCase() === "failed").length
      setRuns(jobResp.data ?? [])
      setJobCounts({ success, failed })
      setLastJobRun(jobResp.data?.[0] ?? null)
    }

    if (touchResp.error) {
      console.warn("Failed to load touch_runs", touchResp.error)
      setTouchRun(null)
    } else {
      setTouchRun(touchResp.data?.[0] ?? null)
    }

    setLoading(false)
  }, [supabase])

  useEffect(() => {
    void refreshHealth()
  }, [refreshHealth])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Systems</p>
          <h1 className="text-3xl font-semibold text-white">Health</h1>
          <p className="text-sm text-white/60">Heartbeat across cadences, enrichers, and dispatchers.</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-2"
          onClick={refreshHealth}
          aria-label="Refresh health"
        >
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Jobs"
          value={`${jobCounts.success} succeeded / ${jobCounts.failed} failed`}
          helper="job_runs last 24h"
          delta={supabase ? "Live" : "Offline"}
        />
        <StatCard
          label="Dispatch"
          value={
            touchRun
              ? `${touchRun.status ?? "pending"}`
              : supabase
                ? "No dispatch runs"
                : "Supabase env missing"
          }
          helper={
            touchRun?.created_at
              ? new Date(touchRun.created_at).toLocaleString()
              : "Watching cadence triggers"
          }
          delta={touchRun ? "Latest" : "Idle"}
        />
        <StatCard
          label="Run cadence"
          value={lastJobRun ? lastJobRun.status ?? "pending" : "No runs"}
          helper={lastJobRun?.created_at ? new Date(lastJobRun.created_at).toLocaleString() : "Cron via SQL"}
          delta={lastJobRun ? "Latest" : "Idle"}
        />
      </div>

      <Card>
        <CardHeader
          title="Recent checks"
          description="Edge functions and workers reporting back from Supabase"
          action={
            <div className="flex items-center gap-2 text-sm text-white/60">
              <Signal size={16} />
              {loading ? "Loading" : `${runs.length} pings`}
            </div>
          }
        />
        <CardContent className="space-y-3">
          {loading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((row) => (
                <div key={row} className="h-12 animate-pulse rounded-xl bg-white/5" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-emerald-400/40 bg-white/5 px-5 py-6 text-center">
              <p className="text-lg font-semibold text-white">No health signals yet</p>
              <p className="text-sm text-white/60">We will surface job_runs as they arrive.</p>
            </div>
          ) : (
            <div className="grid gap-2">
              {runs.map((run) => {
                const status = (run.status ?? "").toLowerCase()
                const ok = status === "succeeded" || status === "success"
                return (
                  <div
                    key={run.id}
                    className="flex items-center justify-between rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="space-y-1">
                      <p className="font-semibold text-white">{run.job_name ?? "Unknown job"}</p>
                      <p className="text-xs text-white/50">{new Date(run.created_at ?? "").toLocaleString()}</p>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-white/80">
                      <Shield size={16} className={ok ? "text-emerald-300" : "text-amber-300"} />
                      <span className={ok ? "text-emerald-200" : "text-amber-200"}>
                        {status || "pending"}
                      </span>
                      {typeof run.duration_ms === "number" && (
                        <span className="text-xs text-white/50">{Math.round(run.duration_ms)} ms</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
