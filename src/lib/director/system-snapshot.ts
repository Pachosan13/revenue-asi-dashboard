// src/lib/director/system-snapshot.ts
import { supabaseServer } from "@/lib/supabase-server"

export type SystemSnapshot = {
  generated_at: string
  dashboard_overview: Record<string, any>
  campaign_funnel_by_channel: any[]
  campaign_funnel_summary: any[]
  lead_state_summary: any[]
  lead_activity_summary: any[]
  campaign_kpis: any[]
  enrichment_v2_summary: {
    total_leads: number
    completed: number
    pending: number
    failed: number
  }
}

function fallbackSnapshot(): SystemSnapshot {
  return {
    generated_at: new Date().toISOString(),
    dashboard_overview: {
      total_leads: 0,
      leads_attempting: 0,
      leads_booked: 0,
      campaigns_live: 0,
    },
    campaign_funnel_by_channel: [],
    campaign_funnel_summary: [],
    lead_state_summary: [],
    lead_activity_summary: [],
    campaign_kpis: [],
    enrichment_v2_summary: {
      total_leads: 0,
      completed: 0,
      pending: 0,
      failed: 0,
    },
  }
}

export async function getSystemSnapshot(): Promise<SystemSnapshot> {
  const supabase = supabaseServer()
  if (!supabase) {
    return fallbackSnapshot()
  }

  const { data, error } = await supabase.rpc("api_get_system_snapshot")

  if (error) {
    console.error("api_get_system_snapshot error", error)
  }

  const raw = (data ?? {}) as any
  const base = fallbackSnapshot()

  return {
    generated_at: raw.generated_at ?? base.generated_at,
    dashboard_overview:
      raw.dashboard_overview ?? base.dashboard_overview,
    campaign_funnel_by_channel:
      raw.campaign_funnel_by_channel ??
      base.campaign_funnel_by_channel,
    campaign_funnel_summary:
      raw.campaign_funnel_summary ?? base.campaign_funnel_summary,
    lead_state_summary:
      raw.lead_state_summary ?? base.lead_state_summary,
    lead_activity_summary:
      raw.lead_activity_summary ?? base.lead_activity_summary,
    campaign_kpis: raw.campaign_kpis ?? base.campaign_kpis,
    enrichment_v2_summary: {
      total_leads:
        raw.enrichment_v2_summary?.total_leads ??
        base.enrichment_v2_summary.total_leads,
      completed:
        raw.enrichment_v2_summary?.completed ??
        base.enrichment_v2_summary.completed,
      pending:
        raw.enrichment_v2_summary?.pending ??
        base.enrichment_v2_summary.pending,
      failed:
        raw.enrichment_v2_summary?.failed ??
        base.enrichment_v2_summary.failed,
    },
  }
}
