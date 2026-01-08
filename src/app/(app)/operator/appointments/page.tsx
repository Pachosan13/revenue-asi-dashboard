"use client";

import { useEffect, useMemo, useState } from "react";

type AppointmentLead = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

type Appointment = {
  appointment_id: string;
  lead_id: string;
  account_id: string;
  starts_at: string;
  scheduled_for: string | null;
  timestamp: number | null;
  channel: string;
  status: string;
  notes: string | null;
  created_at: string;
  lead: AppointmentLead;
};

type ApiResponse = {
  ok: boolean;
  account_id: string;
  count: number;
  appointments: Appointment[];
};

type ActionType = "show" | "no_show" | "rescheduled" | "canceled";

type AppointmentKpi = {
  account_id: string;
  campaign_id: string | null;
  campaign_name: string | null;
  total_scheduled: number;
  total_completed: number;
  total_no_show: number;
  total_canceled: number;
  total_rescheduled: number;
  show_rate_pct: number;
  no_show_rate_pct: number;
  calendar_count: number;
  zoom_count: number;
  phone_count: number;
  avg_time_to_appointment: string | null;
};

type ChannelKpi = {
  account_id: string;
  channel: string;
  total_appointments: number;
  shows: number;
  no_shows: number;
  canceled: number;
  show_rate_pct: number;
};

type KpisResponse = {
  ok: boolean;
  account_id: string;
  campaigns: AppointmentKpi[];
  channels: ChannelKpi[];
};

const ACCOUNT_ID = "a0e3fc34-0bc4-410f-b363-a25b00fa16b8"; // tu cuenta por ahora

function formatDateLabel(d: Date) {
  return d.toLocaleDateString("es-PA", {
    weekday: "long",
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatTime(d: Date) {
  return d.toLocaleTimeString("es-PA", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadgeClasses(status: string) {
  const s = String(status ?? "").toLowerCase().replace(/^cancell?ed$/, "canceled");
  switch (s) {
    case "scheduled":
      return "bg-blue-500/10 text-blue-400 border border-blue-500/30";
    case "completed":
      return "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30";
    case "no_show":
      return "bg-red-500/10 text-red-400 border border-red-500/30";
    case "canceled":
      return "bg-slate-500/10 text-slate-300 border border-slate-500/30";
    default:
      return "bg-slate-500/10 text-slate-300 border border-slate-500/30";
  }
}

function channelLabel(channel: string) {
  if (channel === "calendar") return "Calendario";
  if (channel === "zoom") return "Zoom";
  if (channel === "phone") return "Llamada";
  if (channel === "in_person") return "En persona";
  return channel;
}

export default function OperatorAppointmentsPage() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [daysFilter, setDaysFilter] = useState<string>("7");
  const [statusFilter, setStatusFilter] = useState<string>("scheduled");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const [kpis, setKpis] = useState<KpisResponse | null>(null);
  const [kpiError, setKpiError] = useState<string | null>(null);

  // Cargar citas
  useEffect(() => {
    const fetchAppointments = async () => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams();
        params.set("account_id", ACCOUNT_ID);
        if (daysFilter) params.set("days", daysFilter);
        if (statusFilter) params.set("status", statusFilter);

        const res = await fetch(`/api/appointments?${params.toString()}`);

        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Error al cargar citas");
        }

        const body: ApiResponse = await res.json();
        if (!body.ok) {
          throw new Error((body as any).error || "Error al cargar citas");
        }

        setAppointments(body.appointments || []);
      } catch (e: any) {
        console.error(e);
        setError(e.message ?? "Error inesperado");
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [daysFilter, statusFilter]);

  // Cargar KPIs de citas
  useEffect(() => {
    const fetchKpis = async () => {
      try {
        setKpiError(null);
        const params = new URLSearchParams();
        params.set("account_id", ACCOUNT_ID);

        const res = await fetch(`/api/kpis/appointments?${params.toString()}`);
        const body = (await res.json().catch(() => ({}))) as KpisResponse & {
          error?: string;
        };

        if (!res.ok || body.ok === false) {
          throw new Error(body.error || "Error al cargar KPIs de citas");
        }

        setKpis(body);
      } catch (e: any) {
        console.error(e);
        setKpiError(e.message ?? "Error al cargar KPIs de citas");
      }
    };

    fetchKpis();
  }, []);

  const groupedByDate = useMemo(() => {
    const groups: Record<string, Appointment[]> = {};

    for (const appt of appointments) {
      if (!appt.starts_at) continue;
      const d = new Date(appt.starts_at);
      const key = d.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!groups[key]) groups[key] = [];
      groups[key].push(appt);
    }

    const sortedKeys = Object.keys(groups).sort();
    return sortedKeys.map((dateKey) => ({
      dateKey,
      date: new Date(dateKey),
      items: groups[dateKey].sort(
        (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
      ),
    }));
  }, [appointments]);

  // KPIs agregados para tiles
  const tiles = useMemo(() => {
    if (!kpis?.campaigns || kpis.campaigns.length === 0) {
      return {
        totalScheduled: 0,
        globalShowRate: 0,
        topChannel: "-",
      };
    }

    const totalScheduled = kpis.campaigns.reduce(
      (acc, c) => acc + (c.total_scheduled || 0),
      0,
    );
    const totalCompleted = kpis.campaigns.reduce(
      (acc, c) => acc + (c.total_completed || 0),
      0,
    );

    const globalShowRate =
      totalScheduled > 0 ? (totalCompleted / totalScheduled) * 100 : 0;

    let topChannel = "-";
    if (kpis.channels && kpis.channels.length > 0) {
      const sorted = [...kpis.channels].sort(
        (a, b) => (b.show_rate_pct || 0) - (a.show_rate_pct || 0),
      );
      topChannel = sorted[0]?.channel || "-";
    }

    return {
      totalScheduled,
      globalShowRate,
      topChannel,
    };
  }, [kpis]);

  async function handleAction(appt: Appointment, action: ActionType) {
    try {
      if (updatingId) return;
      setUpdatingId(appt.appointment_id);
      setError(null);

      let newStartsAt: string | undefined;

      if (action === "rescheduled") {
        const current = appt.starts_at
          ? new Date(appt.starts_at).toISOString().slice(0, 16)
          : "";
        const input = window.prompt(
          "Nueva fecha/hora en ISO (ej: 2025-12-11T15:00):",
          current,
        );
        if (!input) {
          setUpdatingId(null);
          return;
        }
        const normalized = input.length === 16 ? `${input}:00Z` : input;
        newStartsAt = normalized;
      }

      const res = await fetch(
        `/api/appointments/${appt.appointment_id}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            account_id: ACCOUNT_ID,
            action,
            new_starts_at: newStartsAt,
            appointment_id: appt.appointment_id, // fallback extra, por si los params fallan
          }),
        },
      );      

      const body = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        appointment?: {
          id: string;
          status: string;
          outcome: string | null;
          starts_at: string | null;
          scheduled_for: string | null;
        };
      };

      if (!res.ok || body.ok === false) {
        throw new Error(body.error || "Error al actualizar cita");
      }

      const updated = body.appointment!;
      setAppointments((prev) =>
        prev.map((p) =>
          p.appointment_id === updated.id
            ? {
                ...p,
                status: updated.status,
                starts_at: updated.starts_at ?? p.starts_at,
                scheduled_for: updated.scheduled_for ?? p.scheduled_for,
                timestamp: updated.starts_at
                  ? new Date(updated.starts_at).getTime()
                  : p.timestamp,
                notes:
                  action === "rescheduled"
                    ? "Reprogramada desde Operator"
                    : p.notes,
              }
            : p,
        ),
      );
    } catch (e: any) {
      console.error(e);
      setError(e.message ?? "Error al actualizar cita");
    } finally {
      setUpdatingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      {/* KPIs tiles arriba del header */}
      {kpis && !kpiError && (
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Citas futuras
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-50">
              {tiles.totalScheduled}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Show rate global
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-50">
              {tiles.globalShowRate.toFixed(1)}%
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-400">
              Mejor canal
            </div>
            <div className="mt-2 text-2xl font-semibold text-slate-50">
              {tiles.topChannel === "-"
                ? "-"
                : channelLabel(tiles.topChannel)}
            </div>
          </div>
        </div>
      )}

      {kpiError && (
        <div className="rounded-xl border border-amber-700/50 bg-amber-950/40 p-3 text-xs text-amber-200">
          Error al cargar KPIs de citas: {kpiError}
        </div>
      )}

      <header className="mt-1 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Agenda de Citas
          </h1>
          <p className="text-sm text-slate-400">
            Próximas citas conectadas desde GHL → Revenue ASI, listas para marcar show / no-show / reprogramar.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Rango</span>
            <select
              value={daysFilter}
              onChange={(e) => setDaysFilter(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
            >
              <option value="1">Hoy</option>
              <option value="3">Próx. 3 días</option>
              <option value="7">Próx. 7 días</option>
              <option value="14">Próx. 14 días</option>
              <option value="">Todo futuro</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-400">Estado</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
            >
              <option value="scheduled">Programadas</option>
              <option value="">Todas</option>
              <option value="completed">Completadas</option>
              <option value="no_show">No show</option>
              <option value="canceled">Canceladas</option>
            </select>
          </div>
        </div>
      </header>

      {loading && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-300">
          Cargando citas…
        </div>
      )}

      {!loading && error && (
        <div className="rounded-xl border border-red-700/50 bg-red-950/40 p-4 text-sm text-red-200">
          Error: {error}
        </div>
      )}

      {!loading && !error && groupedByDate.length === 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-6 text-sm text-slate-400">
          No hay citas futuras con los filtros actuales.
        </div>
      )}

      {!loading && !error && groupedByDate.length > 0 && (
        <div className="flex flex-col gap-6">
          {groupedByDate.map((group) => (
            <section
              key={group.dateKey}
              className="rounded-xl border border-slate-800 bg-slate-950/60 p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-300">
                  {formatDateLabel(group.date)}
                </h2>
                <span className="text-xs text-slate-500">
                  {group.items.length} cita
                  {group.items.length !== 1 ? "s" : ""}
                </span>
              </div>

              <div className="flex flex-col divide-y divide-slate-800/80">
                {group.items.map((appt) => {
                  const d = appt.starts_at
                    ? new Date(appt.starts_at)
                    : null;

                  const isUpdating = updatingId === appt.appointment_id;

                  return (
                    <div
                      key={appt.appointment_id}
                      className="flex flex-col gap-3 py-3 md:flex-row md:items-center md:justify-between"
                    >
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5 text-sm font-mono text-slate-300">
                          {d ? formatTime(d) : "--:--"}
                        </div>
                        <div className="flex flex-col">
                          <div className="text-sm font-medium text-slate-100">
                            {appt.lead.name || "Sin nombre"}
                          </div>
                          <div className="text-xs text-slate-400">
                            {appt.lead.email && (
                              <span>{appt.lead.email}</span>
                            )}
                            {appt.lead.email && appt.lead.phone && (
                              <span className="mx-1 text-slate-600">
                                •
                              </span>
                            )}
                            {appt.lead.phone && (
                              <span>{appt.lead.phone}</span>
                            )}
                          </div>
                          {appt.notes && (
                            <div className="mt-1 text-xs text-slate-500">
                              {appt.notes}
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col items-start gap-2 md:flex-row md:items-center">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${statusBadgeClasses(
                              appt.status,
                            )}`}
                          >
                            {appt.status}
                          </span>
                          <span className="rounded-full border border-slate-700/60 bg-slate-900/70 px-2 py-0.5 text-xs text-slate-300">
                            {channelLabel(appt.channel)}
                          </span>
                        </div>

                        <div className="flex flex-wrap gap-2 text-xs">
                          <button
                            disabled={isUpdating}
                            onClick={() => handleAction(appt, "show")}
                            className="rounded-md border border-emerald-600/60 bg-emerald-900/30 px-2 py-1 text-emerald-200 hover:bg-emerald-900/60 disabled:opacity-40"
                          >
                            ✅ Show
                          </button>
                          <button
                            disabled={isUpdating}
                            onClick={() => handleAction(appt, "no_show")}
                            className="rounded-md border border-red-600/60 bg-red-900/30 px-2 py-1 text-red-200 hover:bg-red-900/60 disabled:opacity-40"
                          >
                            ❌ No show
                          </button>
                          <button
                            disabled={isUpdating}
                            onClick={() => handleAction(appt, "rescheduled")}
                            className="rounded-md border border-amber-500/60 bg-amber-900/30 px-2 py-1 text-amber-200 hover:bg-amber-900/60 disabled:opacity-40"
                          >
                            🔁 Reprogramar
                          </button>
                          <button
                            disabled={isUpdating}
                            onClick={() => handleAction(appt, "canceled")}
                            className="rounded-md border border-slate-600/60 bg-slate-900/40 px-2 py-1 text-slate-200 hover:bg-slate-900/80 disabled:opacity-40"
                          >
                            🗑 Cancelar
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
