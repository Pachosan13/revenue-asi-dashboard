"use client"

import React, { useEffect, useMemo, useState } from "react"
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

export default function HealthPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])
  const [runs, setRuns] = useState<JobRun[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true

    async function loadRuns() {
      if (!supabase) {
        setLoading(false)
        return
      }

      setLoading(true)
      const { data, error } = await supabase
        .from("job_runs")
        .select("id, job_name, status, created_at, duration_ms")
        .order("created_at", { ascending: false })
        .limit(6)

      if (!alive) return

      if (error) {
        console.error("Failed to load health runs", error)
        setRuns([])
      } else {
        setRuns(data ?? [])
      }
      setLoading(false)
    }

    loadRuns()
    return () => {
      alive = false
    }
  }, [supabase])

  const uptimes = useMemo(() => {
    const healthy = runs.filter((run) => (run.status ?? "").toLowerCase() === "succeeded").length
    return {
      success: healthy,
      total: runs.length,
    }
  }, [runs])

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
          onClick={() => window.location.reload()}
          aria-label="Refresh health"
        >
          <RefreshCw size={16} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Jobs"
          value={`${uptimes.success}/${uptimes.total || 1} succeeded`}
          helper="Latest job_runs"
          delta="Live"
        />
        <StatCard
          label="Dispatch"
          value="dispatch-touch"
          helper="Watching cadence triggers"
          delta="Online"
        />
        <StatCard label="Run cadence" value="run-cadence" helper="Cron via SQL" delta="Synced" />
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
