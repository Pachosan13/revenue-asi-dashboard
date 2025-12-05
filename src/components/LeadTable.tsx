"use client";

<<<<<<< HEAD
import React, { useMemo, useState } from "react"
import { CalendarClock, Eye, Mail, MapPin, Phone, Star, StickyNote } from "lucide-react"
import type { LeadEnriched, LeadState } from "@/types/lead"
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/components/ui-custom"
=======
import React from "react";
import { Eye, Mail, Phone } from "lucide-react";
import { useRouter } from "next/navigation";
>>>>>>> origin/plan-joe-dashboard-v1

<<<<<<< HEAD
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
} from "@/components/ui-custom";
import { cn } from "@/lib/utils";

type Lead = any;

interface LeadTableProps {
  leads: Lead[];
  loading?: boolean;
=======
export function deriveLeadDisplayName(lead: LeadEnriched): string {
  const fullName = lead.full_name?.trim()
  if (fullName && fullName !== "Sin nombre") return fullName

  const company = lead.company_name?.trim()
  if (company) return company

  if (lead.phone) return lead.phone

  return "Sin datos"
}

function fmtDate(iso?: string) {
  if (!iso) return ""
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
>>>>>>> origin/director-engine-core
}

<<<<<<< HEAD
const SORTABLE_FIELDS = [
  { key: "full_name", label: "Nombre" },
  { key: "company", label: "Empresa" },
  { key: "email", label: "Email" },
  { key: "state", label: "Estado" },
  { key: "confidence", label: "Confidence" },
  { key: "created_at", label: "Fecha" },
] as const

type SortKey = (typeof SORTABLE_FIELDS)[number]["key"] | "__custom"

type LeadTableProps = {
  leads: LeadEnriched[]
  loading?: boolean
  onSelect?: (lead: LeadEnriched) => void
}

<<<<<<< HEAD
function stateColor(state: LeadState | null | undefined) {
  switch (state) {
    case "new":
      return { label: "New", className: "bg-white/5 text-white" }
    case "enriched":
      return { label: "Enriched", className: "bg-blue-500/15 text-blue-200 border-blue-400/30" }
    case "attempting":
      return { label: "Attempting", className: "bg-amber-500/15 text-amber-200 border-amber-400/30" }
    case "engaged":
      return { label: "Engaged", className: "bg-green-500/15 text-green-200 border-green-400/30" }
    case "qualified":
      return { label: "Qualified", className: "bg-emerald-500/15 text-emerald-200 border-emerald-400/30" }
    case "booked":
      return { label: "Booked", className: "bg-cyan-500/15 text-cyan-200 border-cyan-400/30" }
    case "dead":
      return { label: "Dead", className: "bg-slate-500/20 text-slate-200 border-slate-400/30" }
    default:
      return { label: "Unknown", className: "bg-white/10 text-white/80" }
  }
}

export default function LeadTable({ leads, loading = false, onSelect }: LeadTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("created_at")
=======
export default function LeadTable({ leads, loading = false, onSelect, deriveStatus }: LeadTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("__custom")
>>>>>>> origin/director-engine-core
  const [direction, setDirection] = useState<"asc" | "desc">("desc")
=======
function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

<<<<<<< HEAD
function statusVariant(status: string | null | undefined) {
  const normalized = status?.toLowerCase();
  if (!normalized) return "neutral" as const;
  if (["new", "open", "enriched"].includes(normalized)) return "info" as const;
  if (["contacted", "in progress", "active", "attempting", "engaged"].includes(normalized))
    return "warning" as const;
  if (["qualified", "won", "converted", "booked"].includes(normalized)) return "success" as const;
  if (["dead", "lost"].includes(normalized)) return "destructive" as const;
  return "neutral" as const;
}
>>>>>>> origin/plan-joe-dashboard-v1
=======
  const sortedLeads = useMemo(() => {
    if (sortKey === "__custom") return leads

    const cloned = [...leads]
    cloned.sort((a, b) => {
      const aVal = (a as unknown as Record<string, unknown>)[sortKey]
      const bVal = (b as unknown as Record<string, unknown>)[sortKey]
>>>>>>> origin/director-engine-core

function getDisplayName(lead: Lead): string {
  return (
    lead.contact_name ||
    lead.company_name ||
    lead.full_name ||
    lead.name ||
    lead.lead_name ||
    lead.enriched?.full_name ||
    lead.enriched?.contact_name ||
    "—"
  );
}

function getDisplayEmail(lead: Lead): string {
  return (
    lead.email ||
    lead.primary_email ||
    lead.lead_email ||
    lead.enriched?.email ||
    "—"
  );
}

export default function LeadTable({ leads, loading }: LeadTableProps) {
  const router = useRouter();

  const handleNavigate = (leadId: string) => {
    router.push(`/leads/${leadId}`);
  };

<<<<<<< HEAD
      return 0
    })
    return cloned
  }, [leads, sortKey, direction])

  const toggleSort = (key: SortKey) => {
    setSortKey(key)
    setDirection((prev) => (prev === "asc" && key === sortKey ? "desc" : "asc"))
  }

  const renderStatus = (lead: LeadEnriched) => {
    const { label, className } = stateColor(lead.state)
    return <Badge className={`border ${className}`}>{label}</Badge>
  }

  if (!loading && sortedLeads.length === 0) {
=======
  if (!loading && leads.length === 0) {
>>>>>>> origin/plan-joe-dashboard-v1
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center text-white/70">
          <p className="text-lg font-semibold text-white">Sin leads</p>
          <p className="text-sm text-white/60">
            Importa un CSV o conecta una campaña para empezar a llenar tu pipeline.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl border border-white/10 bg-white/5 shadow-[0_14px_50px_rgba(0,0,0,0.4)]">
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Nombre</TableHeaderCell>
              <TableHeaderCell>Email</TableHeaderCell>
              <TableHeaderCell>Estado</TableHeaderCell>
              <TableHeaderCell>Campaña</TableHeaderCell>
              <TableHeaderCell>Último toque</TableHeaderCell>
              <TableHeaderCell className="text-right">Acciones</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
<<<<<<< HEAD
            {leads.map((lead: Lead) => {
              const name = getDisplayName(lead);
              const email = getDisplayEmail(lead);
              const state = lead.state ?? lead.status ?? null;
              const campaignName =
                lead.campaign_name ?? lead.campaign ?? lead.campaign_id ?? "—";
              const lastTouch =
                lead.last_touched_at ??
                lead.last_touch_at ??
                lead.updated_at ??
                lead.created_at;

              return (
                <TableRow
                  key={lead.id}
                  className="cursor-pointer hover:bg-white/5"
                  onClick={() => handleNavigate(lead.id)}
                >
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <span className="font-semibold text-white">{name}</span>
                      <span className="text-xs text-white/50 truncate max-w-[260px]">
                        {email}
                      </span>
                    </div>
<<<<<<< HEAD
                    <div>
                      <p className="font-semibold text-white">{lead.full_name ?? "—"}</p>
                      <div className="text-xs text-white/70">{renderStatus(lead)}</div>
                    </div>
                  </div>
=======
            {sortedLeads.map((lead) => (
                <TableRow key={lead.id} className="group cursor-pointer" onClick={() => onSelect?.(lead)}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-semibold text-white/80">
                        {deriveLeadDisplayName(lead).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-white">{deriveLeadDisplayName(lead)}</p>
                        <p className="text-xs text-white/50">{renderStatus(lead)}</p>
                      </div>
                    </div>
>>>>>>> origin/director-engine-core
                </TableCell>
                <TableCell className="text-white/80">{lead.company ?? "—"}</TableCell>
                <TableCell className="text-white/80">{lead.email ?? "—"}</TableCell>
                <TableCell>{renderStatus(lead)}</TableCell>
                <TableCell className="text-white/80">
                  {lead.confidence != null ? `${Math.round(lead.confidence * 100)}%` : "—"}
                </TableCell>
                <TableCell className="text-white/60">{fmtDate(lead.created_at)}</TableCell>
                <TableCell className="text-right text-sm">
                  <div className="flex justify-end gap-2 opacity-0 transition group-hover:opacity-100">
                    <Button variant="ghost" size="sm" onClick={(e) => e.stopPropagation()}>
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
=======
                  </TableCell>
                  <TableCell className="text-white/80">
                    {email !== "—" ? email : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={statusVariant(state)}
                      className={cn(
                        "flex items-center gap-2 transition duration-200 hover:scale-105 hover:brightness-110",
                        ["engaged", "qualified", "booked"].includes(state?.toLowerCase() ?? "")
                          ? "shadow-[0_0_12px_rgba(16,185,129,0.4)] ring-1 ring-emerald-400/60"
                          : undefined,
                      )}
                    >
                      {["attempting", "engaged"].includes(state?.toLowerCase() ?? "") ? (
                        <span className="h-2 w-2 animate-pulse rounded-full bg-current" />
                      ) : null}
                      <span className="leading-tight">{state ?? "Sin dato"}</span>
                    </Badge>
                  </TableCell>
                  <TableCell className="text-white/80">{campaignName}</TableCell>
                  <TableCell className="text-white/70">
                    {formatDateTime(lastTouch)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-9 w-9 p-0"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleNavigate(lead.id);
                        }}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {email && email !== "—" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0"
                          onClick={(event) => {
                            event.stopPropagation()
                            window.location.href = `mailto:${email}`
                          }}
                        >
                          <Mail className="h-4 w-4" />
                        </Button>
                      )}
                      {lead.phone && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-9 w-9 p-0"
                          onClick={(event) => {
                            event.stopPropagation()
                            window.location.href = `tel:${lead.phone}`
                          }}
                        >
                          <Phone className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {loading ? (
>>>>>>> origin/plan-joe-dashboard-v1
              <TableRow>
                <TableCell colSpan={6} className="text-center text-white/60">
                  Cargando leads...
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
<<<<<<< HEAD
=======

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
                  {deriveLeadDisplayName(lead).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="font-semibold text-white">{deriveLeadDisplayName(lead)}</p>
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
              <Button variant="subtle" size="sm" className="flex-1">
                <Eye size={14} /> View
              </Button>
              <Button variant="outline" size="sm" className="flex-1">
                <Mail size={14} /> Contact
              </Button>
            </div>
          </div>
        ))}
        {loading ? <p className="px-2 text-center text-sm text-white/60">Loading leads...</p> : null}
      </div>
>>>>>>> origin/director-engine-core
    </div>
  );
}
