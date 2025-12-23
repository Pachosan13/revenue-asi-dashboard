"use client"

import React from "react"
import { Mail, Phone } from "lucide-react"

import { Badge, Card, CardContent, CardHeader } from "@/components/ui-custom"

type LeadTableProps = {
  // mantenemos esto super flexible para no pelear con tipos
  leads: any[]
  loading?: boolean
  title?: string
  description?: string
}

export default function LeadTable({
  leads,
  loading = false,
  title = "Leads",
  description = "Listado básico de leads",
}: LeadTableProps) {
  return (
    <Card>
      <CardHeader title={title} description={description} />
      <CardContent>
        {loading ? (
          <p className="text-sm text-white/70">Cargando leads...</p>
        ) : null}

        {!loading && (!leads || leads.length === 0) ? (
          <p className="text-sm text-white/70">No hay leads para mostrar.</p>
        ) : null}

        {!loading && leads && leads.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm text-white/80">
              <thead>
                <tr className="border-b border-white/10 text-xs uppercase tracking-[0.12em] text-white/50">
                  <th className="px-3 py-2">ID</th>
                  <th className="px-3 py-2">Nombre</th>
                  <th className="px-3 py-2">Contacto</th>
                  <th className="px-3 py-2">Estado</th>
                  <th className="px-3 py-2">Último toque</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: any) => (
                  <tr
                    key={lead.id ?? lead.lead_id ?? crypto.randomUUID()}
                    className="border-b border-white/5 hover:bg-white/5"
                  >
                    <td className="px-3 py-2 text-xs text-white/60">
                      {lead.id ?? lead.lead_id ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-white">
                          {lead.name ??
                            lead.lead_name ??
                            lead.full_name ??
                            "Sin nombre"}
                        </span>
                        {lead.campaign_name ? (
                          <span className="text-xs text-white/50">
                            {lead.campaign_name}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1 text-xs text-white/70">
                        {lead.email && (
                          <span className="inline-flex items-center gap-1">
                            <Mail size={12} />
                            {lead.email}
                          </span>
                        )}
                        {lead.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone size={12} />
                            {lead.phone}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge
                        variant="neutral"
                        className="capitalize text-xs"
                      >
                        {lead.state ?? lead.lead_state ?? "unknown"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-white/60">
                      {lead.last_touch_at ??
                        lead.last_step_at ??
                        lead.created_at ??
                        "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
