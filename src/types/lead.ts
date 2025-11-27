export interface LeadEnriched {
  id: string
  full_name: string
  email: string | null
  phone: string | null
  state: string
  last_touch_at: string | null
  campaign_id: string | null
  campaign_name: string | null
  channel_last: string | null
}

export type LeadRaw = {
  id: string
  created_at: string
  source: string | null
  payload: Record<string, unknown>
}
