"use client"

import React, { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Clock4, Mail, PhoneCall, ServerCrash } from "lucide-react"

import { supabaseBrowser } from "@/lib/supabase"
import { Badge, Card, CardContent, CardHeader } from "@/components/ui-custom"
import { channelLabel, fetchLeadTouchRuns, formatPreview, getWhen, statusVariant, type TouchRunRow } from "./timeline-utils"

type LeadTimelineProps = {
  leadId: string
  leadName?: string | null
}

const MOCK_TIMELINE: TouchRunRow[] = [
  {
    id: "mock-touch-1",
    campaign_id: null,
    campaign_run_id: null,
    lead_id: "mock-lead",
    channel: "email",
    status: "sent",
    payload: { subject: "Bienvenida", message: "Hola, gracias por tu interés" },
    created_at: "2024-11-01T08:00:00Z",
    scheduled_at: "2024-11-01T08:00:00Z",
    sent_at: "2024-11-01T08:00:00Z",
    step: 1,
    error: null,
    meta: null,
  },
  {
    id: "mock-touch-2",
    campaign_id: null,
    campaign_run_id: null,
    lead_id: "mock-lead",
    channel: "voice",
    status: "failed",
    payload: { attempt: 1, note: "No contestó" },
    created_at: "2024-11-02T10:15:00Z",
    scheduled_at: null,
    sent_at: null,
    step: 2,
    error: "Sin respuesta",
    meta: null,
  },
  {
    id: "mock-touch-3",
    campaign_id: null,
    campaign_run_id: null,
    lead_id: "mock-lead",
    channel: "email",
    status: "scheduled",
    payload: { reminder_at: "2024-11-03T09:00:00Z" },
    created_at: "2024-11-02T18:45:00Z",
    scheduled_at: "2024-11-03T09:00:00Z",
    sent_at: "2024-11-03T09:00:00Z",
    step: 3,
    error: null,
    meta: null,
  },
]

function formatDateTime(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function channelIcon(channel?: string | null) {
  if (channel === "voice") return <PhoneCall size={16} />
  if (channel === "email") return <Mail size={16} />
  return <Clock4 size={16} />
}

export function LeadTimeline({ leadId, leadName }: LeadTimelineProps) {
  const supabaseReady = useMemo(
    () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    [],
  )
  const [touches, setTouches] = useState<TouchRunRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true

    async function load() {
      if (!leadId) return
      setLoading(true)
      setError(null)

      if (!supabaseReady) {
        if (!alive) return
        setTouches(MOCK_TIMELINE)
        setError("Supabase no está configurado. Mostrando timeline de ejemplo.")
        setLoading(false)
        return
      }

      const client = supabaseBrowser()
      const { data, error: dbError } = await fetchLeadTouchRuns(client, leadId)

      if (!alive) return

      if (dbError) {
        console.error(dbError)
        setError("No se pudo obtener el timeline de touch_runs para el lead")
        setTouches([])
        setLoading(false)
        return
      }

      setTouches((data ?? []) as TouchRunRow[])
      setLoading(false)
    }

    load()
    return () => {
      alive = false
    }
  }, [leadId, supabaseReady])

  return (
    <Card>
      <CardHeader
        title={`Timeline de ${leadName ?? leadId}`}
        description="Eventos recientes de touch_runs ordenados por envío o creación"
      />
      <CardContent className="space-y-4">
        {error ? (
          <div className="flex items-start gap-2 rounded-lg bg-red-500/10 p-3 text-red-100">
            <AlertTriangle size={16} className="mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        ) : null}

        {loading ? <p className="text-sm text-white/70">Cargando timeline...</p> : null}

        {!loading && touches.length === 0 ? (
          <p className="text-sm text-white/70">No hay eventos de touch_runs para este lead.</p>
        ) : null}

        <div className="space-y-3">
          {touches.map((touch) => {
            const timestamp = formatDateTime(getWhen(touch))
            return (
              <div
                key={touch.id}
                className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/5 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.3)]"
              >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-white">
                      <div className="rounded-full bg-white/10 p-2 text-emerald-300">{channelIcon(touch.channel)}</div>
                      <div>
                        <p className="font-semibold">{channelLabel[touch.channel ?? ""] ?? "Evento"}</p>
                        <p className="text-xs text-white/60">Paso #{touch.step ?? "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusVariant(touch.status)} className="capitalize">
                        {touch.status ?? "Sin estado"}
                      </Badge>
                      <span className="text-xs text-white/60">{timestamp}</span>
                    </div>
                  </div>

                  <div className="space-y-1 text-sm text-white/80">
                    <div className="flex items-start gap-2">
                      <span className="text-xs uppercase tracking-[0.14em] text-white/50">Payload</span>
                      <span className="flex-1 break-words text-white/80">{formatPreview(touch.payload)}</span>
                    </div>
                  {touch.error ? (
                    <div className="flex items-start gap-2 text-amber-200">
                      <ServerCrash size={16} />
                      <span className="text-sm">{touch.error}</span>
                    </div>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
