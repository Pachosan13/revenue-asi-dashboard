export type CampaignStatus = "live" | "paused" | "draft"
export type CampaignType = "outbound" | "nurture" | "reactivation" | "whatsapp" | "sms" | "email"

export type Campaign = {
  id: string
  name: string
  type: CampaignType
  status: CampaignStatus
  leads_count: number
  reply_rate: number
  meetings_booked: number
  conversion: number
  created_at: string
  error_rate?: number
  daily_throughput?: number
  leads_contacted?: number
  touches?: CampaignTouch[]
  message_variants?: MessageVariant[]
}

export type CampaignTouch = {
  id: string
  order: number
  channel: "sms" | "email" | "whatsapp"
  delay: string
  title: string
  preview: string
}

export type MessageVariant = {
  id: string
  label: "A" | "B"
  subject?: string
  body: string
}

export type SystemEventSeries = {
  label: string
  color: string
  data: number[]
}
