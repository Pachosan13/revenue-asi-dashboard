import React from "react"
import { ArrowUpRight } from "lucide-react"
import { Card, CardContent, CardHeader, StatCard } from "@/components/ui-custom"

const metrics = [
  { label: "Leads today", value: "128", delta: "+18% vs yesterday", helper: "AI scored 74 as qualified" },
  { label: "Meetings booked", value: "22", delta: "+9%", helper: "3 waiting for confirmation" },
  { label: "CAC", value: "$412", delta: "-6%", helper: "Rolling 7d" },
  { label: "Pipeline", value: "$1.8M", delta: "+12%", helper: "Next 30 days" },
]

function MiniTrend({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 120 40" className="w-full">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="3"
        points="0,25 25,30 45,18 65,26 85,14 105,16 120,10"
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />
      <linearGradient id="trend" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stopColor={color} stopOpacity="0.2" />
        <stop offset="100%" stopColor={color} stopOpacity="0" />
      </linearGradient>
      <polygon points="0,40 0,25 25,30 45,18 65,26 85,14 105,16 120,10 120,40" fill={`url(#trend)`} />
    </svg>
  )
}

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-white/50">Command Center</p>
          <h1 className="text-3xl font-semibold text-white">CEO Operating System</h1>
          <p className="text-sm text-white/60">Signal-first view of revenue, meetings, and campaign health.</p>
        </div>
        <button className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2 text-sm font-medium text-white transition hover:border-emerald-400/60">
          Create note
          <ArrowUpRight size={16} />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <StatCard key={metric.label} {...metric} />
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Pipeline velocity" description="Conversion and speed through the funnel" />
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm text-white/70">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-white/50">Win rate</p>
                <p className="text-2xl font-semibold text-white">32%</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-white/50">Avg. cycle</p>
                <p className="text-2xl font-semibold text-white">18 days</p>
              </div>
            </div>
            <MiniTrend color="#34d399" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader title="Campaigns" description="Top performers this week" />
          <CardContent className="space-y-4">
            {["Outbound A", "Inbound C", "Paid Social"].map((campaign, idx) => (
              <div key={campaign} className="flex items-center justify-between rounded-xl border border-white/5 bg-white/5 px-4 py-3">
                <div>
                  <p className="font-semibold text-white">{campaign}</p>
                  <p className="text-xs text-white/50">{idx === 0 ? "Meetings leader" : "Steady"}</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-white">{idx === 0 ? "+28%" : "12%"}</p>
                  <p className="text-xs text-white/50">reply rate</p>
                </div>
              </div>
            ))}
            <MiniTrend color="#a78bfa" />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
