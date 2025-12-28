export type LeadState =
  | "new"
  | "enriched"
  | "attempting"
  | "engaged"
  | "qualified"
  | "booked"
  | "dead"

export type LeadRaw = {
  id: string
  created_at: string
  source: string | null
  payload: Record<string, unknown>
}

/**
 * Lead enriquecido “canónico” para el dashboard.
 * Hacemos los campos extra opcionales para no pelear con vistas distintas.
 */
export interface LeadEnriched {
  id: string

  // Origen bruto
  lead_raw_id?: string
  created_at?: string

  // Datos de identidad
  full_name: string | null
  email: string | null
  phone: string | null
  company?: string | null
  title?: string | null
  location?: string | null

  // Estado
  state: LeadState | string | null

  // Funnel / timeline
  last_touch_at?: string | null
  campaign_id?: string | null
  campaign_name?: string | null
  channel_last?: string | null

  // Enrichment extra
  confidence?: number | null
  data?: Record<string, unknown>

  // Permite que otras vistas añadan campos sin romper tipos
  [key: string]: unknown
}
