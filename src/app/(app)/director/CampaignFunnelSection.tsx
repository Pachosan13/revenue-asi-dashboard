"use client"

import React, { useEffect, useState } from "react"
import { AlertTriangle, BarChart3, RefreshCw } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui-custom"

type CampaignFunnelRow = {
  campaign_id: string
  campaign_name: string | null
  total_touches: number
  leads_touched: number
  engaged_leads: number
  reply_rate: number
  error_rate: number
  leads_attempting: number
  leads_engaged: number
  leads_booked: number
  leads_booked_show: number
  leads_booked_no_show: number
  first_touch_at: string | null
  last_touch_at: string | null
}

function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0%"
  return `${(value * 100).toFixed(1)}%`
}

export function CampaignFunnelSection() {
  const [rows, setRows] = useState<CampaignFunnelRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const supabaseReady =
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL) &&
    Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)

  async function loadData() {
    if (!supabaseReady) {
      setError("Supabase no está configurado.")
      setRows([])
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)

    const client = supabaseBrowser()
    const { data, error: dbError } = await client
      .from("campaign_funnel_overview")
      .select(
        [
          "campaign_id",
          "campaign_name",
          "total_touches",
          "leads_touched",
          "engaged_leads",
          "reply_rate",
          "error_rate",
          "leads_attempting",
          "leads_engaged",
          "leads_booked",
          "leads_booked_show",
          "leads_booked_no_show",
          "first_touch_at",
          "last_touch_at",
        ].join(", "),
      )
      .order("last_touch_at", { ascending: false })

    if (dbError) {
      console.error(dbError)
      setError("No se pudo leer campaign_funnel_overview.")
      setRows([])
      setLoading(false)
      return
    }

    const typed = (data ?? []) as unknown as CampaignFunnelRow[]
    setRows(typed)
    setLoading(false)
  }

  useEffect(() => {
    void loadData()
  }, [])

  return (
    <Card>
      <CardHeader
        title="Campaign funnel"
        description="Resumen por campaña: touches, replies, bookings y errores."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => void loadData()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refrescar
          </Button>
        }
      />

      <CardContent className="space-y-4">
        {/* Icono decorativo arriba del contenido */}
        <div className="flex items-center gap-2 text-sm text-white/70">
          <BarChart3 size={16} />
          <span>Performance agregado por campaña</span>
        </div>

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-100">
            <AlertTriangle size={14} className="mt-0.5" />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <p className="text-sm text-white/60">Cargando campañas…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-white/60">
            No hay campañas con actividad aún.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((row) => (
              <div
                key={row.campaign_id}
                className="rounded-2xl border border-white/8 bg-white/5 p-4 backdrop-blur"
              >
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="truncate text-sm font-semibold text-white">
                    {row.campaign_name ?? "Sin nombre"}
                  </div>
                  <Badge variant="neutral">
                    {row.leads_touched} leads tocados
                  </Badge>
                </div>

                <div className="mb-3 flex flex-wrap gap-2 text-xs">
                  <Badge variant="success">
                    Reply rate {formatPercent(row.reply_rate)}
                  </Badge>
                  <Badge variant="warning">
                    Error rate {formatPercent(row.error_rate)}
                  </Badge>
                  <Badge variant="outline">
                    Touches {row.total_touches}
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="space-y-1">
                    <p className="text-white/60">Funnel</p>
                    <p>
                      <span className="text-white">Attempting:</span>{" "}
                      {row.leads_attempting}
                    </p>
                    <p>
                      <span className="text-white">Engaged:</span>{" "}
                      {row.leads_engaged}
                    </p>
                    <p>
                      <span className="text-white">Booked:</span>{" "}
                      {row.leads_booked}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-white/60">Appointments</p>
                    <p>
                      <span className="text-white">Show:</span>{" "}
                      {row.leads_booked_show}
                    </p>
                    <p>
                      <span className="text-white">No-show:</span>{" "}
                      {row.leads_booked_no_show}
                    </p>
                    <p>
                      <span className="text-white">Engaged leads:</span>{" "}
                      {row.engaged_leads}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
