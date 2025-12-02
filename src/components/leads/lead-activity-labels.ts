import { type TouchRunRow } from "./timeline-utils"

export function formatTouchPreview(payload: unknown): string {
  if (!payload) return ""

  const payloadObject =
    typeof payload === "object" && payload !== null ? (payload as Record<string, unknown>) : null

  const source = typeof payloadObject?.source === "string" ? payloadObject.source : null

  if (source === "appointment_reminder") {
    const kind = typeof payloadObject?.kind === "string" ? payloadObject.kind : null
    if (kind === "appointment_reminder_24h") return "Recordatorio 24h antes de la cita"
    if (kind === "appointment_reminder_1h") return "Recordatorio 1h antes de la cita"
    if (kind === "appointment_reminder_10m") return "Recordatorio 10m antes de la cita"
  }

  if (source === "appointment_outcome") {
    const kind = typeof payloadObject?.kind === "string" ? payloadObject.kind : null
    if (kind === "no_show_followup_15m") return "Follow-up por no-show (15 min después)"
    if (kind === "attended_followup_30m") return "Follow-up después de cita atendida (30 min)"
  }

  const script = payloadObject?.script
  if (typeof script === "string") {
    const trimmed = script.trim()
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed
  }

  const maybeMessage = payloadObject?.message ?? payloadObject?.body ?? payloadObject?.subject
  if (typeof maybeMessage === "string") {
    const trimmed = maybeMessage.trim()
    if (trimmed) return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed
  }

  if (typeof payload === "string") {
    const trimmed = payload.trim()
    return trimmed.length > 120 ? `${trimmed.slice(0, 120)}…` : trimmed
  }

  if (typeof payloadObject?.reason === "string") {
    return `Motivo interno: ${payloadObject.reason}`
  }

  return ""
}

type ReminderKind =
  | "appointment_reminder_24h"
  | "appointment_reminder_1h"
  | "appointment_reminder_10m"
  | string

export function describeTouchRun(step: TouchRunRow) {
  const source =
    (step.payload?.source as string | undefined) ??
    (step.meta?.source as string | undefined) ??
    null
  const kind =
    (step.payload?.kind as ReminderKind | undefined) ??
    (step.meta?.kind as ReminderKind | undefined) ??
    null
  const stepNumber = step.step ?? undefined

  if (source === "appointment_reminder" && stepNumber) {
    const reminderLabel = describeReminder(kind)
    return {
      label: reminderLabel ?? "Appointment reminder", // fallback
      description: formatTouchPreview(step.payload),
    }
  }

  if (source === "appointment_outcome" && stepNumber) {
    const followup = kind === "no_show_followup_15m"
    const attended = kind === "attended_followup_30m"
    return {
      label: followup
        ? "No-show follow-up"
        : attended
          ? "Attended follow-up"
          : "Appointment outcome follow-up",
      description: formatTouchPreview(step.payload),
    }
  }

  return {
    label: stepNumber ? `Cadence touch (step ${stepNumber})` : "Cadence touch",
    description: formatTouchPreview(step.payload),
  }
}

export function describeReminder(kind: ReminderKind | null | undefined) {
  if (!kind) return null

  if (kind === "appointment_reminder_24h") {
    return "Appointment reminder (24h before)"
  }
  if (kind === "appointment_reminder_1h") {
    return "Appointment reminder (1h before)"
  }
  if (kind === "appointment_reminder_10m") {
    return "Appointment reminder (10m before)"
  }

  return null
}

export function describeAppointmentOutcome(outcome: string | null | undefined) {
  const normalized = outcome?.toLowerCase()
  if (!normalized) return "Appointment outcome"
  if (normalized === "show" || normalized === "attended") {
    return "Appointment attended"
  }
  if (normalized === "no_show") {
    return "Appointment no-show"
  }
  return "Appointment outcome"
}
