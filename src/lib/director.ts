import { createServiceRoleClient } from "./supabaseServer"
import type { CampaignSummary, EvaluationEvent } from "@/types/director"

export async function getDirectorOverview(): Promise<{
  campaigns: CampaignSummary[]
  evaluations: EvaluationEvent[]
}> {
  const supabase = createServiceRoleClient()

  const { data: campaigns, error: campaignError } = await supabase
    .from("v_touch_funnel_campaign_summary")
    .select(
      "campaign_id, campaign_name, total_touches, queued, scheduled, processing, sent, failed",
    )
    .order("campaign_name", { ascending: true })

  if (campaignError) {
    throw new Error(`Failed to load campaign summary: ${campaignError.message}`)
  }

  const { data: evaluations, error: evaluationError } = await supabase
    .from("v_memory_evaluations_recent")
    .select("id, created_at, actor, event_type, label, kpis, notes, importance")
    .order("created_at", { ascending: false })
    .limit(100)

  if (evaluationError) {
    throw new Error(`Failed to load evaluations: ${evaluationError.message}`)
  }

  return {
    campaigns: campaigns ?? [],
    evaluations: evaluations ?? [],
  }
}
