import { formatPreview, type TouchRunRow } from "./timeline-utils"

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
      description: formatPreview(step.payload),
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
      description: formatPreview(step.payload),
    }
  }

  return {
    label: stepNumber ? `Cadence touch (step ${stepNumber})` : "Cadence touch",
    description: formatPreview(step.payload),
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
