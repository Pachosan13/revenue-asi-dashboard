/* eslint-disable @typescript-eslint/no-explicit-any */

export type TouchRunRow = {
  id: string
  campaign_id: string | null
  campaign_run_id: string | null
  lead_id: string | null
  step: number | null
  channel: string | null
  status: string | null
  payload: any
  scheduled_at: string | null
  sent_at: string | null
  created_at: string
  error: string | null
  meta: any
}

export const touchRunSelect =
  "id, campaign_id, campaign_run_id, lead_id, step, channel, status, payload, scheduled_at, sent_at, created_at, error, meta"

export const channelLabel: Record<string, string> = {
  whatsapp: "WhatsApp",
  sms: "SMS",
  email: "Email",
  voice: "Voice",
}

export function getWhen(step: TouchRunRow) {
  return step.sent_at ?? step.scheduled_at ?? step.created_at ?? null
}

export function formatPreview(payload: any) {
  if (!payload) return "—"
  let preview: string

  if (typeof payload === "string") {
    preview = payload
  } else if (typeof payload === "object") {
    const maybeMessage = (payload as Record<string, unknown>).message
    const maybeBody = (payload as Record<string, unknown>).body
    const maybeSubject = (payload as Record<string, unknown>).subject
    if (typeof maybeMessage === "string") preview = maybeMessage
    else if (typeof maybeBody === "string") preview = maybeBody
    else if (typeof maybeSubject === "string") preview = maybeSubject
    else preview = JSON.stringify(payload)
  } else {
    preview = String(payload)
  }

  if (preview.length > 140) return `${preview.slice(0, 140)}…`
  return preview
}

export function statusVariant(status: string | null) {
  const normalized = status?.toLowerCase()
  if (normalized === "sent") return "success" as const
  if (normalized === "scheduled" || normalized === "pending") return "warning" as const
  if (normalized === "failed" || normalized === "error") return "destructive" as const
  return "neutral" as const
}

export function formatDate(dateString: string | null, options?: Intl.DateTimeFormatOptions) {
  if (!dateString) return null
  const parsed = new Date(dateString)
  if (Number.isNaN(parsed.getTime())) return null
  return new Intl.DateTimeFormat("en-US", options).format(parsed)
}

export async function fetchLeadTouchRuns(
  client: Pick<
    import("@supabase/supabase-js").SupabaseClient,
    "from"
  >,
  leadId: string,
) {
  return client
    .from("touch_runs")
    .select(touchRunSelect)
    .eq("lead_id", leadId)
    .order("sent_at", { ascending: false, nullsLast: true } as any)
    .order("scheduled_at", { ascending: false, nullsLast: true } as any)
    .order("created_at", { ascending: false })
}
