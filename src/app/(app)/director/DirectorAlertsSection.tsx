"use client"

import React, { useMemo, useState } from "react"
import {
  Card,
  CardHeader,
  CardContent,
  Badge,
} from "@/components/ui-custom"

type Alert = {
  id: string
  created_at: string
  actor: string | null
  event_type: string | null
  importance: number | null
  payload: Record<string, any> | null
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr)
  return d.toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  })
}

function groupByDay(alerts: Alert[]) {
  const groups: Record<string, Alert[]> = {}
  alerts.forEach((a) => {
    const day = formatDate(a.created_at)
    if (!groups[day]) groups[day] = []
    groups[day].push(a)
  })
  return groups
}

function importanceColor(level: number | null) {
  if (!level) return "bg-white/10 text-white/60"
  if (level >= 8) return "bg-rose-600/30 text-rose-200 border border-rose-500/40"
  if (level >= 5) return "bg-amber-500/20 text-amber-200 border border-amber-400/40"
  return "bg-emerald-500/20 text-emerald-200 border border-emerald-400/40"
}

function DirectorAlertItem({ alert }: { alert: Alert }) {
  const payload = alert.payload ?? {}
  const label =
    payload.label ??
    payload.title ??
    alert.event_type ??
    "System Event"

  const time = new Date(alert.created_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  })

  const kpis =
    payload.kpis && typeof payload.kpis === "object"
      ? Object.entries(payload.kpis)
      : []

  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-3 hover:bg-white/10 transition">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider text-white/50">
            {alert.actor ?? "System"}
          </p>
          <p className="text-white font-semibold text-base">{label}</p>
        </div>
        <Badge
          className={`${importanceColor(
            alert.importance,
          )} text-xs px-2 py-0.5`}
        >
          {alert.importance ?? 1}
        </Badge>
      </div>

      <p className="text-xs text-white/40">{time}</p>

      {payload.notes ? (
        <p className="text-sm text-white/70">{payload.notes}</p>
      ) : null}

      {kpis.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {kpis.map(([key, value]) => (
            <span
              key={key}
              className="px-3 py-1 text-xs rounded-lg bg-white/10 text-white/80 border border-white/10"
            >
              {key}: <strong>{String(value)}</strong>
            </span>
          ))}
        </div>
      ) : null}

      <details className="text-xs text-white/50">
        <summary className="cursor-pointer">Payload completo</summary>
        <pre className="mt-2 whitespace-pre-wrap text-white/40">
          {JSON.stringify(payload, null, 2)}
        </pre>
      </details>
    </div>
  )
}

export function DirectorAlertsSection({ alerts }: { alerts: Alert[] }) {
  const [minImportance, setMinImportance] = useState(1)

  const filtered = useMemo(
    () => alerts.filter((a) => (a.importance ?? 1) >= minImportance),
    [alerts, minImportance],
  )

  const grouped = useMemo(() => groupByDay(filtered), [filtered])

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Director Brain – Alerts"
        description="Timeline de decisiones, señales y evaluaciones del sistema."
      />

      <CardContent className="space-y-6">
        {/* Filtro de importancia */}
        <div className="flex items-center gap-3">
          <p className="text-sm text-white/60">Min importance:</p>
          {[1, 3, 5, 7, 9].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setMinImportance(lvl)}
              className={`px-3 py-1 rounded-lg text-xs border ${
                minImportance === lvl
                  ? "bg-white/20 border-white/40"
                  : "bg-white/5 border-white/10"
              }`}
            >
              {lvl}+
            </button>
          ))}
        </div>

        {/* Agrupado por día */}
        {Object.entries(grouped).map(([day, dayAlerts]) => (
          <div key={day} className="space-y-3">
            <p className="text-sm text-white/50 font-semibold">
              {day}
            </p>

            <div className="space-y-4">
              {dayAlerts.map((alert) => (
                <DirectorAlertItem key={alert.id} alert={alert} />
              ))}
            </div>
          </div>
        ))}

        {alerts.length === 0 && (
          <p className="text-sm text-white/60">No alerts.</p>
        )}
      </CardContent>
    </Card>
  )
}
