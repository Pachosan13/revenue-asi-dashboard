export type LeadRaw = {
  id: string
  created_at: string
  source: string | null
  payload: Record<string, unknown>
}

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
  data: Record<string, unknown>
}
