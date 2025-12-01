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

async function loadEngines(client: ReturnType<typeof supabaseServer>) {
  if (!client)
    return JOB_NAMES.map<EngineStatus>((name) => ({
      name,
      schedule: null,
      lastRun: null,
      status: "No data",
    }))

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
    const payloadHasError = Boolean(log?.payload && typeof log.payload === "object" && "error" in log.payload)
    let status: EngineStatus["status"] = "No data"

    if (log) {
      status = payloadHasError ? "Error" : "OK"
    }

    const lastRun = log?.created_at ?? null

    return {
      name,
      schedule: scheduleMap.get(name) ?? null,
      lastRun,
      status,
    }
  })
}

async function loadAppointmentMetrics(client: ReturnType<typeof supabaseServer>): Promise<AppointmentMetrics> {
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

async function loadLeadMetrics(client: ReturnType<typeof supabaseServer>): Promise<LeadMetrics> {
  const fallback: LeadMetrics = {
    newLeadsToday: 0,
    leadsWithAppointments: 0,
    showsToday: 0,
    noShowsToday: 0,
  }

  if (!client) return fallback

  const { start, end } = getTodayRange()

  const [newLeads, shows, noShows, leadAppointments] = await Promise.all([
    client.from("leads").select("id", { count: "exact", head: true }).gte("created_at", start).lt("created_at", end),
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

function StatusBadge({ status }: { status: EngineStatus["status"] }) {
  const variant = status === "Error" ? "destructive" : status === "No data" ? "warning" : "neutral"
  return <Badge variant={variant}>{status}</Badge>
}

function MetricTile({ label, value, helper }: { label: string; value: number; helper: string }) {
  return (
    <Card className="bg-white/5">
      <CardContent className="space-y-1 p-4">
        <p className="text-xs uppercase tracking-[0.16em] text-white/50">{label}</p>
        <p className="text-2xl font-semibold text-white">{value}</p>
        <p className="text-xs text-white/50">{helper}</p>
      </CardContent>
    </Card>
  )
}

export default async function DirectorPage() {
  const supabase = supabaseServer()

  const [engines, appointmentMetrics, leadMetrics] = await Promise.all([
    loadEngines(supabase),
    loadAppointmentMetrics(supabase),
    loadLeadMetrics(supabase),
  ])

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Operations</p>
          <h1 className="text-3xl font-semibold text-white">Director Dashboard</h1>
          <p className="text-sm text-white/60">High-level pulse of the Revenue ASI engines and flows.</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="border-white/10 bg-white/5">
          <CardHeader
            title="Engines"
            description="Core cron jobs and their latest activity"
          />
          <CardContent className="p-0">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Job</TableHeaderCell>
                  <TableHeaderCell>Schedule</TableHeaderCell>
                  <TableHeaderCell>Last run</TableHeaderCell>
                  <TableHeaderCell className="text-right">Status</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {engines.map((engine) => (
                  <TableRow key={engine.name}>
                    <TableCell className="font-semibold text-white">{engine.name}</TableCell>
                    <TableCell className="text-white/70">{engine.schedule ?? "--"}</TableCell>
                    <TableCell className="text-white/60">
                      {engine.lastRun ? dateTimeFormatter.format(new Date(engine.lastRun)) : "--"}
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

        <div className="grid gap-4">
          <Card className="border-white/10 bg-white/5">
          <CardHeader
            title="Appointments"
            description="Today’s scheduled activity"
          />
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <MetricTile label="Appointments" value={appointmentMetrics.appointmentsToday} helper="Starts today" />
              <MetricTile label="Reminders" value={appointmentMetrics.remindersToday} helper="Notification jobs" />
              <MetricTile
                label="Reminder touch runs"
                value={appointmentMetrics.reminderTouchRunsToday}
                helper="Step 200-202 scheduled"
              />
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-white/5">
            <CardHeader title="Lead Flow" description="Top-of-funnel signals" />
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <MetricTile label="New leads" value={leadMetrics.newLeadsToday} helper="Created today" />
              <MetricTile label="Leads w/ appts" value={leadMetrics.leadsWithAppointments} helper="Distinct leads" />
              <MetricTile label="Shows" value={leadMetrics.showsToday} helper="Outcome: show" />
              <MetricTile label="No-shows" value={leadMetrics.noShowsToday} helper="Outcome: no_show" />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
