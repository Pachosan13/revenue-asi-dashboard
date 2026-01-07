// src/app/(app)/billing/page.tsx
"use client"

import { useEffect, useMemo, useState } from "react"
import { supabaseBrowser } from "@/lib/supabase"

type Plan = {
  name: string
  currency: "USD"
  billing_cycle: "monthly"
  included: Record<string, number> // units included per channel
  unit_cost_cents: Record<string, number> // overage cost per unit per channel
}

type BillingSummary = {
  ok: boolean
  account_id: string
  period: { from: string; to: string }
  totals: { units: number; amount_cents: number }
  by_channel: { channel: string; units: number; amount_cents: number }[]
  by_source?: { source: string; units: number; amount_cents: number }[]
  recent: {
    id: string
    channel: string
    units: number
    unit_cost_cents: number
    amount_cents: number
    source: string
    ref_id: string
    occurred_at: string
    meta: unknown
  }[]
  plan: Plan | null
  overage: {
    included_total_cents: number
    included_left_cents: number
    overage_units: Record<string, number>
    overage_cents: Record<string, number>
    total_overage_cents: number
  } | null
  projection: {
    pace: {
      elapsed_days: number
      days_in_month: number
      multiplier: number
    }
    projected_amount_cents: number
    projected_units: number
    projected_overage_cents: number
    projected_total_cents: number
  } | null
}

function dollars(cents = 0) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string
  value: string | number
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/40 p-5">
      <div className="text-sm text-slate-400">{label}</div>
      <div className="mt-1 text-3xl font-semibold text-white">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  )
}

function Pill({ text }: { text: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-slate-300">
      {text}
    </span>
  )
}

function Bar({
  label,
  used,
  included,
  right,
}: {
  label: string
  used: number
  included: number
  right: string
}) {
  const pct = included > 0 ? clamp((used / included) * 100, 0, 140) : 0
  const capped = clamp(pct, 0, 100)
  const over = pct > 100

  return (
    <div className="px-6 py-4">
      <div className="mb-2 flex items-center justify-between text-sm">
        <div className="text-white uppercase">{label}</div>
        <div className="text-slate-300">{right}</div>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-2 ${over ? "bg-red-500/70" : "bg-emerald-500/70"}`}
          style={{ width: `${capped}%` }}
        />
      </div>
      <div className="mt-2 text-xs text-slate-500">
        {included > 0 ? (
          <>
            {used} used · {Math.max(included - used, 0)} left · {included} included
            {over ? " · over limit" : ""}
          </>
        ) : (
          <>No limit configured</>
        )}
      </div>
    </div>
  )
}

function safeDate(d?: string) {
  if (!d) return "—"
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleDateString()
}

function safeDateTime(d?: string) {
  if (!d) return "—"
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? "—" : t.toLocaleString()
}

export default function BillingPage() {
  const [data, setData] = useState<BillingSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const supabase = supabaseBrowser()
    ;(async () => {
      const { data: sess, error: sErr } = await supabase.auth.getSession()
      if (sErr) throw sErr
      const token = sess?.session?.access_token
      if (!token) throw new Error("Not authenticated")

      const r = await fetch("/api/billing/summary", {
        credentials: "include",
        headers: { Authorization: `Bearer ${token}` },
      })
      const j = await r.json()
      if (!j?.ok) throw new Error(j?.error || "Failed to load billing")
      setData(j)
    })()
      .catch((e) => setErr(e?.message || String(e)))
      .finally(() => setLoading(false))
  }, [])

  const computed = useMemo(() => {
    if (!data) return null
    const by = (data.by_channel || []).slice().sort((a, b) => b.amount_cents - a.amount_cents)
    const top = by[0]?.channel ? String(by[0].channel).toUpperCase() : "—"

    const plan = data.plan
    const over = data.overage
    const proj = data.projection

    return { top, by, plan, over, proj }
  }, [data])

  // IMPORTANT: no Shell here. (app)/layout.tsx owns the shell + padding.
  return (
    <div className="max-w-6xl">
      {loading ? (
        <div className="rounded-xl border border-white/10 bg-black/30 p-6 text-slate-300">
          Loading billing…
        </div>
      ) : err ? (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-6 text-red-200">
          Billing error: {err}
        </div>
      ) : !data || !computed ? null : (
        (() => {
          const { plan, over, proj, top } = computed

          return (
            <>
              {/* Header */}
              <div className="mb-7">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <h1 className="text-2xl font-semibold text-white">Billing</h1>
                    <p className="mt-1 text-sm text-slate-400">
                      Billed only on{" "}
                      <span className="text-white/90">provider-accepted</span> deliveries · Updates every hour
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Pill text="No failed messages charged" />
                    <Pill text="Retries not billed" />
                    <Pill text="Auditable per delivery" />
                  </div>
                </div>

                <div className="mt-4 text-xs text-slate-500">
                  Period: {safeDate(data.period?.from)} → {safeDate(data.period?.to)}
                </div>
              </div>

              {/* KPIs */}
              <div className="mb-8 grid grid-cols-1 gap-6 md:grid-cols-4">
                <Stat
                  label="Current spend"
                  value={dollars(data.totals?.amount_cents ?? 0)}
                  sub="This billing period"
                />
                <Stat
                  label="Accepted deliveries"
                  value={data.totals?.units ?? 0}
                  sub="Provider accepted"
                />
                <Stat label="Top channel" value={top} sub="Highest spend" />
                <Stat
                  label="Projected month-end"
                  value={dollars(proj?.projected_total_cents ?? (data.totals?.amount_cents ?? 0))}
                  sub={
                    proj
                      ? `Pace ×${proj.pace.multiplier.toFixed(2)} (${proj.pace.elapsed_days}/${proj.pace.days_in_month} days)`
                      : "Projection unavailable"
                  }
                />
              </div>

              {/* Plan + limits */}
              <div className="mb-10 grid grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/10 px-6 py-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-medium text-white">Plan & limits</h2>
                      <span className="text-xs text-slate-400">
                        {plan ? `${plan.name} · ${plan.billing_cycle}` : "No plan set"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      Included units reset monthly. Overages apply only after limits are exceeded.
                    </p>
                  </div>

                  {plan ? (
                    <div className="divide-y divide-white/5">
                      {Object.keys(plan.included).map((ch) => {
                        const row = (data.by_channel || []).find((x) => x.channel === ch)
                        const used = Number(row?.units ?? 0)
                        const included = Number(plan.included[ch] ?? 0)
                        const unitCost = Number(plan.unit_cost_cents[ch] ?? 0)
                        const overUnits = Math.max(used - included, 0)
                        const overCents = overUnits * unitCost

                        return (
                          <Bar
                            key={ch}
                            label={ch}
                            used={used}
                            included={included}
                            right={
                              overUnits > 0
                                ? `${overUnits} over · ${dollars(overCents)}`
                                : `${Math.max(included - used, 0)} left`
                            }
                          />
                        )
                      })}
                    </div>
                  ) : (
                    <div className="px-6 py-6 text-sm text-slate-500">
                      No plan configured yet. You can still see usage & audit trail.
                    </div>
                  )}
                </div>

                {/* Overages + projection breakdown */}
                <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                  <div className="border-b border-white/10 px-6 py-4">
                    <h2 className="text-sm font-medium text-white">Charges breakdown</h2>
                    <p className="mt-1 text-xs text-slate-500">
                      Current period + projection. Everything ties back to the audit trail.
                    </p>
                  </div>

                  <div className="px-6 py-5">
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                      <Stat
                        label="Included value (est.)"
                        value={dollars(over?.included_total_cents ?? 0)}
                        sub="For reference (what plan covers)"
                      />
                      <Stat
                        label="Overage so far"
                        value={dollars(over?.total_overage_cents ?? 0)}
                        sub="Only if above limits"
                      />
                      <Stat
                        label="Projected overage"
                        value={dollars(proj?.projected_overage_cents ?? 0)}
                        sub="If pace continues"
                      />
                      <Stat
                        label="Projected total"
                        value={dollars(proj?.projected_total_cents ?? (data.totals?.amount_cents ?? 0))}
                        sub="Month-end estimate"
                      />
                    </div>

                    {plan && over && (
                      <div className="mt-5 rounded-lg border border-white/10 bg-black/40 p-4">
                        <div className="mb-2 text-xs text-slate-400">Overage by channel</div>
                        <div className="space-y-2">
                          {Object.keys(plan.included).map((ch) => {
                            const u = Number(over.overage_units?.[ch] ?? 0)
                            const c = Number(over.overage_cents?.[ch] ?? 0)
                            return (
                              <div key={ch} className="flex items-center justify-between text-sm">
                                <div className="text-white uppercase">{ch}</div>
                                <div className="text-slate-300">{u > 0 ? `${u} · ${dollars(c)}` : "—"}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    <div className="mt-5 text-xs text-slate-500">
                      Billing is generated from <span className="text-white/80">usage_ledger</span> events created only when the provider
                      accepts delivery.
                    </div>
                  </div>
                </div>
              </div>

              {/* Usage by channel (money + units) */}
              <div className="mb-10 overflow-hidden rounded-xl border border-white/10 bg-black/30">
                <div className="border-b border-white/10 px-6 py-4">
                  <h2 className="text-sm font-medium text-white">Accepted usage by channel</h2>
                </div>

                <div className="divide-y divide-white/5">
                  {computed.by?.length ? (
                    computed.by.map((c) => (
                      <div key={c.channel} className="flex items-center justify-between px-6 py-4 text-sm">
                        <div>
                          <div className="text-white uppercase">{c.channel}</div>
                          <div className="text-xs text-slate-500">{c.units} accepted</div>
                        </div>
                        <div className="text-slate-300">{dollars(c.amount_cents)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-6 py-4 text-sm text-slate-500">No usage yet.</div>
                  )}
                </div>
              </div>

              {/* Audit trail */}
              <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
                <div className="border-b border-white/10 px-6 py-4">
                  <h2 className="text-sm font-medium text-white">Billing audit trail</h2>
                  <p className="mt-1 text-xs text-slate-500">
                    Last 50 accepted deliveries. Click-through wiring can come later.
                  </p>
                </div>

                <div className="divide-y divide-white/5">
                  {data.recent?.length ? (
                    data.recent.map((r) => (
                      <div key={r.id} className="flex items-center justify-between px-6 py-4 text-sm">
                        <div>
                          <div className="text-white uppercase">{r.channel}</div>
                          <div className="text-xs text-slate-500">
                            {safeDateTime(r.occurred_at)} · {r.source}
                          </div>
                          <div className="mt-1 font-mono text-[11px] text-slate-600">
                            ref: {String(r.ref_id).slice(0, 8)}…{String(r.ref_id).slice(-6)}
                          </div>
                        </div>
                        <div className="text-slate-300">{dollars(r.amount_cents)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="px-6 py-6 text-sm text-slate-500">No billing activity yet.</div>
                  )}
                </div>
              </div>

              <div className="mt-10 text-xs text-slate-500">
                You are never charged for failed sends, retries, or dry runs. Charges reflect provider-accepted deliveries only.
              </div>
            </>
          )
        })()
      )}
    </div>
  )
}
