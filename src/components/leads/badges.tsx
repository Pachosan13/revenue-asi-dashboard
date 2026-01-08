"use client"

import React from "react"

type MaybeString = string | null | undefined

function cn(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ")
}

/**
 * Channel badge (voice, email, sms, whatsapp, zoom...)
 */
export function ChannelBadge({ channel }: { channel: MaybeString }) {
  if (!channel) {
    return (
      <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/60">
        Unknown
      </span>
    )
  }

  const c = channel.toLowerCase()
  let label = channel

  if (["voice", "call", "phone"].includes(c)) label = "Voice"
  if (c === "email") label = "Email"
  if (["sms", "text"].includes(c)) label = "SMS"
  if (c === "whatsapp") label = "WhatsApp"
  if (["zoom", "video"].includes(c)) label = "Zoom"

  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-medium text-white/80">
      {label}
    </span>
  )
}

/**
 * Intent badge (interested, not_interested, callback, no_answer, voicemail...)
 */
export function IntentBadge({ intent }: { intent: MaybeString }) {
  const value = intent?.toLowerCase() ?? ""

  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"

  if (!value) {
    return (
      <span
        className={cn(
          base,
          "border border-white/10 bg-white/5 text-white/60",
        )}
      >
        No intent
      </span>
    )
  }

  if (["interested", "hot", "warm", "interest"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30",
        )}
      >
        Interested
      </span>
    )
  }

  if (["not_interested", "cold", "disinterest"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-rose-500/10 text-rose-300 border border-rose-500/30",
        )}
      >
        Not interested
      </span>
    )
  }

  if (["callback", "follow_up", "followup"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-amber-500/15 text-amber-300 border border-amber-500/30",
        )}
      >
        Call back
      </span>
    )
  }

  if (["no_answer", "ringing"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-slate-500/20 text-slate-200 border border-slate-500/40",
        )}
      >
        No answer
      </span>
    )
  }

  if (["voicemail", "vm"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-indigo-500/15 text-indigo-200 border border-indigo-500/30",
        )}
      >
        Voicemail
      </span>
    )
  }

  if (value === "appointment") {
    return (
      <span
        className={cn(
          base,
          "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30",
        )}
      >
        Appointment
      </span>
    )
  }

  if (value === "unknown") {
    return (
      <span
        className={cn(
          base,
          "border border-white/10 bg-white/5 text-white/60",
        )}
      >
        Unknown
      </span>
    )
  }

  return (
    <span
      className={cn(
        base,
        "border border-white/10 bg-white/5 text-white/80",
      )}
    >
      {intent}
    </span>
  )
}

/**
 * Lead state badge (new, enriched, in_campaign, active, won, lost, dead, do_not_contact...)
 */
export function LeadStateBadge({ state }: { state: MaybeString }) {
  const value = state?.toLowerCase() ?? ""

  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"

  if (!value) {
    return (
      <span
        className={cn(
          base,
          "border border-white/10 bg-white/5 text-white/60",
        )}
      >
        No state
      </span>
    )
  }

  // new / imported
  if (["new", "imported"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-sky-500/15 text-sky-200 border border-sky-500/30",
        )}
      >
        New
      </span>
    )
  }

  // enriched
  if (["enriched"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-violet-500/15 text-violet-200 border border-violet-500/30",
        )}
      >
        Enriched
      </span>
    )
  }

  // in campaign / cadence / attempting
  if (["in_campaign", "in_cadence", "attempting"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-amber-500/15 text-amber-200 border border-amber-500/30",
        )}
      >
        In campaign
      </span>
    )
  }

  // active / engaged / qualified
  if (["active", "engaged", "qualified"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-emerald-500/15 text-emerald-200 border border-emerald-500/30",
        )}
      >
        Active
      </span>
    )
  }

  // booked / customer / won
  if (["won", "customer", "booked"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-lime-500/20 text-lime-100 border border-lime-500/40",
        )}
      >
        Won
      </span>
    )
  }

  if (["lost"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-rose-500/15 text-rose-100 border border-rose-500/40",
        )}
      >
        Lost
      </span>
    )
  }

  if (["dead"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-slate-600/50 text-slate-200 border border-slate-600",
        )}
      >
        Dead
      </span>
    )
  }

  if (["do_not_contact", "dnc"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-red-800/60 text-red-100 border border-red-700",
        )}
      >
        Do not contact
      </span>
    )
  }

  if (["unqualified"].includes(value)) {
    return (
      <span
        className={cn(
          base,
          "bg-white/5 text-white/50 border border-white/15",
        )}
      >
        Unqualified
      </span>
    )
  }

  return (
    <span
      className={cn(
        base,
        "border border-white/10 bg-white/5 text-white/80",
      )}
    >
      {state}
    </span>
  )
}

/**
 * Appointment status badge (scheduled, completed, canceled, no_show...)
 * útil para voz + calendar
 */
export function AppointmentStatusBadge({
  status,
}: {
  status: MaybeString
}) {
  const valueRaw = status?.toLowerCase() ?? ""
  // Treat legacy double-l spelling as an alias, but never display/return it.
  const value = valueRaw.replace(/^cancell?ed$/, "canceled")

  const base =
    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"

  if (!value) {
    return null
  }

  if (value === "scheduled") {
    return (
      <span
        className={cn(
          base,
          "bg-emerald-500/15 text-emerald-100 border border-emerald-500/30",
        )}
      >
        Scheduled
      </span>
    )
  }

  if (value === "completed") {
    return (
      <span
        className={cn(
          base,
          "bg-sky-500/15 text-sky-100 border border-sky-500/30",
        )}
      >
        Completed
      </span>
    )
  }

  if (value === "canceled") {
    return (
      <span
        className={cn(
          base,
          "bg-amber-500/15 text-amber-100 border border-amber-500/30",
        )}
      >
        Cancelled
      </span>
    )
  }

  if (value === "no_show") {
    return (
      <span
        className={cn(
          base,
          "bg-rose-500/15 text-rose-100 border border-rose-500/30",
        )}
      >
        No show
      </span>
    )
  }

  return (
    <span
      className={cn(
        base,
        "border border-white/10 bg-white/5 text-white/80",
      )}
    >
      {status}
    </span>
  )
}
