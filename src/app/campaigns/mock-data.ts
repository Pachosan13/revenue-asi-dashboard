import { Campaign, CampaignTouch, MessageVariant } from "@/types/campaign"

export const campaignTouches: CampaignTouch[] = [
  {
    id: "t1",
    order: 1,
    channel: "email",
    delay: "Day 0",
    title: "Intro + value prop",
    preview: "Hey {{first_name}}, quick note on helping {{company}} hit pipeline goals...",
  },
  {
    id: "t2",
    order: 2,
    channel: "sms",
    delay: "+2 days",
    title: "Soft check-in",
    preview: "Text nudge with quick CTA to book time",
  },
  {
    id: "t3",
    order: 3,
    channel: "email",
    delay: "+4 days",
    title: "Pain-point story",
    preview: "Share short narrative around {{pain_point}} resolution",
  },
  {
    id: "t4",
    order: 4,
    channel: "whatsapp",
    delay: "+6 days",
    title: "Light social proof",
    preview: "WhatsApp note with 1-line case study",
  },
]

export const messageVariants: MessageVariant[] = [
  {
    id: "m1",
    label: "A",
    subject: "{{company}} x Revenue ASI",
    body: "Hey {{first_name}}, saw {{company}} ramping GTM. We built an AI operator that keeps reps on-signal and frees 6-8 hours/week. Worth a 9-min audit?",
  },
  {
    id: "m2",
    label: "B",
    subject: "Quick idea on {{pain_point}}",
    body: "Hi {{first_name}}, curious if {{pain_point}} is still slowing the team. We’ve been automating follow-ups across SMS/WhatsApp/email with <2% error rate. Open to a short teardown?",
  },
]

export const campaignsMock: Campaign[] = [
  {
    id: "c1",
    name: "Pipeline Surge Q1",
    type: "outbound",
    status: "live",
    leads_count: 1280,
    reply_rate: 18,
    meetings_booked: 64,
    conversion: 12,
    created_at: "2024-12-01",
    error_rate: 1.2,
    daily_throughput: 420,
    leads_contacted: 980,
    touches: campaignTouches,
    message_variants: messageVariants,
  },
  {
    id: "c2",
    name: "Dormant MQL Reactivation",
    type: "reactivation",
    status: "paused",
    leads_count: 860,
    reply_rate: 11,
    meetings_booked: 28,
    conversion: 7,
    created_at: "2024-11-18",
    error_rate: 2.4,
    daily_throughput: 260,
    leads_contacted: 640,
    touches: campaignTouches,
    message_variants: messageVariants,
  },
  {
    id: "c3",
    name: "Product Hunt Nurture",
    type: "nurture",
    status: "draft",
    leads_count: 420,
    reply_rate: 9,
    meetings_booked: 12,
    conversion: 4,
    created_at: "2024-12-20",
    error_rate: 0.8,
    daily_throughput: 140,
    leads_contacted: 220,
    touches: campaignTouches,
    message_variants: messageVariants,
  },
  {
    id: "c4",
    name: "WhatsApp VIP",
    type: "whatsapp",
    status: "live",
    leads_count: 320,
    reply_rate: 22,
    meetings_booked: 18,
    conversion: 15,
    created_at: "2025-01-05",
    error_rate: 1.8,
    daily_throughput: 90,
    leads_contacted: 250,
    touches: campaignTouches,
    message_variants: messageVariants,
  },
]

export function getCampaignById(id: string): Campaign | undefined {
  return campaignsMock.find((campaign) => campaign.id === id)
}
