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
<<<<<<< HEAD

export type LeadEnriched = {
  id: string
  lead_raw_id: string
  created_at: string
  full_name: string | null
  email: string | null
  phone: string | null
  company: string | null
  title: string | null
  location: string | null
  confidence: number | null
  state: LeadState
  data: Record<string, unknown>
}

export type LeadState =
  | "new"
  | "enriched"
  | "attempting"
  | "engaged"
  | "qualified"
  | "booked"
  | "dead"
=======
>>>>>>> origin/plan-joe-dashboard-v1
