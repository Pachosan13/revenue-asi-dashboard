"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import { ArrowUpRight, Clock3, Mail, Phone } from "lucide-react"
import { supabaseBrowser } from "@/lib/supabase"
import { Badge, Card, CardContent, CardHeader, StatCard } from "@/components/ui-custom"

const DAY_MS = 24 * 60 * 60 * 1000

const numberFormatter = new Intl.NumberFormat("en-US")
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })

function startOfDay(date = new Date()) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

type LeadRow = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  status?: string | null
  created_at: string
  lead_raw_id?: string
}

type TouchRunRow = {
  id: string
  lead_id: string | null
  channel: string | null
  type?: string | null
  status: string | null
  payload?: Record<string, unknown> | null
  step?: number | null
  created_at: string
  sent_at: string | null
  error?: string | null
  meta?: Record<string, unknown> | null
}

type DashboardData = {
  leadsToday: number
  touchesToday: number
  booked: number
  errorEvents7d: number
  series: {
    date: string
    leads: number
    touches: number
    errors: number
  }[]
  recent: {
    id: string
    channel: string
    status: string
    timestamp: string
    leadName: string
    leadEmail: string | null
  }[]
}

function buildDashboardData(leads: LeadRow[], touches: TouchRunRow[]): DashboardData {
  const todayStart = startOfDay()
  const sevenDaysAgo = new Date(todayStart.getTime() - 6 * DAY_MS)
  const fourteenDaysAgo = new Date(todayStart.getTime() - 13 * DAY_MS)

  const leadsToday = leads.filter((lead) => new Date(lead.created_at) >= todayStart).length
  const touchesToday = touches.filter((touch) => {
    const sentDate = touch.sent_at ? new Date(touch.sent_at) : null
    const createdDate = new Date(touch.created_at)
    return (sentDate && sentDate >= todayStart) || createdDate >= todayStart
  }).length

  const errorEvents7d = touches.filter((touch) => {
    if (!touch.status) return false
    const eventDate = touch.sent_at ? new Date(touch.sent_at) : new Date(touch.created_at)
    return eventDate >= sevenDaysAgo && ["failed", "error"].includes(touch.status)
  }).length

  const seriesDays = Array.from({ length: 14 }, (_, idx) => {
    const day = new Date(fourteenDaysAgo.getTime() + idx * DAY_MS)
    return dateKey(day)
  })

  const leadsByDay = new Map(seriesDays.map((key) => [key, 0]))
  const touchesByDay = new Map(seriesDays.map((key) => [key, 0]))
  const errorsByDay = new Map(seriesDays.map((key) => [key, 0]))

  leads.forEach((lead) => {
    const key = dateKey(new Date(lead.created_at))
    if (leadsByDay.has(key)) {
      leadsByDay.set(key, (leadsByDay.get(key) ?? 0) + 1)
    }
  })

  touches.forEach((touch) => {
    const eventDate = touch.sent_at ? new Date(touch.sent_at) : new Date(touch.created_at)
    const key = dateKey(eventDate)
    if (touchesByDay.has(key)) {
      touchesByDay.set(key, (touchesByDay.get(key) ?? 0) + 1)
    }
    if (["failed", "error"].includes(touch.status ?? "") && errorsByDay.has(key)) {
      errorsByDay.set(key, (errorsByDay.get(key) ?? 0) + 1)
    }
  })

  const series = seriesDays.map((key) => ({
    date: key,
    leads: leadsByDay.get(key) ?? 0,
    touches: touchesByDay.get(key) ?? 0,
    errors: errorsByDay.get(key) ?? 0,
  }))

  const leadsMap = new Map<string, LeadRow>()
  leads.forEach((lead) => leadsMap.set(lead.id, lead))

  const recent = [...touches]
    .sort((a, b) => {
      const aDate = a.sent_at ? new Date(a.sent_at) : new Date(a.created_at)
      const bDate = b.sent_at ? new Date(b.sent_at) : new Date(b.created_at)
      return bDate.getTime() - aDate.getTime()
    })
    .slice(0, 20)
    .map((touch) => {
      const lead = touch.lead_id ? leadsMap.get(touch.lead_id) : null
      const eventDate = touch.sent_at ? new Date(touch.sent_at) : new Date(touch.created_at)
      return {
        id: touch.id,
        channel: touch.channel ?? "unknown",
        status: touch.status ?? "unknown",
        timestamp: eventDate.toISOString(),
        leadName: lead?.full_name ?? "Sin nombre",
        leadEmail: lead?.email ?? null,
      }
    })

  return {
    leadsToday,
    touchesToday,
    booked: 0,
    errorEvents7d,
    series,
    recent,
  }
}

function buildMockData() {
  const now = startOfDay()
  const leadMock: LeadRow[] = Array.from({ length: 20 }, (_, idx) => {
    const day = new Date(now.getTime() - (idx % 10) * DAY_MS)
    return {
      id: `lead-${idx + 1}`,
      full_name: `Lead ${idx + 1}`,
      email: `lead${idx + 1}@example.com`,
      phone: null,
      status: idx % 2 === 0 ? "New" : "Qualified",
      created_at: new Date(day.getTime() + 3 * 60 * 60 * 1000).toISOString(),
      lead_raw_id: `raw-${idx + 1}`,
    }
  })

  const touchMock: TouchRunRow[] = Array.from({ length: 28 }, (_, idx) => {
    const day = new Date(now.getTime() - (idx % 12) * DAY_MS)
    const sentAt = new Date(day.getTime() + (idx % 5) * 60 * 60 * 1000)
    const statusOptions = ["sent", "failed", "scheduled", "error"]
    return {
      id: `touch-${idx + 1}`,
      lead_id: `lead-${(idx % 10) + 1}`,
      channel: idx % 3 === 0 ? "voice" : "email",
      status: statusOptions[idx % statusOptions.length],
      type: "sequence",
      payload: null,
      step: idx % 4,
      created_at: day.toISOString(),
      sent_at: sentAt.toISOString(),
      error: idx % 7 === 0 ? "Simulated error" : null,
      meta: null,
    }
  })

  return buildDashboardData(leadMock, touchMock)
}

function renderChannelBadge(channel: string) {
  if (channel === "email") {
    return (
      <Badge variant="neutral" className="inline-flex items-center gap-2 bg-emerald-500/15 text-emerald-200">
        <Mail size={14} /> Email
      </Badge>
    )
  }
  if (channel === "voice") {
    return (
      <Badge variant="neutral" className="inline-flex items-center gap-2 bg-indigo-500/20 text-indigo-100">
        <Phone size={14} /> Voice
      </Badge>
    )
  }
  return (
    <Badge variant="neutral" className="inline-flex items-center gap-2 bg-white/10 text-white/60">
      <Clock3 size={14} /> {channel || "Unknown"}
    </Badge>
  )
}

function formatTimestamp(ts: string) {
  const date = new Date(ts)
  if (!Number.isFinite(date.getTime())) return "Fecha desconocida"
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
}

export default function DashboardPage() {
  const supabase = useMemo(() => {
    const hasEnv = process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])

  const [data, setData] = useState<DashboardData>(() => buildDashboardData([], []))
  const [loading, setLoading] = useState(true)
  const [usingMock, setUsingMock] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadDashboard() {
      if (!supabase) {
        if (!alive) return
        setData(buildMockData())
        setUsingMock(true)
        setLoading(false)
        return
      }

      setLoading(true)

      const fourteenDaysAgo = new Date(Date.now() - 13 * DAY_MS)

      const [leadResp, touchResp] = await Promise.all([
        supabase
          .from("lead_enriched")
          .select("id, full_name, email, phone, status, lead_raw_id, created_at")
          .gte("created_at", fourteenDaysAgo.toISOString()),
        supabase
          .from("touch_runs")
          .select("id, lead_id, channel, status, type, payload, step, created_at, sent_at, error, meta")
          .gte("created_at", fourteenDaysAgo.toISOString()),
      ])

      if (!alive) return

      if (leadResp.error || touchResp.error) {
        console.warn("Dashboard data fallback", leadResp.error ?? touchResp.error)
        setData(buildMockData())
        setUsingMock(true)
      } else {
        setData(buildDashboardData((leadResp.data ?? []) as LeadRow[], (touchResp.data ?? []) as TouchRunRow[]))
        setUsingMock(false)
      }
      setLoading(false)
    }

    loadDashboard()
    return () => {
      alive = false
    }
  }, [supabase])

  const statCards = [
    {
      label: "Leads nuevos hoy",
      value: loading ? "--" : numberFormatter.format(data.leadsToday),
      helper: "lead_enriched desde medianoche",
      delta: loading ? "..." : "+0 vs ayer",
    },
    {
      label: "Touches enviados hoy",
      value: loading ? "--" : numberFormatter.format(data.touchesToday),
      helper: "touch_runs por sent_at o created_at",
      delta: loading ? "..." : "Workflow",
    },
    {
      label: "Booked / appointments",
      value: "0",
      helper: "TODO: no existe campo de booked en contrato",
      delta: "Placeholder",
    },
    {
      label: "Errores últimos 7d",
      value: loading ? "--" : numberFormatter.format(data.errorEvents7d),
      helper: "touch_runs con status failed/error",
      delta: loading ? "..." : "Incidentes",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Command Center</p>
          <h1 className="text-3xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-white/60">
            KPIs conectados a lead_enriched y touch_runs. Placeholder activo para bookings.
          </p>
          {usingMock ? (
            <p className="mt-2 text-xs text-amber-200/80">
              Supabase no configurado o con errores. Mostrando mock para QA visual.
            </p>
          ) : null}
        </div>
        <button className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:border-emerald-400/60">
          Create note
          <ArrowUpRight size={16} />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {statCards.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[2fr,1fr]">
        <Card>
          <CardHeader title="Series 14 días" description="Leads creados, touches enviados, y errores diarios" />
          <CardContent className="h-[320px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={data.series} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorTouches" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f87171" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#f87171" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff0f" />
                <XAxis
                  dataKey="date"
                  tickFormatter={(value) => dateFormatter.format(new Date(value))}
                  stroke="#ffffff55"
                  tickLine={false}
                  tickMargin={8}
                />
                <YAxis stroke="#ffffff55" tickLine={false} tickMargin={8} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#0b1322", border: "1px solid #1f2937", borderRadius: 12 }}
                  labelFormatter={(label) => dateFormatter.format(new Date(label))}
                  formatter={(value, key) => [value as number, key]}
                />
                <Legend />
                <Area type="monotone" dataKey="leads" name="Leads" stroke="#10b981" fill="url(#colorLeads)" />
                <Area type="monotone" dataKey="touches" name="Touches" stroke="#8b5cf6" fill="url(#colorTouches)" />
                <Area type="monotone" dataKey="errors" name="Errores" stroke="#f87171" fill="url(#colorErrors)" />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Notas de integridad" description="Reglas del contrato de datos aplicado" />
          <CardContent className="space-y-3 text-sm text-white/70">
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="font-semibold text-white">Error rate</p>
              <p className="text-xs text-white/60">
                Solo se cuentan touch_runs con status “failed” o “error” en los últimos 7 días. Otros estados se ignoran.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="font-semibold text-white">Bookings</p>
              <p className="text-xs text-white/60">
                No existe campo de booked/appointments en lead_enriched ni touch_runs. KPI fijo en 0 hasta que exista columna.
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-3">
              <p className="font-semibold text-white">Canales</p>
              <p className="text-xs text-white/60">
                Se muestran badges “email” y “voice” según contrato. Valores inesperados se marcan en gris.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader title="Actividad reciente" description="Últimos 20 touch_runs por fecha de envío o creación" />
        <CardContent className="space-y-3">
          {data.recent.length === 0 && !loading ? (
            <p className="text-sm text-white/60">No hay actividad registrada.</p>
          ) : null}
          <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
            {data.recent.map((item) => (
              <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="flex-1 min-w-[200px] space-y-1">
                  <p className="font-semibold text-white">{item.leadName}</p>
                  <p className="text-xs text-white/50">{item.leadEmail ?? "Sin email"}</p>
                </div>
                <div className="flex items-center gap-2 text-sm text-white/70">
                  {renderChannelBadge(item.channel)}
                  <Badge variant="neutral" className="bg-white/10 text-white/70">
                    {item.status}
                  </Badge>
                </div>
                <div className="text-right text-xs text-white/50 ml-auto">{formatTimestamp(item.timestamp)}</div>
              </div>
            ))}
            {loading ? (
              <div className="px-4 py-3 text-sm text-white/60">Cargando actividad...</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
