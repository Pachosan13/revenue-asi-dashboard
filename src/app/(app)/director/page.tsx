import React from "react"
import Link from "next/link"
import { supabaseServer } from "@/lib/supabase-server"
import { getSystemSnapshot } from "@/lib/director/system-snapshot"
import {
  Badge,
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
import {
  Mail,
  PhoneCall,
  MessageSquare,
  Zap,
} from "lucide-react"

export const revalidate = 0

// ---------- Constantes & tipos ----------

const JOB_NAMES = [
  "campaign_engine_5m",
  "run_enrichment_5m",
  "dispatch-touch-every-minute",
  "run-cadence-every-5m",
  "revenue-asi-run-enrichment-5min",
  "revenue-asi-touch-fake-5min",
  "revenue-asi-recompute-leads-5min",
  "cron_dispatch_appointment_notifications",
]

type CronJobRow = {
  name: string
  schedule: string | null
}

type DispatchLogRow = {
  id: string
  created_at: string
  kind: string
  payload: Record<string, unknown> | null
}

type EngineStatus = {
  name: string
  schedule: string | null
  lastRun: string | null
  status: "OK" | "Error" | "No data"
}

type AppointmentMetrics = {
  appointmentsToday: number
  remindersToday: number
  reminderTouchRunsToday: number
}

type LeadMetrics = {
  newLeadsToday: number
  leadsWithAppointments: number
  showsToday: number
  noShowsToday: number
}

type CampaignEngineRow = {
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

type DirectorAlertRow = {
  id: string
  created_at: string
  event_type: string | null
  event_source: string | null
  score_delta: number | null
  payload: Record<string, any> | null
}

// 🔗 Next actions + enrichment genome (solo el tipo unificado que usamos en la tabla)

type NextActionRow = {
  lead_id: string
  lead_name: string | null
  email: string | null
  phone: string | null
  lead_state: string | null
  lead_brain_bucket: string | null
  recommended_channel: string | null
  recommended_action: string | null
  recommended_delay_minutes: number | null
  priority_score: number | null
  reason: string | null
  industry?: string | null
  sub_industry?: string | null
  enrichment_status?: string | null
  ai_lead_score?: number | null
}

// 🔬 Enrichment Engine v2 overview

type EnrichmentQueueStat = {
  status: string | null
  total: number
}

type EnrichmentSummaryRow = {
  enrichment_status: string | null
  total: number
  avg_ai_lead_score: number | null
}

type EnrichmentOverview = {
  queue: EnrichmentQueueStat[]
  summary: EnrichmentSummaryRow[]
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function getTodayRange() {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date()
  end.setUTCHours(24, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString() }
}

// ---------- Loaders (server-side) ----------

async function loadEngines(client: ReturnType<typeof supabaseServer>) {
  if (!client) {
    return JOB_NAMES.map<EngineStatus>((name) => ({
      name,
      schedule: null,
      lastRun: null,
      status: "No data",
    }))
  }

  const [cronJobs, logs] = await Promise.all([
    client.from("cron.job").select("name, schedule").in("name", JOB_NAMES),
    client
      .from("dispatch_logs")
      .select("id, created_at, kind, payload")
      .in("kind", JOB_NAMES)
      .order("created_at", { ascending: false })
      .limit(200),
  ])

  const scheduleMap = new Map<string, string | null>()
  ;(cronJobs.data as CronJobRow[] | null)?.forEach((row) => {
    scheduleMap.set(row.name, row.schedule)
  })

  const latestLogMap = new Map<string, DispatchLogRow>()
  ;(logs.data as DispatchLogRow[] | null)?.forEach((row) => {
    if (!latestLogMap.has(row.kind)) {
      latestLogMap.set(row.kind, row)
    }
  })

  return JOB_NAMES.map<EngineStatus>((name) => {
    const log = latestLogMap.get(name)
    const payloadHasError = Boolean(
      log?.payload && typeof log.payload === "object" && "error" in log.payload,
    )

    let status: EngineStatus["status"] = "No data"
    if (log) status = payloadHasError ? "Error" : "OK"

    return {
      name,
      schedule: scheduleMap.get(name) ?? null,
      lastRun: log?.created_at ?? null,
      status,
    }
  })
}

async function loadAppointmentMetrics(
  client: ReturnType<typeof supabaseServer>,
): Promise<AppointmentMetrics> {
  const fallback: AppointmentMetrics = {
    appointmentsToday: 0,
    remindersToday: 0,
    reminderTouchRunsToday: 0,
  }
  if (!client) return fallback

  const { start, end } = getTodayRange()

  const [appointments, reminders, touchReminders] = await Promise.all([
    client
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .gte("starts_at", start)
      .lt("starts_at", end),
    client
      .from("appointments_notifications")
      .select("id", { count: "exact", head: true })
      .gte("notify_at", start)
      .lt("notify_at", end),
    client
      .from("touch_runs")
      .select("id", { count: "exact", head: true })
      .in("step", [200, 201, 202])
      .gte("scheduled_at", start)
      .lt("scheduled_at", end),
  ])

  return {
    appointmentsToday: appointments.count ?? 0,
    remindersToday: reminders.count ?? 0,
    reminderTouchRunsToday: touchReminders.count ?? 0,
  }
}

async function loadLeadMetrics(
  client: ReturnType<typeof supabaseServer>,
): Promise<LeadMetrics> {
  const fallback: LeadMetrics = {
    newLeadsToday: 0,
    leadsWithAppointments: 0,
    showsToday: 0,
    noShowsToday: 0,
  }
  if (!client) return fallback

  const { start, end } = getTodayRange()

  const [newLeads, shows, noShows, leadAppointments] = await Promise.all([
    client
      .from("leads")
      .select("id", { count: "exact", head: true })
      .gte("created_at", start)
      .lt("created_at", end),
    client
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "show")
      .gte("starts_at", start)
      .lt("starts_at", end),
    client
      .from("appointments")
      .select("id", { count: "exact", head: true })
      .eq("outcome", "no_show")
      .gte("starts_at", start)
      .lt("starts_at", end),
    client.from("appointments").select("lead_id"),
  ])

  const leadIds = new Set(
    (leadAppointments.data ?? [])
      .map((row) => (row as { lead_id: string | null }).lead_id)
      .filter((id): id is string => Boolean(id)),
  )

  return {
    newLeadsToday: newLeads.count ?? 0,
    showsToday: shows.count ?? 0,
    noShowsToday: noShows.count ?? 0,
    leadsWithAppointments: leadIds.size,
  }
}

async function loadCampaignEngine(
  client: ReturnType<typeof supabaseServer>,
): Promise<CampaignEngineRow[]> {
  if (!client) return []

  const { data, error } = await client
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
    .limit(10)

  if (error) {
    console.error("campaign_funnel_overview error", error)
    return []
  }

  // Supabase types allow GenericStringError[] in `data`,
  // así que lo pasamos por `unknown` antes de castear.
  const typed = (data ?? []) as unknown as CampaignEngineRow[]
  return typed
}

async function loadDirectorAlerts(
  client: ReturnType<typeof supabaseServer>,
): Promise<DirectorAlertRow[]> {
  if (!client) return []

  const { data, error } = await client
    .from("core_memory_events")
    .select("id, created_at, event_type, event_source, score_delta, payload")
    .order("created_at", { ascending: false })
    .limit(20)

  if (error) {
    console.error("core_memory_events error", error)
    return []
  }

  return (data as DirectorAlertRow[] | null) ?? []
}

// 🔥 Lead Next Actions loader + Genome v2 merge

async function loadNextActions(
  client: ReturnType<typeof supabaseServer>,
): Promise<NextActionRow[]> {
  if (!client) return []

  const { data, error } = await client
    .from("lead_next_action_view_v5")
    .select(
      `
      lead_id,
      lead_name,
      email,
      phone,
      lead_state,
      lead_brain_bucket,
      recommended_channel,
      effective_channel,
      recommended_action,
      recommended_delay_minutes,
      priority_score,
      reason
    `,
    )
    .order("priority_score", { ascending: false })
    .limit(100)

  if (error || !data) {
    console.error("lead_next_action_view_v5 error", error)
    return []
  }

  const rows = data as {
    lead_id: string | null
    lead_name?: string | null
    email: string | null
    phone: string | null
    lead_state: string | null
    lead_brain_bucket: string | null
    recommended_channel: string | null
    effective_channel: string | null
    recommended_action: string | null
    recommended_delay_minutes: number | null
    priority_score: number | null
    reason: string | null
  }[]

  const leadIds = rows
    .map((r) => r.lead_id)
    .filter((id): id is string => Boolean(id))

  let genomeMap = new Map<
    string,
    {
      industry: string | null
      sub_industry: string | null
      enrichment_status: string | null
      ai_lead_score: number | null
    }
  >()

  if (leadIds.length > 0) {
    const { data: genomeData, error: genomeError } = await client
      .from("v_lead_with_enrichment_v2")
      .select(
        [
          "id",
          "industry",
          "sub_industry",
          "enrichment_status",
          "ai_lead_score",
        ].join(", "),
      )
      .in("id", leadIds)

    if (genomeError) {
      console.error("v_lead_with_enrichment_v2 error", genomeError)
    }

    genomeMap = new Map()
    ;(genomeData ?? []).forEach((row: any) => {
      if (!row.id) return
      genomeMap.set(row.id, {
        industry: row.industry ?? null,
        sub_industry: row.sub_industry ?? null,
        enrichment_status: row.enrichment_status ?? null,
        ai_lead_score:
          row.ai_lead_score == null ? null : Number(row.ai_lead_score) || 0,
      })
    })
  }

  return rows.map((row) => {
    const key = row.lead_id ?? ""
    const g = key ? genomeMap.get(key) : undefined

    return {
      lead_id: key,
      lead_name: row.lead_name ?? null,
      email: row.email,
      phone: row.phone,
      lead_state: row.lead_state,
      lead_brain_bucket: row.lead_brain_bucket,
      recommended_channel:
        row.effective_channel ?? row.recommended_channel ?? null,
      recommended_action: row.recommended_action,
      recommended_delay_minutes: row.recommended_delay_minutes,
      priority_score: row.priority_score,
      reason: row.reason,
      industry: g?.industry ?? null,
      sub_industry: g?.sub_industry ?? null,
      enrichment_status: g?.enrichment_status ?? null,
      ai_lead_score: g?.ai_lead_score ?? null,
    }
  })
}

// 🔬 Enrichment Engine v2 loader

async function loadEnrichmentOverview(
  client: ReturnType<typeof supabaseServer>,
): Promise<EnrichmentOverview> {
  if (!client) return { queue: [], summary: [] }

  const { data: queueData, error: queueError } = await client
    .from("enrichment_queue")
    .select("status")

  if (queueError) {
    console.error("enrichment_queue error", queueError)
  }

  const queueMap = new Map<string | null, number>()
  ;(queueData as { status: string | null }[] | null)?.forEach((row) => {
    const key = row.status ?? "unknown"
    queueMap.set(key, (queueMap.get(key) ?? 0) + 1)
  })

  const queue: EnrichmentQueueStat[] = Array.from(queueMap.entries()).map(
    ([status, total]) => ({
      status,
      total,
    }),
  )

  const { data: summaryData, error: summaryError } = await client
    .from("v_lead_with_enrichment_v2")
    .select("enrichment_status, ai_lead_score")

  if (summaryError) {
    console.error("v_lead_with_enrichment_v2 summary error", summaryError)
  }

  const summaryMap = new Map<
    string | null,
    { total: number; sumScore: number; countWithScore: number }
  >()

  ;(summaryData as { enrichment_status: string | null; ai_lead_score: any }[] | null)?.forEach(
    (row) => {
      const key = row.enrichment_status ?? "unknown"
      const existing = summaryMap.get(key) ?? {
        total: 0,
        sumScore: 0,
        countWithScore: 0,
      }
      const score =
        row.ai_lead_score == null ? null : Number(row.ai_lead_score) || 0

      existing.total += 1
      if (score != null) {
        existing.sumScore += score
        existing.countWithScore += 1
      }

      summaryMap.set(key, existing)
    },
  )

  const summary: EnrichmentSummaryRow[] = Array.from(
    summaryMap.entries(),
  ).map(([status, agg]) => ({
    enrichment_status: status,
    total: agg.total,
    avg_ai_lead_score:
      agg.countWithScore > 0 ? agg.sumScore / agg.countWithScore : null,
  }))

  return { queue, summary }
}

// ---------- UI helpers ----------

function StatusBadge({ status }: { status: EngineStatus["status"] }) {
  const variant =
    status === "Error"
      ? "destructive"
      : status === "No data"
      ? "warning"
      : "neutral"

  return <Badge variant={variant}>{status}</Badge>
}

function MetricTile({
  label,
  value,
  helper,
}: {
  label: string
  value: number
  helper: string
}) {
  return (
    <Card className="bg-white/5">
      <CardContent className="space-y-1 p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-white/50">
          {label}
        </p>
        <p className="text-2xl font-semibold text-white">{value}</p>
        <p className="text-xs text-white/50">{helper}</p>
      </CardContent>
    </Card>
  )
}

function formatPercent(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "0%"
  return `${(value * 100).toFixed(1)}%`
}

function CampaignEngineSection({ rows }: { rows: CampaignEngineRow[] }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Campaign funnel"
        description="Performance de cada campaña: touches, replies y bookings."
      />
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-white/60">
            No hay campañas con actividad todavía.
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Campaign</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Leads touched
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Engaged
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Booked
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Show / No-show
                </TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Reply rate
                </TableHeaderCell>
                <TableHeaderCell className="text-right text-rose-300">
                  Error rate
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.campaign_id}>
                  <TableCell className="font-semibold text-white">
                    {row.campaign_id ? (
                      <Link
                        href={`/leads?campaign_id=${row.campaign_id}`}
                        className="hover:underline"
                      >
                        {row.campaign_name ?? "Sin nombre"}
                      </Link>
                    ) : (
                      row.campaign_name ?? "Sin nombre"
                    )}
                  </TableCell>
                  <TableCell className="text-right text-white/80">
                    {row.leads_touched}
                  </TableCell>
                  <TableCell className="text-right text-white/80">
                    {row.leads_engaged}
                  </TableCell>
                  <TableCell className="text-right text-white/80">
                    {row.leads_booked}
                  </TableCell>
                  <TableCell className="text-right text-white/80">
                    {row.leads_booked_show} / {row.leads_booked_no_show}
                  </TableCell>
                  <TableCell className="text-right text-emerald-300">
                    {formatPercent(row.reply_rate)}
                  </TableCell>
                  <TableCell className="text-right text-rose-300">
                    {formatPercent(row.error_rate)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function SystemSnapshotCard({ snapshot }: { snapshot: any }) {
  const overview = snapshot?.dashboard_overview ?? {}

  const items: { label: string; value: number | string }[] = [
    { label: "Total leads", value: overview.total_leads ?? 0 },
    { label: "Leads attempting", value: overview.leads_attempting ?? 0 },
    { label: "Leads booked", value: overview.leads_booked ?? 0 },
    { label: "Campaigns live", value: overview.campaigns_live ?? 0 },
  ]

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="System snapshot"
        description="Resumen que ve el Director Brain."
      />
      <CardContent className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => (
          <div key={item.label} className="space-y-1">
            <p className="text-xs uppercase tracking-[0.16em] text-white/50">
              {item.label}
            </p>
            <p className="text-lg font-semibold text-white">
              {item.value ?? 0}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function DirectorAlertsSection({ alerts }: { alerts: DirectorAlertRow[] }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Director Brain – Alerts"
        description="Últimos eventos internos del sistema."
      />
      <CardContent className="space-y-4">
        {alerts.length === 0 ? (
          <p className="text-sm text-white/60">No hay eventos aún.</p>
        ) : (
          alerts.map((alert) => {
            const payload = alert.payload ?? {}
            const label =
              payload.label ??
              payload.title ??
              alert.event_type ??
              "System event"

            const time = new Date(alert.created_at).toLocaleString()

            const actor = alert.event_source ?? "system"
            const importance =
              payload.importance ??
              alert.score_delta ??
              1

            return (
              <div
                key={alert.id}
                className="space-y-2 rounded-xl border border-white/10 bg-white/5 p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.16em] text-white/50">
                      {actor}
                    </p>
                    <p className="text-sm font-semibold text-white">
                      {label}
                    </p>
                  </div>
                  <Badge className="border border-white/20 bg-white/10 text-xs text-white/70">
                    {importance}
                  </Badge>
                </div>
                <p className="text-xs text-white/50">{time}</p>
                {payload.notes ? (
                  <p className="text-sm text-white/70">{payload.notes}</p>
                ) : null}
              </div>
            )
          })
        )}
      </CardContent>
    </Card>
  )
}

// --- Helpers visuales para Next Actions ---

function ChannelIcon({ channel }: { channel: string | null }) {
  if (!channel) return <Zap size={14} className="text-white/40" />

  switch (channel) {
    case "email":
      return <Mail size={14} className="text-emerald-300" />
    case "voice":
      return <PhoneCall size={14} className="text-amber-300" />
    case "whatsapp":
      return <MessageSquare size={14} className="text-green-400" />
    case "sms":
      return <MessageSquare size={14} className="text-blue-400" />
    default:
      return <Zap size={14} className="text-white/40" />
  }
}

function BrainBucketBadge({ bucket }: { bucket: string | null }) {
  if (!bucket)
    return (
      <Badge className="bg-white/10 text-white/60 border border-white/20 text-xs">
        unknown
      </Badge>
    )

  const base = "px-2 py-0.5 text-xs border"
  if (bucket === "hot")
    return (
      <Badge
        className={`${base} bg-rose-600/30 text-rose-100 border-rose-500/60`}
      >
        hot
      </Badge>
    )
  if (bucket === "warm")
    return (
      <Badge
        className={`${base} bg-amber-500/20 text-amber-100 border-amber-400/60`}
      >
        warm
      </Badge>
    )
  return (
    <Badge
      className={`${base} bg-sky-500/20 text-sky-100 border-sky-400/60`}
    >
      cold
    </Badge>
  )
}

function ActionBadge({ action }: { action: string | null }) {
  if (!action) return null
  const base = "px-2 py-0.5 text-xs border"

  if (action === "send")
    return (
      <Badge
        className={`${base} bg-emerald-500/20 text-emerald-100 border-emerald-400/60`}
      >
        send
      </Badge>
    )
  if (action === "cooldown")
    return (
      <Badge
        className={`${base} bg-amber-500/20 text-amber-100 border-amber-400/60`}
      >
        cooldown
      </Badge>
    )
  if (action === "review")
    return (
      <Badge
        className={`${base} bg-rose-600/20 text-rose-100 border-rose-500/60`}
      >
        review
      </Badge>
    )
  return (
    <Badge className={`${base} bg-white/10 text-white/60 border-white/30`}>
      {action}
    </Badge>
  )
}

function UrgencyBar({ score }: { score: number | null }) {
  const v = Math.min(Math.max(score ?? 0, 0), 100)
  const color =
    v >= 70 ? "bg-rose-500" : v >= 40 ? "bg-amber-400" : "bg-emerald-400"

  return (
    <div className="h-2 w-full rounded-full bg-white/10 overflow-hidden">
      <div className={`${color} h-full`} style={{ width: `${v}%` }} />
    </div>
  )
}

function NextActionsSection({ rows }: { rows: NextActionRow[] }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Next actions queue"
        description="Lo que el Lead Brain quiere hacer ahora mismo."
      />
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-white/60">
            No hay acciones pendientes todavía.
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Lead</TableHeaderCell>
                <TableHeaderCell>Bucket</TableHeaderCell>
                <TableHeaderCell>Canal</TableHeaderCell>
                <TableHeaderCell>Acción</TableHeaderCell>
                <TableHeaderCell>Delay</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Prioridad
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow
                  key={row.lead_id}
                  className="hover:bg-white/10 cursor-pointer"
                >
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`/leads/${row.lead_id}`}
                        className="text-sm font-semibold text-white hover:underline"
                      >
                        {row.lead_name ??
                          row.email ??
                          row.phone ??
                          row.lead_id.slice(0, 8).toUpperCase()}
                      </Link>
                      {row.reason ? (
                        <p className="text-xs text-white/60">{row.reason}</p>
                      ) : null}
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {row.industry && (
                          <span className="rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-100">
                            {row.industry}
                          </span>
                        )}
                        {row.sub_industry && (
                          <span className="rounded-full border border-emerald-400/60 bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-50">
                            {row.sub_industry}
                          </span>
                        )}
                        {row.enrichment_status && (
                          <span className="rounded-full border border-white/20 bg-white/10 px-2 py-0.5 text-[11px] text-white/70">
                            {row.enrichment_status}
                          </span>
                        )}
                      </div>
                      {row.ai_lead_score != null && (
                        <p className="text-[11px] text-white/50">
                          AI score: {row.ai_lead_score.toFixed(0)}
                        </p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <BrainBucketBadge bucket={row.lead_brain_bucket} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2 text-sm text-white/70">
                      <ChannelIcon channel={row.recommended_channel} />
                      <span className="capitalize">
                        {row.recommended_channel ?? "--"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ActionBadge action={row.recommended_action} />
                  </TableCell>
                  <TableCell className="text-sm text-white/70">
                    {row.recommended_delay_minutes != null
                      ? `${row.recommended_delay_minutes} min`
                      : "--"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-xs text-white/60">
                        {row.priority_score ?? 0}
                      </span>
                      <UrgencyBar score={row.priority_score} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// 🔬 Enrichment Engine v2 – UI

function EnrichmentEngineV2Section({
  overview,
}: {
  overview: EnrichmentOverview
}) {
  const queue = overview.queue
  const summary = overview.summary

  const totalInQueue = queue.reduce((acc, q) => acc + q.total, 0)
  const pending =
    queue.find((q) => (q.status ?? "").toLowerCase() === "pending")
      ?.total ?? 0
  const failed =
    queue.find((q) => (q.status ?? "").toLowerCase() === "failed")
      ?.total ?? 0
  const completed =
    queue.find((q) => (q.status ?? "").toLowerCase() === "completed")
      ?.total ?? 0

  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Enrichment Engine v2"
        description="Cola y estado de los leads enriquecidos."
      />
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <MetricTile
            label="En cola"
            value={totalInQueue}
            helper="Registros en enrichment_queue"
          />
          <MetricTile
            label="Pending"
            value={pending}
            helper="Aún por procesar"
          />
          <MetricTile
            label="Completed"
            value={completed}
            helper="Marcados como completados"
          />
          <MetricTile
            label="Failed"
            value={failed}
            helper="Errores recientes"
          />
        </div>

        <div className="rounded-2xl border border-white/10 bg-black/30">
          {summary.length === 0 ? (
            <p className="p-4 text-sm text-white/60">
              Aún no hay leads con enrichment v2.
            </p>
          ) : (
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Leads
                  </TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Avg AI score
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.map((row) => (
                  <TableRow key={row.enrichment_status ?? "unknown"}>
                    <TableCell className="capitalize text-white">
                      {row.enrichment_status ?? "unknown"}
                    </TableCell>
                    <TableCell className="text-right text-white/80">
                      {row.total}
                    </TableCell>
                    <TableCell className="text-right text-white/80">
                      {row.avg_ai_lead_score != null
                        ? row.avg_ai_lead_score.toFixed(1)
                        : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

// ---------- Página principal ----------

export default async function DirectorPage() {
  const supabase = supabaseServer()

  const [
    nextActions,
    engines,
    appointmentMetrics,
    leadMetrics,
    snapshot,
    campaignRows,
    alerts,
    enrichmentOverview,
  ] = await Promise.all([
    loadNextActions(supabase),
    loadEngines(supabase),
    loadAppointmentMetrics(supabase),
    loadLeadMetrics(supabase),
    getSystemSnapshot(),
    loadCampaignEngine(supabase),
    loadDirectorAlerts(supabase),
    loadEnrichmentOverview(supabase),
  ])

  const hasError = engines.some((e) => e.status === "Error")
  const hasAnyRun = engines.some((e) => e.lastRun !== null)

  const engineLabel = hasError
    ? "Engine con issues · revisa logs"
    : hasAnyRun
    ? "Engine ok · cron corriendo"
    : "Sin datos aún · engine idle"

  const engineVariant: "neutral" | "warning" | "destructive" = hasError
    ? "destructive"
    : hasAnyRun
    ? "neutral"
    : "warning"

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">
            Operations & campaigns
          </p>
          <h1 className="text-3xl font-semibold text-white">
            Director Dashboard
          </h1>
          <p className="text-sm text-white/60">
            Pulso de los motores de Revenue ASI, next actions y performance de
            campañas.
          </p>
        </div>
        <Badge
          variant={engineVariant}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-white/80"
        >
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              engineVariant === "destructive"
                ? "bg-rose-400"
                : engineVariant === "warning"
                ? "bg-amber-400"
                : "bg-emerald-400"
            }`}
          />
          {engineLabel}
        </Badge>
      </div>

      <NextActionsSection rows={nextActions} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1.3fr)]">
        <Card className="border-white/10 bg-white/5">
          <CardHeader
            title="Engines"
            description="Core cron jobs y su última actividad."
          />
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Job</TableHeaderCell>
                  <TableHeaderCell>Schedule</TableHeaderCell>
                  <TableHeaderCell>Last run</TableHeaderCell>
                  <TableHeaderCell className="text-right">
                    Status
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {engines.map((engine) => (
                  <TableRow key={engine.name}>
                    <TableCell className="font-semibold text-white">
                      {engine.name}
                    </TableCell>
                    <TableCell className="text-white/70">
                      {engine.schedule ?? "--"}
                    </TableCell>
                    <TableCell className="text-white/60">
                      {engine.lastRun
                        ? dateTimeFormatter.format(new Date(engine.lastRun))
                        : "--"}
                    </TableCell>
                    <TableCell className="text-right">
                      <StatusBadge status={engine.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <SystemSnapshotCard snapshot={snapshot} />

          <Card className="border-white/10 bg-white/5">
            <CardHeader
              title="Appointments"
              description="Actividad agendada hoy."
            />
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <MetricTile
                label="Appointments"
                value={appointmentMetrics.appointmentsToday}
                helper="Starts today"
              />
              <MetricTile
                label="Reminders"
                value={appointmentMetrics.remindersToday}
                helper="Notification jobs"
              />
              <MetricTile
                label="Reminder touch runs"
                value={
                  appointmentMetrics.reminderTouchRunsToday
                }
                helper="Steps 200–202"
              />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5">
            <CardHeader
              title="Lead Flow"
              description="Top-of-funnel signals."
            />
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <MetricTile
                label="New leads"
                value={leadMetrics.newLeadsToday}
                helper="Created today"
              />
              <MetricTile
                label="Leads w/ appts"
                value={leadMetrics.leadsWithAppointments}
                helper="Distinct leads"
              />
              <MetricTile
                label="Shows"
                value={leadMetrics.showsToday}
                helper="Outcome: show"
              />
              <MetricTile
                label="No-shows"
                value={leadMetrics.noShowsToday}
                helper="Outcome: no_show"
              />
            </CardContent>
          </Card>

          <EnrichmentEngineV2Section overview={enrichmentOverview} />
        </div>
      </div>

      <CampaignEngineSection rows={campaignRows} />
      <DirectorAlertsSection alerts={alerts} />
    </div>
  )
}
