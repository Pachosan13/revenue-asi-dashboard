"use client"

import React, { useMemo, useState } from "react"
import {
  Brain,
  Mail,
  MessageCircle,
  PhoneCall,
  Waves,
  ArrowRight,
} from "lucide-react"
import {
  Badge,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"

export type LeadInboxEntry = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  state: string | null
  last_touch_at: string | null
  campaign_id: string | null
  campaign_name: string | null
  channel_last: string | null
  created_at: string | null

  // Lead Brain v1
  lead_brain_score?: number | null
  lead_brain_bucket?: "hot" | "warm" | "cold" | string | null

  // Multichannel signals
  attempts_total?: number | null
  distinct_channels?: number | null
  errors_total?: number | null
  email_engaged?: number | null
  wa_engaged?: number | null
  sms_engaged?: number | null
  voice_engaged?: number | null

  // Director Brain – Next Action
  next_channel?: string | null
  next_action?: string | null
  next_delay_minutes?: number | null
  next_priority_score?: number | null
  next_reason?: string | null

  // Lead Genome – Enrichment V2
  industry?: string | null
  sub_industry?: string | null
  pain_points?: string[] | null
  objections?: string[] | null
  emotional_state?: Record<string, any> | null
  urgency_score?: number | null
  decision_authority_score?: number | null
  conversion_likelihood?: number | null
  recommended_channel?: string | null
  recommended_cadence?: Record<string, any> | null
  recommended_persona?: string | null
  ai_lead_score?: number | null
  enrichment_status?: string | null
}

/* ----------------------------------------------- */
/* Utils                                           */
/* ----------------------------------------------- */

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—"
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return "—"
  return d.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

function brainBucketPill(bucket: string | null | undefined) {
  const b = (bucket ?? "").toLowerCase()
  const base =
    "inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-[11px] font-medium"
  if (b === "hot") {
    return (
      <span
        className={`${base} border border-rose-500/60 bg-rose-500/15 text-rose-100 shadow-[0_0_24px_rgba(244,63,94,0.6)]`}
      >
        <span className="h-2 w-2 rounded-full bg-rose-400 animate-pulse" />
        HOT
      </span>
    )
  }
  if (b === "warm") {
    return (
      <span
        className={`${base} border border-amber-400/60 bg-amber-500/15 text-amber-100`}
      >
        <span className="h-2 w-2 rounded-full bg-amber-300" />
        WARM
      </span>
    )
  }
  if (b === "cold") {
    return (
      <span
        className={`${base} border border-slate-500/60 bg-slate-700/40 text-slate-100`}
      >
        <span className="h-2 w-2 rounded-full bg-slate-300" />
        COLD
      </span>
    )
  }
  return (
    <span
      className={`${base} border border-white/15 bg-white/5 text-white/60`}
    >
      UNRANKED
    </span>
  )
}

function channelDot(active: boolean, label: string, icon: React.ReactNode) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        active
          ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-100"
          : "border-white/10 bg-white/5 text-white/40"
      }`}
    >
      {icon}
      {label}
    </span>
  )
}

function scoreBar(score: number | null | undefined) {
  const s = typeof score === "number" ? Math.max(0, Math.min(score, 100)) : 0
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-[0.18em] text-white/40">
          Lead Brain
        </span>
        <span className="text-sm font-semibold text-white">
          {score != null ? s : "—"}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-300 to-rose-400"
          style={{ width: `${s}%` }}
        />
      </div>
    </div>
  )
}

/* ----------------------------------------------- */
/* Lead Genome Rendering                           */
/* ----------------------------------------------- */

function renderGenomePills(lead: LeadInboxEntry) {
  const pills: string[] = []

  if (lead.industry) pills.push(lead.industry)
  if (lead.sub_industry) pills.push(lead.sub_industry)
  if (lead.recommended_persona) pills.push(lead.recommended_persona)

  if (pills.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {pills.map((p) => (
        <span
          key={p}
          className="inline-flex items-center rounded-full border border-emerald-400/60 bg-emerald-500/15 px-2 py-0.5 text-[11px] text-emerald-100"
        >
          {p}
        </span>
      ))}
    </div>
  )
}

function renderEmotionTags(lead: LeadInboxEntry) {
  const emo = lead.emotional_state || {}
  const keys = Object.keys(emo).filter((k) => emo[k])

  if (keys.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5">
      {keys.map((k) => (
        <span
          key={k}
          className="inline-flex items-center rounded-full border border-sky-400/60 bg-sky-500/15 px-2 py-0.5 text-[11px] text-sky-100"
        >
          {k}
        </span>
      ))}
    </div>
  )
}

function renderGenomeLists(lead: LeadInboxEntry) {
  const pains = lead.pain_points ?? []
  const objections = lead.objections ?? []

  if (pains.length === 0 && objections.length === 0) return null

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {pains.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Pain points
          </p>
          <ul className="mt-1 space-y-1 text-[11px] text-white/70">
            {pains.slice(0, 5).map((p) => (
              <li key={p} className="list-disc pl-4">
                {p}
              </li>
            ))}
          </ul>
        </div>
      )}
      {objections.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
            Objections
          </p>
          <ul className="mt-1 space-y-1 text-[11px] text-white/70">
            {objections.slice(0, 5).map((o) => (
              <li key={o} className="list-disc pl-4">
                {o}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/* ----------------------------------------------- */
/* Lead Brain / Lead Genome Explanation            */
/* ----------------------------------------------- */

function explainScore(lead: LeadInboxEntry) {
  const score = lead.lead_brain_score ?? 0
  const bucket = (lead.lead_brain_bucket ?? "unranked").toUpperCase()
  const attempts = lead.attempts_total ?? 0
  const channels = lead.distinct_channels ?? 0
  const errs = lead.errors_total ?? 0

  const hasEngEmail = (lead.email_engaged ?? 0) > 0
  const hasEngWa = (lead.wa_engaged ?? 0) > 0
  const hasEngSms = (lead.sms_engaged ?? 0) > 0
  const hasEngVoice = (lead.voice_engaged ?? 0) > 0

  const engagedChannels = [
    hasEngEmail && "Email",
    hasEngWa && "WhatsApp",
    hasEngSms && "SMS",
    hasEngVoice && "Voice",
  ].filter(Boolean) as string[]

  const hasGenome =
    !!lead.industry ||
    !!lead.sub_industry ||
    !!lead.recommended_persona ||
    (lead.pain_points && lead.pain_points.length > 0) ||
    (lead.objections && lead.objections.length > 0)

  if (attempts > 0 || engagedChannels.length > 0) {
    return (
      <div className="space-y-2 rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-white/70">
        <p className="font-semibold text-white/80">
          Why this score ({score}) · {bucket}
        </p>
        <ul className="space-y-1 list-disc pl-4">
          <li>
            {attempts} total attempts en {channels} canales.
          </li>
          <li>
            {engagedChannels.length > 0
              ? `Engagement detectado en: ${engagedChannels.join(", ")}.`
              : "Sin engagement explícito todavía en ningún canal."}
          </li>
          <li>
            {errs > 0
              ? `${errs} errores recientes reducen el score.`
              : "Sin errores recientes."}
          </li>
          <li>
            Recencia: última interacción {formatDateTime(lead.last_touch_at)}.
          </li>
        </ul>
      </div>
    )
  }

  if (hasGenome) {
    return (
      <div className="space-y-2 rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-white/70">
        <p className="font-semibold text-white/80">
          Lead Brain aún no tiene suficiente actividad para puntuar.
        </p>
        <ul className="space-y-1 list-disc pl-4">
          <li>No hay intentos registrados todavía.</li>
          <li>
            El Lead Genome ya está listo
            {lead.industry ? ` (${lead.industry})` : ""}.
          </li>
          {lead.recommended_persona && (
            <li>Persona recomendada: {lead.recommended_persona}</li>
          )}
          <li>Recencia: última interacción —</li>
        </ul>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-2xl border border-white/10 bg-black/40 p-3 text-xs text-white/70">
      <p className="font-semibold text-white/80">
        Lead Brain aún no tiene suficiente actividad para puntuar.
      </p>
      <ul className="space-y-1 list-disc pl-4">
        <li>0 total attempts en 0 canales.</li>
        <li>Sin engagement todavía.</li>
        <li>Sin errores recientes.</li>
        <li>Recencia: última interacción —.</li>
      </ul>
    </div>
  )
}

/* ----------------------------------------------- */
/* Table Component                                 */
/* ----------------------------------------------- */

export function LeadInboxTable({ leads, loading }: { leads: LeadInboxEntry[]; loading?: boolean }) {
  const [activeLeadId, setActiveLeadId] = useState<string | null>(null)

  const activeLead = useMemo(
    () => leads.find((l) => l.id === activeLeadId) ?? null,
    [leads, activeLeadId],
  )

  if (loading) {
    return (
      <div className="grid gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
        {[1, 2, 3, 4, 5].map((row) => (
          <div
            key={row}
            className="h-12 animate-pulse rounded-xl bg-white/10"
          />
        ))}
      </div>
    )
  }

  if (!loading && leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-emerald-400/30 bg-white/5 px-6 py-10 text-center shadow-[0_20px_60px_rgba(16,185,129,0.15)]">
        <div className="rounded-full bg-emerald-500/20 p-3 text-emerald-300 shadow-[0_0_40px_rgba(16,185,129,0.4)]">
          <Brain className="h-5 w-5" />
        </div>
        <p className="text-lg font-semibold text-white">No leads yet</p>
        <p className="text-sm text-white/60">
          Cuando importes leads, el Lead Brain los priorizará automáticamente.
        </p>
      </div>
    )
  }

  return (
    <>
      {/* MAIN TABLE */}
      <div className="rounded-2xl border border-white/10 bg-white/5">
        <Table>
          <TableHead>
            <TableRow>
              <TableHeaderCell>Lead</TableHeaderCell>
              <TableHeaderCell>Brain</TableHeaderCell>
              <TableHeaderCell>Channels</TableHeaderCell>
              <TableHeaderCell>State</TableHeaderCell>
              <TableHeaderCell>Campaign</TableHeaderCell>
              <TableHeaderCell>Next action</TableHeaderCell>
              <TableHeaderCell className="text-right">
                Last touch
              </TableHeaderCell>
            </TableRow>
          </TableHead>

          <TableBody>
            {leads.map((lead) => {
              const score = lead.lead_brain_score ?? null
              const attempts = lead.attempts_total ?? 0
              const channels = lead.distinct_channels ?? 0

              const lastChannel = (lead.channel_last ?? "").toLowerCase()

              const hasEmail = (lead.email_engaged ?? 0) > 0
              const hasWa = (lead.wa_engaged ?? 0) > 0
              const hasSms = (lead.sms_engaged ?? 0) > 0
              const hasVoice = (lead.voice_engaged ?? 0) > 0

              return (
                <TableRow
                  key={lead.id}
                  className={`cursor-pointer transition hover:bg-white/10`}
                  onClick={() => setActiveLeadId(lead.id)}
                >
                  {/* Lead Column */}
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-semibold text-white">
                        {lead.name ?? "Sin nombre"}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-white/60">
                        {lead.email && <span>{lead.email}</span>}
                        {lead.phone && <span>{lead.phone}</span>}
                      </div>

                      {/* GENOME PILLS UNDER NAME */}
                      {renderGenomePills(lead)}
                    </div>
                  </TableCell>

                  {/* Brain */}
                  <TableCell>
                    <div className="space-y-1">
                      {brainBucketPill(lead.lead_brain_bucket)}
                      <p className="text-xs text-white/50">
                        Score:{" "}
                        <span className="font-semibold text-white">
                          {score ?? "—"}
                        </span>
                      </p>
                    </div>
                  </TableCell>

                  {/* Channels */}
                  <TableCell>
                    <div className="space-y-1">
                      <div className="flex flex-wrap gap-1.5">
                        {channelDot(
                          hasEmail || lastChannel === "email",
                          "Email",
                          <Mail className="h-3 w-3" />,
                        )}
                        {channelDot(
                          hasWa || lastChannel === "whatsapp",
                          "WhatsApp",
                          <MessageCircle className="h-3 w-3" />,
                        )}
                        {channelDot(
                          hasSms || lastChannel === "sms",
                          "SMS",
                          <Waves className="h-3 w-3" />,
                        )}
                        {channelDot(
                          hasVoice || lastChannel === "voice",
                          "Voice",
                          <PhoneCall className="h-3 w-3" />,
                        )}
                      </div>
                      <p className="text-[11px] text-white/45">
                        {attempts} attempts · {channels} channels
                      </p>
                    </div>
                  </TableCell>

                  {/* State */}
                  <TableCell>
                    <Badge variant="neutral" className="capitalize">
                      {lead.state ?? "unknown"}
                    </Badge>
                  </TableCell>

                  {/* Campaign */}
                  <TableCell>
                    <div className="space-y-1">
                      <p className="text-sm text-white">
                        {lead.campaign_name ?? "—"}
                      </p>
                      {lead.channel_last && (
                        <p className="text-[11px] text-white/50">
                          Last via {lead.channel_last}
                        </p>
                      )}
                    </div>
                  </TableCell>

                  {/* Next Action */}
                  <TableCell>{/* Next action pill ya lo tienes */}</TableCell>

                  {/* Last touch */}
                  <TableCell className="text-right text-sm text-white/70">
                    {formatDateTime(lead.last_touch_at)}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* --------------------------------------- */}
      {/*  FIXED DRAWER — NO MÁS FONDO BLANCO    */}
      {/* --------------------------------------- */}

      {activeLead && (
        <div className="fixed inset-0 z-[999] flex">
          {/* BACKDROP */}
          <button
            className="h-full flex-1 bg-black/60 backdrop-blur-sm"
            onClick={() => setActiveLeadId(null)}
          />

          {/* PANEL */}
          <div className="h-full w-full max-w-md bg-[#020617] border-l border-white/10 p-5 overflow-y-auto shadow-[0_0_60px_rgba(15,23,42,0.9)] z-[1000]">

            {/* HEADER */}
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.18em] text-white/50">
                  Lead Brain
                </p>
                <h2 className="text-xl font-semibold text-white">
                  {activeLead.name ?? "Sin nombre"}
                </h2>
                <p className="text-xs text-white/50">
                  {activeLead.email} · {activeLead.phone}
                </p>
              </div>

              <button
                onClick={() => setActiveLeadId(null)}
                className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20 transition"
              >
                Close
              </button>
            </div>

            <div className="space-y-4 pb-10">

              {/* SCORE */}
              <Card className="border-white/10 bg-white/5">
                <CardContent className="space-y-3 p-4">
                  {scoreBar(activeLead.lead_brain_score)}
                  {brainBucketPill(activeLead.lead_brain_bucket)}
                </CardContent>
              </Card>

              {/* MULTICHANNEL */}
              <Card className="border-white/10 bg-white/5">
                <CardContent className="space-y-3 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/50">
                    Multichannel
                  </p>

                  <div className="flex flex-wrap gap-1.5">
                    {channelDot(
                      (activeLead.email_engaged ?? 0) > 0 ||
                        (activeLead.channel_last ?? "").toLowerCase() === "email",
                      "Email",
                      <Mail className="h-3 w-3" />,
                    )}
                    {channelDot(
                      (activeLead.wa_engaged ?? 0) > 0 ||
                        (activeLead.channel_last ?? "").toLowerCase() === "whatsapp",
                      "WhatsApp",
                      <MessageCircle className="h-3 w-3" />,
                    )}
                    {channelDot(
                      (activeLead.sms_engaged ?? 0) > 0 ||
                        (activeLead.channel_last ?? "").toLowerCase() === "sms",
                      "SMS",
                      <Waves className="h-3 w-3" />,
                    )}
                    {channelDot(
                      (activeLead.voice_engaged ?? 0) > 0 ||
                        (activeLead.channel_last ?? "").toLowerCase() === "voice",
                      "Voice",
                      <PhoneCall className="h-3 w-3" />,
                    )}
                  </div>

                  <p className="text-xs text-white/50">
                    {activeLead.attempts_total ?? 0} attempts ·{" "}
                    {activeLead.distinct_channels ?? 0} channels ·{" "}
                    {activeLead.errors_total ?? 0} errors
                  </p>
                </CardContent>
              </Card>

              {/* NEXT ACTION */}
              <Card className="border-white/10 bg-white/5">
                <CardContent className="space-y-3 p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/50">
                    Next action
                  </p>

                  <p className="text-xs text-white/60">No next action</p>
                </CardContent>
              </Card>

              {/* -------------------------------- */}
              {/* LEAD GENOME FIXED BACKGROUND     */}
              {/* -------------------------------- */}
              <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/90 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-white/50">
                  Lead Genome
                </p>

                {renderGenomePills(activeLead)}
                {renderEmotionTags(activeLead)}
                {renderGenomeLists(activeLead)}

                {!activeLead.industry &&
                  !activeLead.sub_industry &&
                  !(activeLead.pain_points && activeLead.pain_points.length) &&
                  !(activeLead.objections && activeLead.objections.length) && (
                    <p className="text-xs text-white/60">
                      Aún no hay contexto enriquecido para este lead.
                    </p>
                  )}
              </div>

              {/* SCORE EXPLANATION */}
              {explainScore(activeLead)}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
