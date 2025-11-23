import React from "react"
import { Activity, ArrowUpRight, Zap } from "lucide-react"
import { Campaign } from "@/types/campaign"
import { Card, CardContent } from "../ui-custom"
import { cn } from "@/lib/utils"

const accentStyles = [
  "from-emerald-500/10 via-emerald-500/5 to-transparent",
  "from-cyan-400/10 via-cyan-400/5 to-transparent",
  "from-indigo-400/15 via-indigo-500/5 to-transparent",
  "from-amber-400/15 via-amber-500/5 to-transparent",
  "from-pink-400/15 via-pink-500/5 to-transparent",
]

export function CampaignKpis({ campaign }: { campaign: Campaign }) {
  const cards = [
    { label: "Reply rate", value: `${campaign.reply_rate}%`, helper: "Rolling 7d", icon: <ArrowUpRight size={16} /> },
    { label: "Leads contacted", value: campaign.leads_contacted ?? campaign.leads_count, helper: "Reached" },
    { label: "Meetings booked", value: campaign.meetings_booked, helper: "Confirmed" },
    { label: "Error rate", value: `${campaign.error_rate ?? 0}%`, helper: "Delivery", icon: <Activity size={16} /> },
    { label: "Daily throughput", value: campaign.daily_throughput ?? 0, helper: "Messages / day", icon: <Zap size={16} /> },
  ]

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      {cards.map((card, idx) => (
        <Card
          key={card.label}
          className={cn(
            "relative overflow-hidden border-white/10 bg-white/5 p-4 backdrop-blur transition hover:-translate-y-0.5 hover:border-emerald-400/40",
          )}
        >
          <div
            className={cn(
              "pointer-events-none absolute inset-0 bg-gradient-to-br opacity-70",
              accentStyles[idx % accentStyles.length],
            )}
          />
          <CardContent className="relative space-y-3 p-0">
            <div className="flex items-start justify-between text-white/60">
              <p className="text-xs uppercase tracking-[0.14em]">{card.label}</p>
              <div className="rounded-full bg-black/50 px-2 py-1 text-[11px] text-white/50">{card.helper}</div>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-2xl font-semibold text-white">{card.value}</p>
              {card.icon ? <div className="text-emerald-300">{card.icon}</div> : null}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
