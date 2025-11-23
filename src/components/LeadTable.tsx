"use client";

import React from "react";
import type { LeadEnriched } from "@/types/lead";

function fmtDate(iso?: string) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function LeadTable({
  leads,
  onSelect,
}: {
  leads: LeadEnriched[];
  onSelect?: (lead: LeadEnriched) => void;
}) {
  return (
    <div className="w-full overflow-x-auto rounded-2xl border border-white/10 bg-white/5">
      <table className="min-w-full text-sm">
        <thead className="sticky top-0 bg-black/40 backdrop-blur">
          <tr className="text-left text-white/70">
            <th className="p-3">Nombre</th>
            <th className="p-3">Empresa</th>
            <th className="p-3">Email</th>
            <th className="p-3">Teléfono</th>
            <th className="p-3">Ubicación</th>
            <th className="p-3">Confidence</th>
            <th className="p-3">Fecha</th>
          </tr>
        </thead>
        <tbody>
          {leads.map((l) => (
            <tr
              key={l.id}
              onClick={() => onSelect?.(l)}
              className="cursor-pointer border-t border-white/5 hover:bg-white/5"
            >
              <td className="p-3 font-medium text-white">
                {l.full_name ?? "—"}
              </td>
              <td className="p-3 text-white/80">{l.company ?? "—"}</td>
              <td className="p-3 text-white/80">{l.email ?? "—"}</td>
              <td className="p-3 text-white/80">
                {l.phone ?? "—"}
              </td>
              <td className="p-3 text-white/80">{l.location ?? "—"}</td>
              <td className="p-3 text-white/80">
                {l.confidence != null ? `${Math.round(l.confidence * 100)}%` : "—"}
              </td>
              <td className="p-3 text-white/60">{fmtDate(l.created_at)}</td>
            </tr>
          ))}
          {leads.length === 0 && (
            <tr>
              <td className="p-6 text-white/60" colSpan={7}>
                No hay leads todavía.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
