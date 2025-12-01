"use client";

import React from "react";
import { Eye, Mail, Phone } from "lucide-react";
import { useRouter } from "next/navigation";

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
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

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

  if (!loading && leads.length === 0) {
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
                        size="icon"
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
                          size="icon"
                          asChild
                          onClick={(event) => event.stopPropagation()}
                        >
                          <a href={`mailto:${email}`}>
                            <Mail className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                      {lead.phone && (
                        <Button
                          variant="ghost"
                          size="icon"
                          asChild
                          onClick={(event) => event.stopPropagation()}
                        >
                          <a href={`tel:${lead.phone}`}>
                            <Phone className="h-4 w-4" />
                          </a>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-white/60">
                  Cargando leads...
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
