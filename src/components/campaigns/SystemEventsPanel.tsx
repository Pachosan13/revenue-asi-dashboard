import React from "react"
import { CalendarClock, RotateCcw, Send, ShieldAlert } from "lucide-react"
import { Card, CardContent, CardHeader } from "../ui-custom"
import { SystemEventSeries } from "@/types/campaign"

function Sparkline({ series }: { series: SystemEventSeries }) {
  const max = Math.max(...series.data, 1)
  const points = series.data
    .map((value, idx) => {
      const x = (idx / (series.data.length - 1 || 1)) * 100
      const y = 40 - (value / max) * 40
      return `${x},${y}`
    })
    .join(" ")

  return (
    <svg viewBox="0 0 100 40" className="h-10 w-full">
      <polyline
        fill="none"
        stroke={series.color}
        strokeWidth="2.5"
        points={points}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function SystemEventsPanel({
  deliveries,
  failures,
  retries,
}: {
  deliveries: SystemEventSeries
  failures: SystemEventSeries
  retries: SystemEventSeries
}) {
  const upcoming = [
    { label: "Batch send", value: "6:00pm PST", icon: <Send size={16} /> },
    { label: "Retry window", value: "9:15pm PST", icon: <RotateCcw size={16} /> },
    { label: "Compliance sweep", value: "Tomorrow 7:30am", icon: <ShieldAlert size={16} /> },
  ]

  return (
    <Card className="border-white/10 bg-black/40">
      <CardHeader title="System events" description="Deliveries, failures, retries" />
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-3">
          {[deliveries, failures, retries].map((series) => (
            <div key={series.label} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-white/60">
                <span>{series.label}</span>
                <span className="rounded-full bg-white/5 px-2 py-1 text-[11px] text-white/50">Live</span>
              </div>
              <Sparkline series={series} />
              <p className="text-right text-sm text-white/70">{series.data.at(-1)} today</p>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-white/60">
            <CalendarClock size={14} /> Upcoming sends
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {upcoming.map((item) => (
              <div key={item.label} className="flex items-center gap-2 rounded-xl border border-white/5 bg-black/40 px-3 py-2 text-sm text-white/70">
                <div className="rounded-full bg-white/5 p-2 text-emerald-300">{item.icon}</div>
                <div>
                  <p className="text-white">{item.value}</p>
                  <p className="text-xs text-white/50">{item.label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
