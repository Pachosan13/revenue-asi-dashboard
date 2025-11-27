"use client"

import React from "react"
import { Mail, Phone, RadioTower, Timer, UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
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

export type LeadInboxEntry = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  status: string | null
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

function statusVariant(status: string | null) {
  const normalized = status?.toLowerCase()
  if (!normalized) return "neutral" as const
  if (["new", "open"].includes(normalized)) return "info" as const
  if (["contacted", "in progress", "active"].includes(normalized)) return "warning" as const
  if (["qualified", "won", "converted"].includes(normalized)) return "success" as const
  return "neutral" as const
}

export function LeadInboxTable({ leads, loading }: LeadInboxTableProps) {
  const router = useRouter()

  const handleNavigate = (leadId: string) => {
    router.push(`/leads/${leadId}`)
  }

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
              <TableRow key={lead.id} className="cursor-pointer" onClick={() => handleNavigate(lead.id)}>
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-semibold text-white">{lead.name ?? "—"}</span>
                    <span className="text-xs text-white/50">ID: {lead.id}</span>
                  </div>
                </TableCell>
                <TableCell className="text-white/80">{lead.email ?? "—"}</TableCell>
                <TableCell className="text-white/80">{lead.phone ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={statusVariant(lead.status)}>{lead.status ?? "Sin dato"}</Badge>
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(event) => {
                      event.stopPropagation()
                      handleNavigate(lead.id)
                    }}
                  >
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
            className="cursor-pointer rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={() => handleNavigate(lead.id)}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-base font-semibold text-white">{lead.name ?? "—"}</p>
                <p className="text-xs text-white/50">ID: {lead.id}</p>
              </div>
              <Badge variant={statusVariant(lead.status)}>{lead.status ?? "Sin dato"}</Badge>
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
              <Button
                variant="outline"
                size="sm"
                onClick={(event) => {
                  event.stopPropagation()
                  handleNavigate(lead.id)
                }}
              >
                Ver timeline
              </Button>
            </div>
          </div>
        ))}
        {loading ? <p className="text-center text-sm text-white/60">Cargando leads...</p> : null}
      </div>
    </div>
  )
}
