"use client"

import React, { useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  ArrowLeft,
  PhoneCall,
  Mail,
  Clock4
} from "lucide-react"
import { useParams, useRouter } from "next/navigation"

import { supabaseBrowser } from "@/lib/supabase"
import { LeadTimeline } from "@/components/leads/LeadTimeline"

import {
  fetchLeadTouchRuns,
  formatPreview,
  getWhen,
  statusVariant,
  channelLabel,         // 👈 AQUI ESTÁ EL FALTANTE
  type TouchRunRow,
} from "@/components/leads/timeline-utils"

import {
  Badge,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"

import { StatCard } from "@/components/ui-custom/stat-card"

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
})
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
})

type LeadRecord = {
  id: string
  full_name: string | null
  email: string | null
  phone: string | null
  state: string | null
  last_touch_at: string | null
  channel_last: string | null
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
      const valid = whenDate && !Number.isNaN(whenDate.getTime())

      const dateKey = valid ? whenDate!.toISOString().slice(0, 10) : "unknown"

      return {
        ...step,
        when,
        dateKey,
        dateLabel: valid
          ? dateFormatter.format(whenDate!)
          : "Fecha desconocida",
        timeLabel: valid ? timeFormatter.format(whenDate!) : "—",
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

function deriveLeadTitle(lead: LeadRecord | null) {
  if (!lead) return "Sin nombre"
  return lead.full_name || lead.email || lead.phone || "Sin nombre"
}

function deriveLeadSubtitle(lead: LeadRecord | null) {
  if (!lead) return "Sin contacto"
  const email = lead.email ?? "Sin email"
  const phone = lead.phone ?? "Sin teléfono"
  return `${email} · ${phone}`
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const leadId = params?.id ?? ""

  const supabaseReady = useMemo(
    () =>
      Boolean(
        process.env.NEXT_PUBLIC_SUPABASE_URL &&
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      ),
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

      const isMockId = leadId.startsWith("MOCK-")

      // 🔹 Modo mock (IDs MOCK-xxxx o sin Supabase)
      if (!supabaseReady || isMockId) {
        if (!alive) return

        setLead({
          id: leadId,
          full_name: "Sin nombre",
          email: null,
          phone: null,
          state: null,
          last_touch_at: null,
          channel_last: null,
        })
        setSteps([])
        setUsingMock(true)
        setLoading(false)
        return
      }

      // 🔹 Flujo real (UUIDs con Supabase)
      const client = supabaseBrowser()

      try {
        const [
          { data: enriched, error: enrichedError },
          stepsResult,
        ] = await Promise.all([
          client
            .from("lead_enriched")
            .select(
              "id, full_name, email, phone, state, last_touch_at, channel_last",
            )
            .eq("id", leadId)
            .maybeSingle(),
          fetchLeadTouchRuns(client, leadId),
        ])

        if (!alive) return

        if (enrichedError) {
          console.warn("lead_enriched error", enrichedError)
        }

        const { data: stepsData, error: stepsError } = stepsResult

        if (stepsError) {
          console.error("touch_runs error", stepsError)
          setError(
            "No se pudo obtener el timeline de touch_runs para este lead. Revisa la configuración o intenta más tarde.",
          )
        }

        if (enriched) {
          setLead({
            id: enriched.id,
            full_name: enriched.full_name ?? null,
            email: enriched.email ?? null,
            phone: enriched.phone ?? null,
            state: enriched.state ?? null,
            last_touch_at: enriched.last_touch_at ?? null,
            channel_last: enriched.channel_last ?? null,
          })
        } else {
          setLead({
            id: leadId,
            full_name: "Sin nombre",
            email: null,
            phone: null,
            state: null,
            last_touch_at: null,
            channel_last: null,
          })
        }

        setSteps(
          stepsError || !stepsData
            ? []
            : normalizeSteps(stepsData as TouchRunRow[]),
        )
        setUsingMock(false)
      } catch (e) {
        if (!alive) return
        console.error("loadLead unexpected error", e)
        setError(
          "No se pudo obtener el timeline de touch_runs para este lead. Revisa la configuración o vuelve a intentar.",
        )
        setSteps([])
      } finally {
        if (!alive) return
        setLoading(false)
      }
    }

    loadLead()

    return () => {
      alive = false
    }
  }, [leadId, supabaseReady])

  const totalSteps = steps.length
  const sentSteps = steps.filter(
    (step) => step.status?.toLowerCase() === "sent",
  ).length
  const errorSteps = steps.filter((step) => {
    const normalized = step.status?.toLowerCase()
    return normalized === "failed" || normalized === "error"
  }).length

  const grouped = useMemo(() => {
    const groups = new Map<
      string,
      { date: string; label: string; items: NormalizedStep[] }
    >()

    steps.forEach((step) => {
      const group =
        groups.get(step.dateKey) ?? {
          date: step.dateKey,
          label: step.dateLabel,
          items: [] as NormalizedStep[],
        }
      group.items.push(step)
      groups.set(step.dateKey, group)
    })

    return Array.from(groups.values()).sort((a, b) =>
      a.date > b.date ? -1 : 1,
    )
  }, [steps])

  const title = deriveLeadTitle(lead)
  const subtitle = deriveLeadSubtitle(lead)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push("/leads-inbox")}
          >
            <ArrowLeft size={16} />
            Back
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-semibold text-white">
                Lead timeline
              </h1>
              <Badge variant="neutral">Detalle</Badge>
              {usingMock ? <Badge variant="warning">Mock</Badge> : null}
            </div>
            <p className="text-sm text-white/80">{title}</p>
            <p className="text-xs text-white/60">
              {subtitle} · ID: {leadId}
            </p>
          </div>
        </div>
        {lead?.state ? (
          <Badge variant={statusVariant(lead.state)} className="capitalize">
            {lead.state}
          </Badge>
        ) : null}
      </div>

      {/* Error banner solo en error real */}
      {error ? (
        <div className="flex items-start gap-3 rounded-2xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-red-100">
          <AlertTriangle size={18} className="mt-0.5" />
          <div>
            <p className="font-semibold">{error}</p>
            <p className="text-sm text-red-200/90">
              Revisa la configuración de touch_runs o vuelve a intentar más
              tarde.
            </p>
          </div>
        </div>
      ) : null}

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          label="Total steps"
          value={totalSteps.toString()}
          helper="Pasos registrados en touch_runs"
        />
        <StatCard
          label="Sent"
          value={sentSteps.toString()}
          helper="Pasos marcados como sent"
        />
        <StatCard
          label="Errores"
          value={errorSteps.toString()}
          helper="failed o error"
        />
      </div>

      {/* Last touch card */}
      <Card>
        <CardContent className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <p className="text-sm text-white/70">
              Last touch:{" "}
              {lead?.last_touch_at
                ? new Date(lead.last_touch_at).toLocaleString()
                : "No touches yet"}
            </p>
            <p className="text-xs text-white/50">
              Último canal: {lead?.channel_last ?? "—"}
            </p>
            <p className="text-xs text-white/50">
              Email: {lead?.email ?? "—"} · Phone: {lead?.phone ?? "—"}
            </p>
          </div>
          <Badge variant="outline" className="capitalize">
            {lead?.state ?? "Sin estado"}
          </Badge>
        </CardContent>
      </Card>

      {/* Loading skeleton */}
      {loading && !usingMock ? (
        <div className="space-y-3">
          <div className="h-10 animate-pulse rounded-xl bg-white/5" />
          <div className="h-52 animate-pulse rounded-2xl bg-white/5" />
          <div className="h-32 animate-pulse rounded-2xl bg-white/5" />
        </div>
      ) : null}

      {/* Empty state */}
      {!loading && steps.length === 0 ? (
        <Card>
          <CardContent className="space-y-3">
            <p className="text-lg font-semibold text-white">No steps yet</p>
            <p className="text-sm text-white/70">
              No steps yet. Lanza una campaña para que el motor genere toques
              para este lead.
            </p>
          </CardContent>
        </Card>
      ) : null}

           {/* Timeline unificado de actividad del lead */}
           <div className="mt-6">
        <LeadTimeline
          leadId={leadId}
          leadName={
            lead?.contact_name ??
            lead?.company_name ??
            lead?.email ??
            undefined
          }
        />
      </div>
    </div>
  )
}

