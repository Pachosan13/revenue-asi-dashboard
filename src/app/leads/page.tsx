"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase";
import LeadTable from "@/components/LeadTable";
import type { LeadEnriched } from "@/types/lead";

export default function LeadsPage() {
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [leads, setLeads] = useState<LeadEnriched[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  useEffect(() => {
    let alive = true;

    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from("lead_enriched")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);

      if (!alive) return;

      if (error) {
        console.error(error);
        setLeads([]);
      } else {
        setLeads((data ?? []) as LeadEnriched[]);
      }
      setLoading(false);
    }

    load();
    return () => {
      alive = false;
    };
  }, [supabase]);

  const filtered = leads.filter((l) => {
    if (!q.trim()) return true;
    const s = q.toLowerCase();
    return (
      (l.full_name ?? "").toLowerCase().includes(s) ||
      (l.company ?? "").toLowerCase().includes(s) ||
      (l.email ?? "").toLowerCase().includes(s) ||
      (l.phone ?? "").toLowerCase().includes(s) ||
      (l.location ?? "").toLowerCase().includes(s)
    );
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Leads Inbox</h1>
          <p className="text-white/60 text-sm">
            {loading ? "Cargando..." : `${filtered.length} leads`}
          </p>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre, empresa, email..."
          className="w-full sm:w-80 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm outline-none focus:border-white/30"
        />
      </div>

      <LeadTable
        leads={filtered}
        onSelect={(lead) => {
          // luego aquí abrimos drawer/modal con detalle
          console.log("selected lead", lead.id);
        }}
      />
    </div>
  );
}
