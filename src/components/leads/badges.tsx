"use client"

import React from "react"

import { Badge } from "@/components/ui-custom"

type LeadState =
  | "new"
  | "enriched"
  | "attempting"
  | "engaged"
  | "qualified"
  | "booked"
  | "dead"
  | string

const stateStyles: Record<LeadState, string> = {
  new: "bg-white/5 text-white border-white/10",
  enriched: "bg-sky-500/15 text-sky-100 border-sky-500/30",
  attempting: "bg-amber-500/15 text-amber-100 border-amber-500/30",
  engaged: "bg-emerald-500/15 text-emerald-100 border-emerald-500/30",
  qualified: "bg-indigo-500/15 text-indigo-100 border-indigo-500/30",
  booked: "bg-emerald-500/15 text-emerald-100 border-emerald-500/30",
  dead: "bg-rose-500/15 text-rose-100 border-rose-500/30",
}

const appointmentStyles: Record<string, string> = {
  scheduled: "bg-emerald-500/15 text-emerald-100 border-emerald-500/30",
  completed: "bg-sky-500/15 text-sky-100 border-sky-500/30",
  cancelled: "bg-amber-500/15 text-amber-100 border-amber-500/30",
  no_show: "bg-rose-500/15 text-rose-100 border-rose-500/30",
}

const channelStyles: Record<string, string> = {
  voice: "bg-emerald-500/15 text-emerald-100 border-emerald-500/30",
  whatsapp: "bg-emerald-500/15 text-emerald-100 border-emerald-500/30",
  zoom: "bg-indigo-500/15 text-indigo-100 border-indigo-500/30",
  phone: "bg-sky-500/15 text-sky-100 border-sky-500/30",
  in_person: "bg-amber-500/15 text-amber-100 border-amber-500/30",
}

const intentStyles: Record<string, string> = {
  appointment: "bg-emerald-500/15 text-emerald-100 border-emerald-500/30",
  interest: "bg-sky-500/15 text-sky-100 border-sky-500/30",
  not_interested: "bg-rose-500/15 text-rose-100 border-rose-500/30",
  unknown: "bg-white/10 text-white border-white/15",
}

export function LeadStateBadge({ state }: { state?: LeadState | null }) {
  if (!state) return null
  const key = state.toLowerCase() as LeadState
  const style = stateStyles[key] ?? "bg-white/10 text-white border-white/15"

  return (
    <Badge variant="outline" className={`capitalize ${style}`}>
      {state}
    </Badge>
  )
}

export function AppointmentStatusBadge({
  status,
}: {
  status?: string | null
}) {
  if (!status) return null
  const normalized = status.toLowerCase()
  const style = appointmentStyles[normalized] ?? "bg-white/10 text-white border-white/15"

  return (
    <Badge variant="outline" className={`capitalize ${style}`}>
      {status.replace("_", " ")}
    </Badge>
  )
}

export function ChannelBadge({ channel }: { channel?: string | null }) {
  if (!channel) return null
  const normalized = channel.toLowerCase()
  const style = channelStyles[normalized] ?? "bg-white/10 text-white border-white/15"

  return (
    <Badge variant="outline" className={`capitalize ${style}`}>
      {channel.replace("_", " ")}
    </Badge>
  )
}

export function IntentBadge({ intent }: { intent?: string | null }) {
  const normalized = (intent ?? "unknown").toLowerCase()
  const style = intentStyles[normalized] ?? intentStyles.unknown

  return (
    <Badge variant="outline" className={`capitalize ${style}`}>
      {normalized}
    </Badge>
  )
}
