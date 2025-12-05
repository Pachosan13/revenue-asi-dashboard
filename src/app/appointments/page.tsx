import React from "react"
import { createClient } from "@supabase/supabase-js"
import { CalendarDays, Mail, Building2, AlertTriangle } from "lucide-react"

import AppointmentOutcomeButtons from "@/components/appointments/AppointmentOutcomeButtons"
import { ChannelBadge } from "@/components/leads/badges"
import { Badge, Card, CardContent, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui-custom"

function formatDateTime(value: string | null) {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

type AppointmentLead = {
  contact_name: string | null
  company_name: string | null
  email: string | null
}

type AppointmentWithLead = {
  id: string
  lead_id: string
  channel: string | null
  scheduled_for: string | null
  starts_at: string | null
  status: string | null
  outcome: "attended" | "no_show" | null
  created_at: string
  lead: AppointmentLead | null
}

type AppointmentRow = AppointmentWithLead & { leads?: AppointmentLead | null }

async function fetchAppointments() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    return {
      appointments: [] as AppointmentWithLead[],
      error: "Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to load data.",
    }
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey)

  const { data, error } = await supabase
    .from("appointments")
    .select(
      `id, lead_id, channel, scheduled_for, starts_at, status, outcome, created_at, leads:leads(contact_name, company_name, email)`,
    )
    .order("starts_at", { ascending: false, nullsFirst: false })
    .order("scheduled_for", { ascending: false, nullsFirst: false })

  if (error) {
    console.error(error)
    return { appointments: [] as AppointmentWithLead[], error: "Unable to fetch appointments." }
  }

  const rows = (data ?? []) as unknown as AppointmentRow[]

  const appointments: AppointmentWithLead[] = rows.map((row) => ({
    id: row.id,
    lead_id: row.lead_id,
    channel: row.channel,
    scheduled_for: row.scheduled_for,
    starts_at: row.starts_at,
    status: row.status,
    outcome: row.outcome,
    created_at: row.created_at,
    lead: row.leads ?? null,
  }))

  return { appointments, error: null as string | null }
}

export default async function AppointmentsPage() {
  const { appointments, error } = await fetchAppointments()

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm uppercase tracking-[0.16em] text-white/50">Bookings</p>
          <h1 className="text-3xl font-semibold text-white">Appointments</h1>
          <p className="text-white/60">Manage booked meetings and outcomes across leads.</p>
        </div>
        <Badge variant="outline" className="gap-2 bg-white/5 text-white/80">
          <CalendarDays size={16} />
          {appointments.length} total
        </Badge>
      </div>

      {error ? (
        <div className="flex items-start gap-2 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-amber-50">
          <AlertTriangle size={18} className="mt-0.5" />
          <p className="text-sm">{error}</p>
        </div>
      ) : null}

      <Card>
        <CardContent className="space-y-4">
          {appointments.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-6 text-white/70">
              No appointments found.
            </div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Date / Time</TableHeaderCell>
                    <TableHeaderCell>Contact</TableHeaderCell>
                    <TableHeaderCell>Company</TableHeaderCell>
                    <TableHeaderCell>Channel</TableHeaderCell>
                    <TableHeaderCell>Outcome</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {appointments.map((appointment) => {
                    const dateValue = appointment.starts_at ?? appointment.scheduled_for
                    const lead = appointment.lead

                    return (
                      <TableRow key={appointment.id}>
                        <TableCell className="whitespace-nowrap text-white/80">{formatDateTime(dateValue)}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white/70">
                              <Mail size={16} />
                            </div>
                            <div className="flex flex-col">
                              <span className="font-semibold text-white">{lead?.contact_name ?? "Unknown lead"}</span>
                              <span className="text-xs text-white/50">{lead?.email ?? "No email"}</span>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-white/80">
                          <div className="flex items-center gap-2">
                            <Building2 size={14} className="text-white/40" />
                            <span>{lead?.company_name ?? "—"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <ChannelBadge channel={appointment.channel ?? undefined} />
                        </TableCell>
                        <TableCell>
                          <AppointmentOutcomeButtons
                            appointmentId={appointment.id}
                            currentOutcome={
                              appointment.outcome === "attended"
                                ? "show"
                                : appointment.outcome === "no_show"
                                  ? "no_show"
                                  : null
                            }
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
