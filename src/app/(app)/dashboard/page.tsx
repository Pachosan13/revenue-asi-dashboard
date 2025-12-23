"use client"

import React, { useEffect, useMemo, useState } from "react"
import { ArrowRight, RefreshCw } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"
import { StatCard } from "@/components/ui-custom/stat-card"

type LeadStateRow = {
  campaign_id: string | null
  campaign_name: string | null
  state: string
  total_leads: number
}

type LeadActivityRow = {
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

type FunnelRow = {
  campaign_id: string | null
  campaign_name: string | null
  channel: string | null
  status: string | null
  touches: number
}

export default function DashboardPage() {
  const supabase = useMemo(() => {
    const hasEnv =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    if (!hasEnv) return null
    return supabaseBrowser()
  }, [])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [stateRows, setStateRows] = useState<LeadStateRow[]>([])
  const [activityRows, setActivityRows] = useState<LeadActivityRow[]>([])
  const [funnelRows, setFunnelRows] = useState<FunnelRow[]>([])

  const usingMock = !supabase

  async function loadData() {
    if (!supabase) {
      setError("Supabase no configurado. Modo mock.")
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    try {
      // 1) lead_state_summary
      const { data: stateData, error: stateError } = await supabase
        .from("lead_state_summary")
        .select("*")

      if (stateError) throw stateError
      setStateRows((stateData ?? []) as LeadStateRow[])

      // 2) actividad reciente
      const { data: activityData, error: activityError } = await supabase
        .from("lead_activity_summary")
        .select("*")
        .order("last_touch_at", { ascending: false })
        .limit(10)

      if (activityError) throw activityError
      setActivityRows((activityData ?? []) as LeadActivityRow[])

      // 3) funnel por campaña / canal / status
      const { data: funnelData, error: funnelError } = await supabase
        .from("v_touch_funnel_by_campaign")
        .select("*")
        .order("touches", { ascending: false })
        .limit(50)

      if (funnelError) throw funnelError
      setFunnelRows((funnelData ?? []) as FunnelRow[])
    } catch (err: any) {
      console.error(err)
      setError(err.message ?? "Error cargando dashboard_overview")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase])

  // --- Derivados para los KPIs arriba ---

  const totalsByState = useMemo(() => {
    const acc: Record<string, number> = {}
    for (const row of stateRows) {
      const key = row.state?.toLowerCase() ?? "unknown"
      acc[key] = (acc[key] ?? 0) + Number(row.total_leads ?? 0)
    }
    return acc
  }, [stateRows])

  const totalLeads =
    Object.values(totalsByState).reduce((a, b) => a + b, 0) || 0

  const attempting = totalsByState["attempting"] ?? 0
  const engaged = totalsByState["engaged"] ?? 0
  const booked = totalsByState["booked"] ?? 0
  const dead = totalsByState["dead"] ?? 0

  const hotLeads = activityRows.slice(0, 5)

  return (
    <div className="space-y-6">
      {/* Top header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold text-white">
            Operating picture
          </h1>
          <p className="text-sm text-white/60">
            Estado en tiempo casi real del motor de Revenue ASI.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Badge variant={usingMock ? "warning" : "success"}>
            {usingMock ? "Mock mode" : "Live engine"}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            onClick={loadData}
            disabled={loading}
          >
            <RefreshCw size={16} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <span className="mt-0.5">⚠️</span>
          <div>
            <p className="font-semibold">Error en dashboard</p>
            <p className="text-sm text-red-200/90">{error}</p>
          </div>
        </div>
      ) : null}

      {/* KPI row */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Leads activos"
          value={`${totalLeads}`}
          helper="Con campaña"
        />
        <StatCard
          label="Attempting"
          value={`${attempting}`}
          helper="En secuencia de contacto"
        />
        <StatCard
          label="Engaged"
          value={`${engaged}`}
          helper="Respondieron / activos"
        />
        <StatCard
          label="Booked"
          value={`${booked}`}
          helper="Con cita / deal abierto"
        />
      </div>

      {/* Second row: Hot leads + Dead */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Hot leads */}
        <Card>
          <CardHeader
            title="Últimos movimientos"
            description="Leads tocados más recientemente por el motor."
          />
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Lead</TableHeaderCell>
                  <TableHeaderCell>Estado</TableHeaderCell>
                  <TableHeaderCell>Canal</TableHeaderCell>
                  <TableHeaderCell>Step</TableHeaderCell>
                  <TableHeaderCell>Último toque</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {hotLeads.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-white/60">
                      Aún no hay actividad registrada.
                    </TableCell>
                  </TableRow>
                ) : (
                  hotLeads.map((lead) => (
                    <TableRow key={lead.lead_id}>
                      <TableCell className="text-sm">
                        <span className="font-mono text-xs text-white/60">
                          {lead.lead_id.slice(0, 8)}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {lead.state ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm capitalize">
                        {lead.last_channel ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {lead.last_step ?? "—"}
                      </TableCell>
                      <TableCell className="text-sm">
                        {lead.last_touch_at
                          ? new Date(lead.last_touch_at).toLocaleString()
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Dead vs Attempting breakdown simple */}
        <Card>
          <CardHeader
            title="Health del motor"
            description="Distribución rápida por estado."
          />
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">Attempting</span>
              <span className="font-medium">{attempting}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">Engaged</span>
              <span className="font-medium">{engaged}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">Booked</span>
              <span className="font-medium">{booked}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white/70">Dead</span>
              <span className="font-medium text-red-300">{dead}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel by campaign / channel */}
      <Card>
        <CardHeader
          title="Funnel por campaña & canal"
          description="Resumen de toques por campaña, canal y estado."
          action={
            <Button
              variant="ghost"
              size="sm"
              onClick={loadData}
              disabled={loading}
            >
              <ArrowRight size={14} />
              Ver últimos datos
            </Button>
          }
        />
        <CardContent className="p-0">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Campaña</TableHeaderCell>
                <TableHeaderCell>Canal</TableHeaderCell>
                <TableHeaderCell>Status touch</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Touches
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {funnelRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-sm text-white/60">
                    Aún no hay datos de funnel.
                  </TableCell>
                </TableRow>
              ) : (
                funnelRows.map((row, idx) => (
                  <TableRow
                    key={`${row.campaign_id}-${row.channel}-${row.status}-${idx}`}
                  >
                    <TableCell className="text-sm">
                      {row.campaign_name ?? "Sin nombre"}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {row.channel ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm capitalize">
                      {row.status ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-right">
                      {row.touches}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
