"use client"

import React, { useState } from "react"
import { Mail, Phone, RadioTower, Timer, UserRound } from "lucide-react"
import {
  Badge,
  Button,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui-custom"
import type { LeadState } from "@/types/lead"

import { LeadTimeline } from "./LeadTimeline"

export type LeadInboxEntry = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  state: LeadState | null
  last_touch_at: string | null
  campaign_id: string | null
  campaign_name: string | null
  channel_last: string | null
  created_at: string | null
}

type LeadInboxTableProps = {
  leads: LeadInboxEntry[]
  loading?: boolean
}

const formatDateTime = (value: string | null) => {
  if (!value) return "—"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function stateBadge(state: LeadState | null) {
  switch (state) {
    case "new":
      return { label: "New", className: "bg-white/5 text-white border border-white/10" }
    case "enriched":
      return { label: "Enriched", className: "bg-blue-500/15 text-blue-200 border border-blue-400/30" }
    case "attempting":
      return { label: "Attempting", className: "bg-amber-500/15 text-amber-200 border border-amber-400/30" }
    case "engaged":
      return { label: "Engaged", className: "bg-green-500/15 text-green-200 border border-green-400/30" }
    case "qualified":
      return { label: "Qualified", className: "bg-emerald-500/15 text-emerald-200 border border-emerald-400/30" }
    case "booked":
      return { label: "Booked", className: "bg-cyan-500/15 text-cyan-200 border border-cyan-400/30" }
    case "dead":
      return { label: "Dead", className: "bg-slate-500/20 text-slate-200 border border-slate-400/30" }
    default:
      return { label: "Sin estado", className: "bg-white/10 text-white/80" }
  }
}

export function LeadInboxTable({ leads, loading }: LeadInboxTableProps) {
  const [selectedLead, setSelectedLead] = useState<LeadInboxEntry | null>(null)

  if (!loading && leads.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-white/70">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/5">
            <UserRound />
          </div>
          <div>
            <p className="text-lg font-semibold text-white">Sin leads disponibles</p>
            <p className="text-sm text-white/60">Conecta tu fuente o usa el mock para probar la vista.</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      <div className="hidden overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_14px_50px_rgba(0,0,0,0.4)] md:block">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Lead</TableHeaderCell>
              <TableHeaderCell>Email</TableHeaderCell>
              <TableHeaderCell>Teléfono</TableHeaderCell>
              <TableHeaderCell>Estado</TableHeaderCell>
              <TableHeaderCell>Último toque</TableHeaderCell>
              <TableHeaderCell>Campaña</TableHeaderCell>
              <TableHeaderCell>Canal</TableHeaderCell>
              <TableHeaderCell>Timeline</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {leads.map((lead) => (
              <TableRow key={lead.id}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-semibold text-white">{lead.name ?? "—"}</span>
                    <span className="text-xs text-white/50">ID: {lead.id}</span>
                  </div>
                </TableCell>
                <TableCell className="text-white/80">{lead.email ?? "—"}</TableCell>
                <TableCell className="text-white/80">{lead.phone ?? "—"}</TableCell>
                <TableCell>
                  {(() => {
                    const { label, className } = stateBadge(lead.state)
                    return <Badge className={className}>{label}</Badge>
                  })()}
                </TableCell>
                <TableCell className="text-white/70">{formatDateTime(lead.last_touch_at ?? lead.created_at)}</TableCell>
                <TableCell className="text-white/80">
                  <div className="flex flex-col">
                    <span>{lead.campaign_name ?? "—"}</span>
                    <span className="text-xs text-white/50">{lead.campaign_id ?? ""}</span>
                  </div>
                </TableCell>
                <TableCell className="text-white/80">{lead.channel_last ?? "—"}</TableCell>
                <TableCell>
                  <Button variant="ghost" size="sm" onClick={() => setSelectedLead(lead)}>
                    Ver timeline
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {loading ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-white/60">
                  Cargando leads...
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {leads.map((lead) => (
          <div
            key={lead.id}
            className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-white">{lead.name ?? "—"}</p>
                <p className="text-xs text-white/50">ID: {lead.id}</p>
              </div>
              {(() => {
                const { label, className } = stateBadge(lead.state)
                return <Badge className={className}>{label}</Badge>
              })()}
            </div>

            <div className="mt-3 space-y-2 text-sm text-white/70">
              <div className="flex items-center gap-2">
                <Mail size={16} className="text-white/50" />
                <span>{lead.email ?? "Sin email"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone size={16} className="text-white/50" />
                <span>{lead.phone ?? "Sin teléfono"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Timer size={16} className="text-white/50" />
                <span>{formatDateTime(lead.last_touch_at ?? lead.created_at)}</span>
              </div>
              <div className="flex items-center gap-2">
                <RadioTower size={16} className="text-white/50" />
                <span>{lead.channel_last ?? "Sin canal"}</span>
              </div>
              <div className="flex items-center gap-2">
                <UserRound size={16} className="text-white/50" />
                <span>{lead.campaign_name ?? lead.campaign_id ?? "Sin campaña"}</span>
              </div>
            </div>
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => setSelectedLead(lead)}>
                Ver timeline
              </Button>
            </div>
          </div>
        ))}
        {loading ? <p className="text-center text-sm text-white/60">Cargando leads...</p> : null}
      </div>

      {selectedLead ? (
        <div className="pt-2">
          <LeadTimeline leadId={selectedLead.id} leadName={selectedLead.name ?? selectedLead.email ?? selectedLead.id} />
        </div>
      ) : null}
    </div>
  )
}
