"use client"

import React, { useEffect, useMemo, useState } from "react"
import { supabaseBrowser } from "@/lib/supabase"
import {
  Badge,
  Card,
  CardContent,
  CardHeader,
  StatCard,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"

const numberFormatter = new Intl.NumberFormat("en-US")
const dateTimeFormatter = new Intl.DateTimeFormat("es-ES", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

const leadStatesOrder = ["new", "enriched", "attempting", "engaged", "qualified", "booked", "dead"] as const

type LeadState = (typeof leadStatesOrder)[number]

type LeadStateSummaryRow = {
  campaign_id: string | null
  campaign_name: string | null
  state: LeadState
  total_leads: number
}

type LeadActivitySummaryRow = {
  lead_id: string
  state: string | null
  source: string | null
  niche: string | null
  city: string | null
  country_code: string | null
  last_channel: string | null
  last_status: string | null
  last_step: number | null
  last_touch_at: string | null
}

type TouchFunnelRow = {
  campaign_id: string | null
  campaign_name: string | null
  channel: string | null
  status: string | null
  touches: number
}

function useSupabaseClient() {
  const hasEnv =
    typeof process !== "undefined" &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  return useMemo(() => (hasEnv ? supabaseBrowser() : null), [hasEnv])
}

export default function DashboardPage() {
  const supabase = useSupabaseClient()
  const [stateSummary, setStateSummary] = useState<LeadStateSummaryRow[]>([])
  const [activity, setActivity] = useState<LeadActivitySummaryRow[]>([])
  const [funnel, setFunnel] = useState<TouchFunnelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    async function loadData() {
      if (!supabase) {
        setLoading(false)
        setError("Configura las variables de Supabase para ver datos reales.")
        return
      }

      setLoading(true)
      setError(null)

      const [stateResponse, activityResponse, funnelResponse] = await Promise.all([
        supabase
          .from("lead_state_summary")
          .select("campaign_id, campaign_name, state, total_leads")
          .order("state", { ascending: true }),
        supabase
          .from("lead_activity_summary")
          .select(
            "lead_id, state, source, niche, city, country_code, last_channel, last_status, last_step, last_touch_at",
          )
          .order("last_touch_at", { ascending: false })
          .limit(10),
        supabase
          .from("v_touch_funnel_by_campaign")
          .select("campaign_id, campaign_name, channel, status, touches")
          .order("campaign_name", { ascending: true }),
      ])

      if (!active) return

      if (stateResponse.error || activityResponse.error || funnelResponse.error) {
        const reason =
          stateResponse.error?.message ?? activityResponse.error?.message ?? funnelResponse.error?.message ??
          "No se pudieron cargar los datos."
        setError(reason)
      }

      setStateSummary((stateResponse.data ?? []) as LeadStateSummaryRow[])
      setActivity((activityResponse.data ?? []) as LeadActivitySummaryRow[])
      setFunnel((funnelResponse.data ?? []) as TouchFunnelRow[])
      setLoading(false)
    }

    loadData()
    return () => {
      active = false
    }
  }, [supabase])

  const totalLeads = stateSummary.reduce((sum, row) => sum + (row.total_leads ?? 0), 0)
  const stateCountMap = leadStatesOrder.reduce<Record<LeadState, number>>((acc, key) => {
    acc[key] = stateSummary.filter((row) => row.state === key).reduce((sum, row) => sum + row.total_leads, 0)
    return acc
  }, {
    new: 0,
    enriched: 0,
    attempting: 0,
    engaged: 0,
    qualified: 0,
    booked: 0,
    dead: 0,
  })

  const kpiCards = [
    {
      label: "Total leads",
      value: loading ? "--" : numberFormatter.format(totalLeads),
      helper: "Suma de todos los estados",
      delta: loading ? "Cargando" : "Vista operativa",
    },
    {
      label: "Attempting",
      value: loading ? "--" : numberFormatter.format(stateCountMap.attempting),
      helper: "Intentos activos",
      delta: loading ? "..." : "Secuencias",
    },
    {
      label: "Engaged",
      value: loading ? "--" : numberFormatter.format(stateCountMap.engaged),
      helper: "Respuestas recientes",
      delta: loading ? "..." : "Conversión",
    },
    {
      label: "Booked",
      value: loading ? "--" : numberFormatter.format(stateCountMap.booked),
      helper: "Próximas citas",
      delta: loading ? "..." : "Sin riesgo",
    },
    {
      label: "Dead",
      value: loading ? "--" : numberFormatter.format(stateCountMap.dead),
      helper: "Descartados",
      delta: loading ? "..." : "Revisar",
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Operating picture</p>
          <h1 className="text-3xl font-semibold text-white">Dashboard</h1>
          <p className="text-sm text-white/60">Estado vivo de la máquina de outbound: leads, toques y campañas.</p>
          {error ? <p className="mt-2 text-xs text-amber-200/80">{error}</p> : null}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        {kpiCards.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.1fr,0.9fr]">
        <Card>
          <CardHeader title="Últimos movimientos" description="Últimos 10 leads tocados" />
          <CardContent className="space-y-3">
            {activity.length === 0 && !loading ? (
              <p className="text-sm text-white/60">Sin actividad registrada.</p>
            ) : null}
            <div className="divide-y divide-white/5 rounded-xl border border-white/10 bg-white/5">
              {activity.map((item) => (
                <div key={item.lead_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-[220px] flex-1">
                    <p className="font-semibold text-white">Lead {item.lead_id}</p>
                    <p className="text-xs text-white/50">{item.source ?? "Sin origen"}</p>
                  </div>
                  <div className="flex items-center gap-2 text-sm text-white/70">
                    <Badge variant="neutral" className="bg-white/10 text-white/70 capitalize">
                      {item.last_channel ?? "sin canal"}
                    </Badge>
                    <Badge variant="neutral" className="bg-white/10 text-white/70">
                      {item.last_status ?? "sin estado"}
                    </Badge>
                  </div>
                  <div className="text-right text-xs text-white/50 ml-auto">
                    {item.last_touch_at ? dateTimeFormatter.format(new Date(item.last_touch_at)) : "Fecha desconocida"}
                  </div>
                </div>
              ))}
              {loading ? <div className="px-4 py-3 text-sm text-white/60">Cargando movimientos...</div> : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Health del motor" description="Breakdown por estado de lead" />
          <CardContent className="space-y-4">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Estado</TableHeaderCell>
                  <TableHeaderCell>Total</TableHeaderCell>
                  <TableHeaderCell>% del total</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {leadStatesOrder.map((stateKey) => {
                  const total = stateCountMap[stateKey]
                  const percentage = totalLeads > 0 ? Math.round((total / totalLeads) * 100) : 0
                  return (
                    <TableRow key={stateKey}>
                      <TableCell className="capitalize text-white">{stateKey}</TableCell>
                      <TableCell className="font-semibold text-white">{numberFormatter.format(total)}</TableCell>
                      <TableCell className="text-white/70">{percentage}%</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
            {loading ? <p className="text-xs text-white/60">Sincronizando métricas...</p> : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader title="Funnel por campaña & canal" description="Distribución de toques por status" />
        <CardContent>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Campaña</TableHeaderCell>
                <TableHeaderCell>Canal</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Touches</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {funnel.map((row, index) => (
                <TableRow key={`${row.campaign_id ?? "sin"}-${row.channel ?? "canal"}-${row.status ?? index}`}>
                  <TableCell className="font-semibold text-white">
                    {row.campaign_name ?? "Sin campaña"}
                  </TableCell>
                  <TableCell className="capitalize text-white/80">{row.channel ?? "sin canal"}</TableCell>
                  <TableCell className="text-white/70">{row.status ?? "sin status"}</TableCell>
                  <TableCell className="font-semibold text-white">{numberFormatter.format(row.touches)}</TableCell>
                </TableRow>
              ))}
              {funnel.length === 0 && !loading ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-white/60">
                    Sin registros para mostrar.
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          {loading ? <p className="mt-3 text-xs text-white/60">Armando funnel...</p> : null}
        </CardContent>
      </Card>
    </div>
  )
}
