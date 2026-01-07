import { createClient } from "@supabase/supabase-js"

type StatementTotals = {
  totals: { units: number; amount_cents: number }
  by_channel: { channel: string; units: number; amount_cents: number }[]
  by_source: { source: string; units: number; amount_cents: number }[]
}

function getAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

function iso(d: string | Date) {
  return typeof d === "string" ? d : d.toISOString()
}

/**
 * Finalizes a billing statement for a period (payment-provider agnostic).
 * This aggregates immutable usage_ledger rows and stores the totals snapshot.
 *
 * Idempotent by UNIQUE(account_id, period_start, period_end).
 */
export async function finalizeBillingStatement(
  account_id: string,
  period_start: string | Date,
  period_end: string | Date
) {
  const admin = getAdmin()
  const start = iso(period_start)
  const end = iso(period_end)

  // If already finalized, return it.
  const { data: existing } = await admin
    .from("billing_statements")
    .select("id, account_id, period_start, period_end, totals, status, created_at")
    .eq("account_id", account_id)
    .eq("period_start", start)
    .eq("period_end", end)
    .maybeSingle()

  if (existing?.status === "finalized") return existing

  const { data: rows, error } = await admin
    .from("usage_ledger")
    .select("channel, source, units, amount_cents")
    .eq("account_id", account_id)
    .gte("occurred_at", start)
    .lt("occurred_at", end)

  if (error) throw error

  const byChannel = new Map<string, { units: number; amount_cents: number }>()
  const bySource = new Map<string, { units: number; amount_cents: number }>()
  let totalUnits = 0
  let totalCents = 0

  for (const r of rows ?? []) {
    const ch = String((r as any).channel || "unknown")
    const src = String((r as any).source || "unknown")
    const u = Number((r as any).units ?? 0)
    const a = Number((r as any).amount_cents ?? 0)

    totalUnits += u
    totalCents += a

    const c = byChannel.get(ch) ?? { units: 0, amount_cents: 0 }
    c.units += u
    c.amount_cents += a
    byChannel.set(ch, c)

    const s = bySource.get(src) ?? { units: 0, amount_cents: 0 }
    s.units += u
    s.amount_cents += a
    bySource.set(src, s)
  }

  const totals: StatementTotals = {
    totals: { units: totalUnits, amount_cents: totalCents },
    by_channel: Array.from(byChannel.entries()).map(([channel, v]) => ({ channel, ...v })),
    by_source: Array.from(bySource.entries()).map(([source, v]) => ({ source, ...v })),
  }

  const payload = {
    account_id,
    period_start: start,
    period_end: end,
    totals,
    status: "finalized",
  }

  const { data: saved, error: upErr } = await admin
    .from("billing_statements")
    .upsert(payload, { onConflict: "account_id,period_start,period_end" })
    .select("id, account_id, period_start, period_end, totals, status, created_at")
    .single()

  if (upErr) throw upErr
  return saved
}


