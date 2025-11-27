"use client"

import React, { useMemo, useState } from "react"
import { CalendarClock, Mail, Phone, RadioTower, StickyNote, Eye } from "lucide-react"
import type { LeadEnriched } from "@/types/lead"
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui-custom"

function fmtDate(iso?: string) {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

const SORTABLE_FIELDS = [
  { key: "full_name", label: "Nombre" },
  { key: "email", label: "Email" },
  { key: "state", label: "Estado" },
  { key: "campaign_name", label: "Campaña" },
  { key: "last_touch_at", label: "Último toque" },
] as const

type SortKey = (typeof SORTABLE_FIELDS)[number]["key"]

type LeadTableProps = {
  leads: LeadEnriched[]
  loading?: boolean
  onSelect?: (lead: LeadEnriched) => void
  deriveStatus?: (lead: LeadEnriched) => string
}

export default function LeadTable({ leads, loading = false, onSelect, deriveStatus }: LeadTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("last_touch_at")
  const [direction, setDirection] = useState<"asc" | "desc">("desc")

  const sortedLeads = useMemo(() => {
    const cloned = [...leads]
    cloned.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortKey]
      const bVal = (b as unknown as Record<string, unknown>)[sortKey]

      if (aVal == null && bVal != null) return direction === "asc" ? -1 : 1
      if (aVal != null && bVal == null) return direction === "asc" ? 1 : -1

      if (typeof aVal === "number" && typeof bVal === "number") {
        return direction === "asc" ? aVal - bVal : bVal - aVal
      }

      if (typeof aVal === "string" && typeof bVal === "string") {
        return direction === "asc" ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal)
      }

      return 0
    })
    return cloned
  }, [leads, sortKey, direction])

  const toggleSort = (key: SortKey) => {
    setSortKey(key)
    setDirection((prev) => (prev === "asc" && key === sortKey ? "desc" : "asc"))
  }

  const renderStatus = (lead: LeadEnriched) => {
    const status = deriveStatus ? deriveStatus(lead) : "New"
    const normalized = status.toLowerCase()
    const variant =
      normalized === "qualified"
        ? "success"
        : ["contacted", "in_progress", "active", "new"].includes(normalized)
          ? "info"
          : "neutral"
    return <Badge variant={variant}>{status}</Badge>
  }

  if (!loading && sortedLeads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 px-8 py-14 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-dashed border-white/15 bg-white/5 text-white/70">
          <Mail />
        </div>
        <div>
          <p className="text-xl font-semibold text-white">Sin leads aún</p>
          <p className="text-sm text-white/60">Importa tus contactos o conecta tu CRM para empezar.</p>
        </div>
        <Button variant="primary">Import leads</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="hidden md:block">
        <Table>
          <TableHead>
            <tr>
              {SORTABLE_FIELDS.map((field) => (
                <TableHeaderCell key={field.key} onClick={() => toggleSort(field.key)}>
                  <div className="flex items-center gap-1">
                    <span>{field.label}</span>
                    <span className="text-xs text-white/40">
                      {sortKey === field.key ? (direction === "asc" ? "↑" : "↓") : ""}
                    </span>
                  </div>
                </TableHeaderCell>
              ))}
              <TableHeaderCell className="text-right">Acciones</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {sortedLeads.map((lead) => (
              <TableRow key={lead.id} className="group cursor-pointer" onClick={() => onSelect?.(lead)}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white/80">
                      {(lead.full_name ?? "?").slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="font-semibold text-white">{lead.full_name ?? "—"}</p>
                      <p className="text-xs text-white/50">{renderStatus(lead)}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-white/80">{lead.email ?? "—"}</TableCell>
                <TableCell className="text-white/80">{lead.state ?? "—"}</TableCell>
                <TableCell className="text-white/80">{lead.campaign_name ?? lead.campaign_id ?? "—"}</TableCell>
                <TableCell className="text-white/60">{fmtDate(lead.last_touch_at ?? undefined)}</TableCell>
                <TableCell className="text-right text-sm">
                  <div className="flex justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation()
                        onSelect?.(lead)
                      }}
                    >
                      <Eye size={16} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                      <Mail size={16} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
                      <StickyNote size={16} />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-white/60">
                  Loading leads...
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-3 md:hidden">
        {sortedLeads.map((lead) => (
          <div
            key={lead.id}
            className="rounded-2xl border border-white/10 bg-white/5 p-4 shadow-[0_12px_40px_rgba(0,0,0,0.35)]"
            onClick={() => onSelect?.(lead)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white/80">
                  {(lead.full_name ?? "?").slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-white">{lead.full_name ?? "—"}</p>
                  {renderStatus(lead)}
                </div>
              </div>
              <span className="text-xs text-white/60">{fmtDate(lead.last_touch_at ?? undefined)}</span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm text-white/70">
              <div className="flex items-center gap-2">
                <Mail size={14} className="text-white/60" />
                <span>{lead.email ?? "Sin email"}</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone size={14} className="text-white/60" />
                <span>{lead.phone ?? "Sin teléfono"}</span>
              </div>
              <div className="flex items-center gap-2">
                <RadioTower size={14} className="text-white/60" />
                <span>{lead.channel_last ?? "—"}</span>
              </div>
              <div className="flex items-center gap-2">
                <CalendarClock size={14} className="text-white/60" />
                <span>{fmtDate(lead.last_touch_at ?? undefined)}</span>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button
                variant="subtle"
                size="sm"
                className="flex-1"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelect?.(lead)
                }}
              >
                <Eye size={14} /> View
              </Button>
              <Button variant="outline" size="sm" className="flex-1" onClick={(e) => e.stopPropagation()}>
                <Mail size={14} /> Contact
              </Button>
            </div>
          </div>
        ))}
        {loading ? <p className="px-2 text-center text-sm text-white/60">Loading leads...</p> : null}
      </div>
    </div>
  )
}
