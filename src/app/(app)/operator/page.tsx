// src/app/operator/page.tsx
import React from "react"
import Link from "next/link"
import { supabaseServer } from "@/lib/supabase-server"
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
  MessageCircle,
  PhoneCall,
  Waves,
  Activity,
  CalendarClock,
  AlertTriangle,
  CheckCircle2,
  Zap,
} from "lucide-react"

export const revalidate = 0

// --------- Tipos base ---------

type TouchRunRow = {
  id: string
  campaign_id: string | null
  lead_id: string | null
  step: number | null
  channel: string | null
  scheduled_at: string | null
  sent_at: string | null
  status: string | null
  error: string | null
  created_at: string | null
  type: string | null
  intent: string | null
  outcome: string | null
  retry_count: number | null
  max_retries: number | null
  message_class: string | null
}

type AppointmentNotificationRow = {
  id: string
  org_id: string | null
  appointment_id: string | null
  channel: string | null
  notify_at: string | null
  status: string | null
  created_at: string | null
  sent_at: string | null
  error: string | null
}

type ActivityToday = {
  touchesTotalToday: number
  touchesSentToday: number
  touchesFailedToday: number
  touchesQueuedToday: number
  appointmentNotificationsToday: number
}

// --------- Helpers de fecha ---------

function getTodayRangeUTC() {
  const start = new Date()
  start.setUTCHours(0, 0, 0, 0)
  const end = new Date()
  end.setUTCHours(24, 0, 0, 0)
  return { start: start.toISOString(), end: end.toISOString() }
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

function formatDate(value: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return dateTimeFormatter.format(d)
}

function timeAgo(value: string | null) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  const diffMs = Date.now() - d.getTime()
  const diffMin = Math.round(diffMs / 60000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `hace ${diffMin} min`
  const diffH = Math.round(diffMin / 60)
  if (diffH < 24) return `hace ${diffH} h`
  const diffD = Math.round(diffH / 24)
  return `hace ${diffD} d`
}

// --------- Loaders (server-side) ---------

async function loadLiveQueue(
  client: ReturnType<typeof supabaseServer>,
): Promise<TouchRunRow[]> {
  if (!client) return []

  const { data, error } = await client
    .from("touch_runs")
    .select(
      [
        "id",
        "campaign_id",
        "lead_id",
        "step",
        "channel",
        "scheduled_at",
        "sent_at",
        "status",
        "error",
        "created_at",
        "type",
        "intent",
        "outcome",
        "retry_count",
        "max_retries",
        "message_class",
      ].join(", "),
    )
    .in("status", ["queued", "scheduled"])
    .order("scheduled_at", { ascending: true })
    .limit(50)

    if (!data) return []

    // si viene en formato de error, salimos con []
    if (!data) return []

    // si viene en formato de error, salimos con []
    if (error) {
        console.error(error)
        return []
      }
    
      if (!data || !Array.isArray(data)) {
        return []
      }
    
      // Filtramos cualquier cosa que tenga `error` (GenericStringError)
      const rows = (data as any[]).filter(
        (row): row is TouchRunRow => !(row as any)?.error,
      )
    
      return rows
    }    

async function loadRecentErrors(
  client: ReturnType<typeof supabaseServer>,
): Promise<TouchRunRow[]> {
  if (!client) return []

  const { start, end } = getTodayRangeUTC()

  const { data, error } = await client
    .from("touch_runs")
    .select(
      [
        "id",
        "campaign_id",
        "lead_id",
        "step",
        "channel",
        "scheduled_at",
        "sent_at",
        "status",
        "error",
        "created_at",
        "type",
        "intent",
        "outcome",
        "retry_count",
        "max_retries",
        "message_class",
      ].join(", "),
    )
    .eq("status", "failed")
    .gte("created_at", start)
    .lt("created_at", end)
    .order("created_at", { ascending: false })
    .limit(30)

    if (error) {
        console.error(error)
        return []
      }
    
      if (!data || !Array.isArray(data)) {
        return []
      }
    
      // Filtramos cualquier cosa que tenga `error` (GenericStringError)
      const rows = (data as any[]).filter(
        (row): row is TouchRunRow => !(row as any)?.error,
      )
    
      return rows
    }    

async function loadActivityToday(
  client: ReturnType<typeof supabaseServer>,
): Promise<ActivityToday> {
  const fallback: ActivityToday = {
    touchesTotalToday: 0,
    touchesSentToday: 0,
    touchesFailedToday: 0,
    touchesQueuedToday: 0,
    appointmentNotificationsToday: 0,
  }

  if (!client) return fallback

  const { start, end } = getTodayRangeUTC()

  const [
    totalTouches,
    sentTouches,
    failedTouches,
    queuedTouches,
    apptNotifs,
  ] = await Promise.all([
    client
      .from("touch_runs")
      .select("id", { count: "exact", head: true })
      .gte("created_at", start)
      .lt("created_at", end),
    client
      .from("touch_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "sent")
      .gte("created_at", start)
      .lt("created_at", end),
    client
      .from("touch_runs")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("created_at", start)
      .lt("created_at", end),
    client
      .from("touch_runs")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "scheduled"])
      .gte("created_at", start)
      .lt("created_at", end),
    client
      .from("appointments_notifications")
      .select("id", { count: "exact", head: true })
      .gte("notify_at", start)
      .lt("notify_at", end),
  ])

  return {
    touchesTotalToday: totalTouches.count ?? 0,
    touchesSentToday: sentTouches.count ?? 0,
    touchesFailedToday: failedTouches.count ?? 0,
    touchesQueuedToday: queuedTouches.count ?? 0,
    appointmentNotificationsToday: apptNotifs.count ?? 0,
  }
}

async function loadAppointmentsNotificationsQueue(
  client: ReturnType<typeof supabaseServer>,
): Promise<AppointmentNotificationRow[]> {
  if (!client) return []

  const { start, end } = getTodayRangeUTC()

  const { data, error } = await client
    .from("appointments_notifications")
    .select(
      [
        "id",
        "org_id",
        "appointment_id",
        "channel",
        "notify_at",
        "status",
        "created_at",
        "sent_at",
        "error",
      ].join(", "),
    )
    .in("status", ["queued", "pending"])
    .gte("notify_at", start)
    .lt("notify_at", end)
    .order("notify_at", { ascending: true })
    .limit(30)

    if (error) {
        console.error(error)
        return []
      }
    
      if (!data || !Array.isArray(data)) {
        return []
      }
    
      // Filtramos posibles GenericStringError[]
      const rows = (data as any[]).filter(
        (row): row is AppointmentNotificationRow => !(row as any)?.error,
      )
    
      return rows
    }    

// --------- Helpers UI ---------

function channelIcon(channel: string | null) {
  const c = (channel ?? "").toLowerCase()
  const base = "h-4 w-4"

  if (c === "email") return <Mail className={base} />
  if (c === "whatsapp") return <MessageCircle className={base} />
  if (c === "sms") return <Waves className={base} />
  if (c === "voice" || c === "phone") return <PhoneCall className={base} />
  if (c === "zoom") return <CalendarClock className={base} />
  return <Activity className={base} />
}

function channelBadge(channel: string | null) {
  const c = (channel ?? "").toLowerCase()
  let classes =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"

  if (c === "email") {
    classes += " border-sky-400/60 bg-sky-500/10 text-sky-100"
  } else if (c === "whatsapp") {
    classes += " border-emerald-400/60 bg-emerald-500/10 text-emerald-100"
  } else if (c === "sms") {
    classes += " border-indigo-400/60 bg-indigo-500/10 text-indigo-100"
  } else if (c === "voice" || c === "phone") {
    classes += " border-amber-400/60 bg-amber-500/10 text-amber-100"
  } else if (c === "zoom") {
    classes += " border-fuchsia-400/60 bg-fuchsia-500/10 text-fuchsia-100"
  } else {
    classes += " border-white/20 bg-white/5 text-white/70"
  }

  return (
    <span className={classes}>
      {channelIcon(channel)}
      <span className="capitalize">{channel ?? "—"}</span>
    </span>
  )
}

function statusBadge(status: string | null) {
  const s = (status ?? "").toLowerCase()
  let className =
    "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]"

  if (s === "sent") {
    className +=
      " border-emerald-400/70 bg-emerald-500/10 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.35)]"
    return (
      <span className={className}>
        <CheckCircle2 className="h-3 w-3" />
        sent
      </span>
    )
  }

  if (s === "failed") {
    className +=
      " border-rose-400/70 bg-rose-500/10 text-rose-100 shadow-[0_0_20px_rgba(244,63,94,0.45)]"
    return (
      <span className={className}>
        <AlertTriangle className="h-3 w-3" />
        failed
      </span>
    )
  }

  if (s === "queued" || s === "scheduled") {
    className +=
      " border-amber-400/70 bg-amber-500/10 text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.35)]"
    return (
      <span className={className}>
        <Zap className="h-3 w-3" />
        {s}
      </span>
    )
  }

  className += " border-white/20 bg-white/5 text-white/70"
  return <span className={className}>{status ?? "unknown"}</span>
}

function tinyPill(text: string) {
  return (
    <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-[2px] text-[10px] uppercase tracking-[0.16em] text-white/50">
      {text}
    </span>
  )
}

function MetricTile({
  label,
  value,
  helper,
  icon,
}: {
  label: string
  value: number
  helper: string
  icon: React.ReactNode
}) {
  return (
    <Card className="border-white/10 bg-gradient-to-b from-slate-900/40 via-slate-900/10 to-slate-900/0">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white/10">
          {icon}
        </div>
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">
            {label}
          </p>
          <p className="text-2xl font-semibold text-white">{value}</p>
          <p className="text-[11px] text-white/50">{helper}</p>
        </div>
      </CardContent>
    </Card>
  )
}

// --------- Secciones UI ---------

function LiveQueueSection({ rows }: { rows: TouchRunRow[] }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Live queue"
        description="Touches en cola listos para salir (multi-canal)."
      />
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-white/60">
            No hay touches en cola ahora mismo.
          </p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Lead</TableHeaderCell>
                <TableHeaderCell>Channel</TableHeaderCell>
                <TableHeaderCell>Step</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Meta</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Scheduled / Age
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const leadLabel =
                  row.lead_id?.slice(0, 8).toUpperCase() ?? "UNKNOWN"
                const campaignLabel =
                  row.campaign_id?.slice(0, 8).toUpperCase() ?? "—"
                const metaChips: string[] = []
                if (row.type) metaChips.push(row.type)
                if (row.intent) metaChips.push(row.intent)
                if (row.message_class) metaChips.push(row.message_class)

                return (
                  <TableRow
                    key={row.id}
                    className="transition hover:bg-white/10"
                  >
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        {row.lead_id ? (
                          <Link
                            href={`/leads/${row.lead_id}`}
                            className="text-sm font-semibold text-white hover:underline"
                          >
                            {leadLabel}
                          </Link>
                        ) : (
                          <span className="text-sm font-semibold text-white">
                            {leadLabel}
                          </span>
                        )}
                        <p className="text-[11px] text-white/45">
                          Campaign: {campaignLabel}
                        </p>
                      </div>
                    </TableCell>
                    <TableCell>{channelBadge(row.channel)}</TableCell>
                    <TableCell className="text-sm text-white/80">
                      {row.step != null ? (
                        <span className="inline-flex items-center rounded-full bg-white/5 px-2 py-[2px] text-[11px] text-white/70">
                          #{row.step}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell>
                      {metaChips.length === 0 ? (
                        <span className="text-[11px] text-white/40">
                          —
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {metaChips.map((m) => (
                            <span
                              key={m}
                              className="inline-flex items-center rounded-full bg-white/5 px-2 py-[2px] text-[10px] text-white/60"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-[11px] text-white/60">
                      <div className="space-y-0.5">
                        <span>{formatDate(row.scheduled_at)}</span>
                        <span className="block text-white/40">
                          {timeAgo(row.scheduled_at)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function RecentErrorsSection({ rows }: { rows: TouchRunRow[] }) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Recent errors"
        description="Fallos de entrega hoy por canal."
      />
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-emerald-200">
            <CheckCircle2 className="h-4 w-4" />
            <span>Sin errores hoy. Motor limpio. 🙌</span>
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>When</TableHeaderCell>
                <TableHeaderCell>Lead</TableHeaderCell>
                <TableHeaderCell>Channel</TableHeaderCell>
                <TableHeaderCell>Error</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Status
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const leadLabel =
                  row.lead_id?.slice(0, 8).toUpperCase() ?? "UNKNOWN"
                const errorText = row.error ?? "unknown error"
                const shortError =
                  errorText.length > 90
                    ? `${errorText.slice(0, 90)}…`
                    : errorText

                return (
                  <TableRow
                    key={row.id}
                    className="transition hover:bg-white/10"
                  >
                    <TableCell className="text-[11px] text-white/70">
                      <div className="space-y-0.5">
                        <span>{formatDate(row.created_at)}</span>
                        <span className="block text-white/40">
                          {timeAgo(row.created_at)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {row.lead_id ? (
                        <Link
                          href={`/leads/${row.lead_id}`}
                          className="text-sm font-semibold text-white hover:underline"
                        >
                          {leadLabel}
                        </Link>
                      ) : (
                        <span className="text-sm font-semibold text-white">
                          {leadLabel}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{channelBadge(row.channel)}</TableCell>
                    <TableCell className="max-w-md text-xs text-rose-200">
                      {shortError}
                    </TableCell>
                    <TableCell className="text-right">
                      {statusBadge(row.status)}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function AppointmentNotificationsSection({
  rows,
}: {
  rows: AppointmentNotificationRow[]
}) {
  return (
    <Card className="border-white/10 bg-white/5">
      <CardHeader
        title="Appointment notifications"
        description="Recordatorios de citas en cola para hoy."
      />
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 p-4 text-sm text-white/60">
            <CalendarClock className="h-4 w-4 text-white/40" />
            <span>No hay notificaciones de citas en cola para hoy.</span>
          </div>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Appointment</TableHeaderCell>
                <TableHeaderCell>Channel</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell className="text-right">
                  Notify at
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => {
                const apptLabel =
                  row.appointment_id?.slice(0, 8).toUpperCase() ?? "UNKNOWN"
                return (
                  <TableRow
                    key={row.id}
                    className="transition hover:bg-white/10"
                  >
                    <TableCell className="text-sm text-white">
                      {apptLabel}
                    </TableCell>
                    <TableCell>{channelBadge(row.channel)}</TableCell>
                    <TableCell>{statusBadge(row.status)}</TableCell>
                    <TableCell className="text-right text-[11px] text-white/70">
                      <div className="space-y-0.5">
                        <span>{formatDate(row.notify_at)}</span>
                        <span className="block text-white/40">
                          {timeAgo(row.notify_at)}
                        </span>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

// --------- Página principal ---------

export default async function OperatorPage() {
  const supabase = supabaseServer()

  const [liveQueue, recentErrors, activityToday, apptNotifications] =
    await Promise.all([
      loadLiveQueue(supabase),
      loadRecentErrors(supabase),
      loadActivityToday(supabase),
      loadAppointmentsNotificationsQueue(supabase),
    ])

  const totalQueued = liveQueue.length
  const hasErrorsToday = recentErrors.length > 0

  const engineLabel = hasErrorsToday
    ? "Execution engine con errores hoy"
    : totalQueued > 0
    ? `Execution engine activo · ${totalQueued} en cola`
    : "Execution engine idle pero sano"

  const engineVariant: "neutral" | "warning" | "destructive" = hasErrorsToday
    ? "destructive"
    : totalQueued > 0
    ? "neutral"
    : "warning"

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.16em] text-white/50">
            Operations · Execution layer
          </p>
          <h1 className="text-3xl font-semibold text-white">
            Operator Cockpit
          </h1>
          <p className="text-sm text-white/60">
            Vista en tiempo casi real del motor que manda emails, WhatsApps,
            SMS, llamadas y recordatorios de citas.
          </p>
          <p className="text-[11px] text-white/40">
            {tinyPill("Today · UTC")}
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

      {/* Tiles actividad hoy */}
      <div className="grid gap-3 md:grid-cols-5">
        <MetricTile
          label="Touches hoy"
          value={activityToday.touchesTotalToday}
          helper="Todos los canales"
          icon={<Zap className="h-4 w-4 text-emerald-200" />}
        />
        <MetricTile
          label="Sent"
          value={activityToday.touchesSentToday}
          helper="Entregados hoy"
          icon={<CheckCircle2 className="h-4 w-4 text-emerald-200" />}
        />
        <MetricTile
          label="Failed"
          value={activityToday.touchesFailedToday}
          helper="Con error hoy"
          icon={<AlertTriangle className="h-4 w-4 text-rose-200" />}
        />
        <MetricTile
          label="Queued"
          value={activityToday.touchesQueuedToday}
          helper="Creados hoy"
          icon={<Activity className="h-4 w-4 text-amber-200" />}
        />
        <MetricTile
          label="Cita – notifs"
          value={activityToday.appointmentNotificationsToday}
          helper="Recordatorios hoy"
          icon={<CalendarClock className="h-4 w-4 text-sky-200" />}
        />
      </div>

      {/* Live queue + errores */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)]">
        <LiveQueueSection rows={liveQueue} />
        <RecentErrorsSection rows={recentErrors} />
      </div>

      {/* Notifs de citas */}
      <AppointmentNotificationsSection rows={apptNotifications} />
    </div>
  )
}
