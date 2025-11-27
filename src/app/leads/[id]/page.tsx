"use client"

import React, { useEffect, useMemo, useState } from "react"
import { AlertTriangle, ArrowLeft, Clock4, Mail, PhoneCall, ServerCrash } from "lucide-react"
import { useParams, useRouter } from "next/navigation"

<<<<<<< HEAD
import { channelLabel, formatPreview, getWhen, statusVariant, type TouchRunRow } from "@/components/leads/timeline-utils"
=======
import {
  channelLabel,
  fetchLeadTouchRuns,
  formatPreview,
  getWhen,
  statusVariant,
  type TouchRunRow,
} from "@/components/leads/timeline-utils"
>>>>>>> origin/codex/fix-touch_runs.type-bug-and-enhance-timelines-iy1cd0
import { supabaseBrowser } from "@/lib/supabase"
import { Badge, Button, Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui-custom"
import { StatCard } from "@/components/ui-custom/stat-card"

const timeFormatter = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit" })
const dateFormatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" })

const MOCK_LEAD = {
  id: "mock-lead",
  email: "mock@example.com",
  phone: "+34 600 000 000",
  state: "Engaged",
  last_touched_at: "2024-11-03T09:00:00Z",
  last_channel: "email",
}

const MOCK_STEPS: TouchRunRow[] = [
  {
    id: "mock-1",
    campaign_id: null,
    campaign_run_id: null,
    lead_id: "mock-lead",
    step: 1,
    channel: "email",
    status: "sent",
    payload: { subject: "Bienvenida", message: "¡Hola! Gracias por tu interés" },
    scheduled_at: "2024-11-01T08:00:00Z",
    sent_at: "2024-11-01T08:00:00Z",
    created_at: "2024-11-01T08:00:00Z",
    error: null,
    meta: null,
  },
  {
    id: "mock-2",
    campaign_id: null,
    campaign_run_id: null,
    lead_id: "mock-lead",
    step: 2,
    channel: "voice",
    status: "failed",
    payload: { note: "No respondió" },
    scheduled_at: null,
    sent_at: null,
    created_at: "2024-11-02T10:15:00Z",
    error: "Sin respuesta",
    meta: null,
  },
  {
    id: "mock-3",
    campaign_id: null,
    campaign_run_id: null,
    lead_id: "mock-lead",
    step: 3,
    channel: "sms",
    status: "scheduled",
    payload: { body: "Te llamaremos pronto" },
    scheduled_at: "2024-11-03T09:00:00Z",
    sent_at: null,
    created_at: "2024-11-02T18:45:00Z",
    error: null,
    meta: null,
  },
]

type LeadRecord = {
  id: string
  email: string | null
  phone: string | null
  state: string | null
  last_touched_at: string | null
  last_channel: string | null
}

type NormalizedStep = TouchRunRow & {
  when: string | null
  dateKey: string
  dateLabel: string
  timeLabel: string
  preview: string
}

function normalizeSteps(steps: TouchRunRow[]): NormalizedStep[] {
  return steps
    .map((step) => {
      const when = getWhen(step)
      const whenDate = when ? new Date(when) : null
      const dateKey = whenDate && !Number.isNaN(whenDate.getTime()) ? whenDate.toISOString().slice(0, 10) : "unknown"
      return {
        ...step,
        when,
        dateKey,
        dateLabel: whenDate && !Number.isNaN(whenDate.getTime()) ? dateFormatter.format(whenDate) : "Fecha desconocida",
        timeLabel: whenDate && !Number.isNaN(whenDate.getTime()) ? timeFormatter.format(whenDate) : "—",
        preview: formatPreview(step.payload),
      }
    })
    .sort((a, b) => {
      const aDate = new Date(a.when ?? 0).getTime()
      const bDate = new Date(b.when ?? 0).getTime()
      return bDate - aDate
    })
}

function channelBadgeVariant(channel: string | null) {
  const normalized = channel?.toLowerCase()
  if (normalized === "email") return "info" as const
  if (normalized === "voice") return "warning" as const
  if (normalized === "sms" || normalized === "whatsapp") return "success" as const
  return "neutral" as const
}

function channelIcon(channel?: string | null) {
  if (channel === "voice") return <PhoneCall size={16} />
  if (channel === "email") return <Mail size={16} />
  return <Clock4 size={16} />
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const leadId = params?.id ?? ""

  const supabaseReady = useMemo(
    () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
    [],
  )

  const [lead, setLead] = useState<LeadRecord | null>(null)
  const [steps, setSteps] = useState<NormalizedStep[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [usingMock, setUsingMock] = useState(false)

  useEffect(() => {
    let alive = true

    async function loadLead() {
      if (!leadId) return
      setLoading(true)
      setError(null)

      if (!supabaseReady) {
        setLead({ ...MOCK_LEAD, id: leadId })
        setSteps(normalizeSteps(MOCK_STEPS))
        setUsingMock(true)
        setLoading(false)
        return
      }

      const client = supabaseBrowser()
      const [{ data: leadData, error: leadError }, { data: stepData, error: stepsError }] = await Promise.all([
        client.from("leads").select("id, email, phone, state, last_touched_at, last_channel").eq("id", leadId).single(),
<<<<<<< HEAD
        client
          .from("touch_runs")
          .select(
            "id, campaign_id, campaign_run_id, lead_id, step, channel, status, payload, scheduled_at, sent_at, created_at, error, meta",
          )
          .eq("lead_id", leadId)
          .order("created_at", { ascending: false }),
=======
        fetchLeadTouchRuns(client, leadId),
>>>>>>> origin/codex/fix-touch_runs.type-bug-and-enhance-timelines-iy1cd0
      ])

      if (!alive) return

      if (leadError) {
        console.error(leadError)
        setError("No se pudo obtener la ficha del lead.")
      }

      if (stepsError) {
        console.error(stepsError)
        setError("No se pudo obtener el timeline de touch_runs para este lead.")
      }

      if (leadData) {
        setLead(leadData as LeadRecord)
      } else {
        setLead({ ...MOCK_LEAD, id: leadId })
      }

      setSteps(normalizeSteps((stepData ?? []) as TouchRunRow[]))
      setUsingMock(false)
      setLoading(false)
    }

    loadLead()
    return () => {
      alive = false
    }
  }, [leadId, supabaseReady])

  const totalSteps = steps.length
  const sentSteps = steps.filter((step) => step.status?.toLowerCase() === "sent").length
  const errorSteps = steps.filter((step) => {
    const normalized = step.status?.toLowerCase()
    return normalized === "failed" || normalized === "error"
  }).length

  const grouped = useMemo(() => {
    const groups = new Map<string, { date: string; label: string; items: NormalizedStep[] }>()

    steps.forEach((step) => {
      const group = groups.get(step.dateKey) ?? { date: step.dateKey, label: step.dateLabel, items: [] }
      group.items.push(step)
      groups.set(step.dateKey, group)
    })

    return Array.from(groups.values()).sort((a, b) => (a.date > b.date ? -1 : 1))
  }, [steps])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.push("/leads-inbox")}>
            <ArrowLeft size={16} />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-white">Lead timeline</h1>
              <Badge variant="neutral">Detalle</Badge>
              {usingMock ? <Badge variant="warning">Mock</Badge> : null}
            </div>
            <p className="text-sm text-white/60">ID: {leadId}</p>
          </div>
        </div>
        {lead?.state ? (
          <Badge variant={statusVariant(lead.state)} className="capitalize">
            {lead.state}
          </Badge>
        ) : null}
      </div>

      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">Se cargó un mock para continuar con el QA visual.</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard label="Total steps" value={totalSteps.toString()} helper="Pasos registrados en touch_runs" />
        <StatCard label="Sent" value={sentSteps.toString()} helper="Pasos marcados como sent" />
        <StatCard label="Errores" value={errorSteps.toString()} helper="failed o error" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-white/70">
              Last touch: {lead?.last_touched_at ? new Date(lead.last_touched_at).toLocaleString() : "No touches yet"}
            </p>
            <p className="text-xs text-white/50">Último canal: {lead?.last_channel ?? "—"}</p>
            <p className="text-xs text-white/50">Email: {lead?.email ?? "—"} · Phone: {lead?.phone ?? "—"}</p>
          </div>
          <Badge variant="outline" className="capitalize">
            {lead?.state ?? "Sin estado"}
          </Badge>
        </CardContent>
      </Card>

      {loading ? (
        <div className="space-y-3">
          <div className="h-10 animate-pulse rounded-xl bg-white/5" />
          <div className="h-52 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
        </div>
      ) : null}

      {!loading && steps.length === 0 ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-lg font-semibold text-white">No steps yet</p>
            <p className="text-sm text-white/70">
              No steps yet. Lanza una campaña para que el motor genere toques para este lead.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {!loading && steps.length > 0 ? (
        <div className="space-y-6">
          {grouped.map((group) => (
            <div key={group.date} className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-white">
                  {group.label} — {group.items.length} touches
                </h3>
              </div>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Hora</TableHeaderCell>
                    <TableHeaderCell>Paso</TableHeaderCell>
                    <TableHeaderCell>Canal</TableHeaderCell>
                    <TableHeaderCell>Estado</TableHeaderCell>
                    <TableHeaderCell>Preview</TableHeaderCell>
                    <TableHeaderCell>Error</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {group.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="whitespace-nowrap text-white/70">{item.timeLabel}</TableCell>
                      <TableCell className="text-white">#{item.step ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2 text-white">
                          <span className="rounded-full bg-white/5 p-2 text-emerald-300">{channelIcon(item.channel)}</span>
                          <Badge variant={channelBadgeVariant(item.channel)} className="capitalize">
                            {channelLabel[item.channel ?? ""] ?? "Canal"}
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(item.status)} className="capitalize">
                          {item.status ?? "Sin estado"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-white/80">{item.preview}</TableCell>
                      <TableCell className="text-sm text-red-200">
                        {item.error ? (
                          <span className="flex items-center gap-2">
                            <ServerCrash size={16} />
                            {item.error}
                          </span>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ))}
        </div>
      ) : null}

    </div>
  )
}
