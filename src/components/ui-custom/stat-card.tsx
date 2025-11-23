import React from "react"
import { cn } from "@/lib/utils"
import { Card } from "./card"

export function StatCard({
  label,
  value,
  delta,
  helper,
  icon,
}: {
  label: string
  value: string
  delta?: string
  helper?: string
  icon?: React.ReactNode
}) {
  const trendPositive = delta ? delta.trim().startsWith("+") : false
  return (
    <Card className="p-5 transition hover:-translate-y-0.5 hover:shadow-[0_20px_60px_rgba(0,0,0,0.35)]">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-3">
          <p className="text-sm uppercase tracking-[0.12em] text-white/60">{label}</p>
          <p className="text-3xl font-semibold text-white">{value}</p>
          {helper ? <p className="text-xs text-white/50">{helper}</p> : null}
        </div>
        <div className={cn("flex items-center gap-2 rounded-xl px-3 py-2 text-sm", trendPositive ? "bg-emerald-500/10 text-emerald-300" : "bg-white/5 text-white/70")}> 
          {icon}
          {delta}
        </div>
      </div>
    </Card>
  )
}
