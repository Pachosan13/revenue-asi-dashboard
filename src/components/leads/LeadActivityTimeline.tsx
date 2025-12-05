import {
  Badge,
  Card,
  CardContent,
  CardHeader,
} from "@/components/ui-custom"

import {
  Calendar,
  CheckCircle2,
  Clock3,
  Mail,
  MessageCircle,
  PhoneCall,
  XCircle,
} from "lucide-react"

export type LeadTimelineEventType =
  | "touch_run"
  | "appointment"
  | "appointment_outcome"
  | "appointment_reminder"

export interface LeadTimelineEvent {
  id: string
  occurredAt: string
  type: LeadTimelineEventType
  channel?: string | null
  step?: number | null
  label: string
  description?: string | null
  status?: string | null
  meta?: Record<string, unknown>
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function iconForEvent(event: LeadTimelineEvent) {
  if (event.type === "appointment") return <Calendar size={16} />
  if (event.type === "appointment_outcome") {
    const outcome = event.status?.toLowerCase()
    if (outcome === "show" || outcome === "attended") {
      return <CheckCircle2 size={16} />
    }
    if (outcome === "no_show") {
      return <XCircle size={16} />
    }
    return <CheckCircle2 size={16} />
  }
  if (event.type === "appointment_reminder") return <Clock3 size={16} />
  if (event.channel === "voice") return <PhoneCall size={16} />
  if (event.channel === "email") return <Mail size={16} />
  return <MessageCircle size={16} />
}

function channelBadgeVariant(channel?: string | null) {
  const normalized = channel?.toLowerCase()
  if (normalized === "email") return "info" as const
  if (normalized === "voice") return "warning" as const
  if (normalized === "sms" || normalized === "whatsapp") return "success" as const
  return "neutral" as const
}

type LeadActivityTimelineProps = {
  events: LeadTimelineEvent[]
}

export function LeadActivityTimeline({ events }: LeadActivityTimelineProps) {
  return (
    <Card>
      <CardHeader title="Activity timeline" description="Touches, appointments and reminders for this lead" />
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-white/70">No activity yet for this lead.</p>
        ) : (
          <div className="relative space-y-4">
            <div className="absolute left-4 top-0 h-full border-l border-white/10" aria-hidden />
            {events.map((event) => (
              <div key={event.id} className="relative flex gap-3 pl-10">
                <div className="absolute left-0 flex h-8 w-8 items-center justify-center rounded-full bg-white/10 text-white">
                  {iconForEvent(event)}
                </div>
                <div className="flex-1 space-y-1 rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-white">{event.label}</p>
                      <p className="text-xs text-white/60">{formatDateTime(event.occurredAt)}</p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {event.channel ? (
                        <Badge variant={channelBadgeVariant(event.channel)} className="capitalize">
                          {event.channel}
                        </Badge>
                      ) : null}
                      {event.step ? (
                        <Badge variant="outline">Step {event.step}</Badge>
                      ) : null}
                      {event.status ? (
                        <Badge variant="outline" className="capitalize">
                          {event.status}
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  {event.description ? (
                    <p className="text-sm text-white/80">{event.description}</p>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
