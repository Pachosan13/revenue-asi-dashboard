export interface CampaignSummary {
  campaign_id: string
  campaign_name: string
  total_touches: number | null
  queued: number | null
  scheduled: number | null
  processing: number | null
  sent: number | null
  failed: number | null
}

export interface EvaluationEvent {
  id: string
  created_at: string
  actor: string | null
  event_type: string | null
  label: string | null
  kpis: Record<string, unknown> | null
  notes: string | null
  importance: number | null
}
