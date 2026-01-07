import { createClient } from "@supabase/supabase-js"

export type BillableChannel = "sms" | "voice" | "email" | "whatsapp"
export type BillableProvider =
  | "telnyx"
  | "elastic"
  | "whatsapp_provider"

export type RecordUsageEventInput = {
  account_id: string
  lead_id?: string | null
  channel: BillableChannel
  provider: BillableProvider
  source: string
  ref_id: string
  units: number
  unit_cost_cents: number
  occurred_at?: string | Date
  meta?: Record<string, any>
}

type UsageLedgerRow = {
  id: string
  account_id: string
  lead_id: string | null
  channel: BillableChannel
  provider: BillableProvider
  source: string
  ref_id: string
  units: number
  unit_cost_cents: number
  amount_cents: number
  occurred_at: string
  meta: any
}

function getAdmin() {
  const SUPABASE_URL = process.env.SUPABASE_URL
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error("Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)")
  }
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

function asIso(d?: string | Date) {
  if (!d) return undefined
  if (typeof d === "string") return d
  return d.toISOString()
}

/**
 * Records ONE provider-accepted usage event into the immutable ledger.
 *
 * Idempotency strategy:
 * - UNIQUE(account_id, channel, provider, ref_id)
 * - Insert once; if duplicate, fetch and return the existing row.
 *
 * IMPORTANT: Call ONLY after provider acceptance (e.g. Telnyx message_id / call_control_id).
 */
export async function recordUsageEvent(input: RecordUsageEventInput): Promise<UsageLedgerRow> {
  const admin = getAdmin()

  const units = Math.trunc(Number(input.units))
  const unitCost = Math.trunc(Number(input.unit_cost_cents))
  if (!input.account_id) throw new Error("recordUsageEvent: account_id required")
  if (!input.channel) throw new Error("recordUsageEvent: channel required")
  if (!input.provider) throw new Error("recordUsageEvent: provider required")
  if (!input.ref_id) throw new Error("recordUsageEvent: ref_id required")
  if (!input.source) throw new Error("recordUsageEvent: source required")
  if (!Number.isFinite(units) || units <= 0) throw new Error("recordUsageEvent: units must be > 0")
  if (!Number.isFinite(unitCost)) throw new Error("recordUsageEvent: unit_cost_cents must be a number")

  // v1 invariant: non-negative unit costs, no adjustment channel yet.
  if (unitCost < 0) throw new Error("recordUsageEvent: unit_cost_cents must be >= 0")

  // Minimal guardrail to prevent insane voice charges from bad payloads.
  // Voice units are defined as billed seconds (see docs/billing.md).
  if (input.channel === "voice" && units > 7200) {
    throw new Error("recordUsageEvent: voice units too large (max 7200 seconds)")
  }

  const amount = units * unitCost

  const row = {
    account_id: input.account_id,
    lead_id: input.lead_id ?? null,
    channel: input.channel,
    provider: input.provider,
    source: input.source || "unknown",
    ref_id: input.ref_id,
    units,
    unit_cost_cents: unitCost,
    amount_cents: amount,
    occurred_at: asIso(input.occurred_at),
    meta: input.meta ?? {},
  }

  const { data: inserted, error: insErr } = await admin
    .from("usage_ledger")
    .insert(row)
    .select(
      "id, account_id, lead_id, channel, provider, source, ref_id, units, unit_cost_cents, amount_cents, occurred_at, meta"
    )
    .single()

  if (!insErr) return inserted as UsageLedgerRow

  // Idempotent: on duplicate key, fetch existing immutable row.
  if (String((insErr as any)?.code) === "23505" || String(insErr.message || "").toLowerCase().includes("duplicate")) {
    const { data: existing, error: selErr } = await admin
      .from("usage_ledger")
      .select(
        "id, account_id, lead_id, channel, provider, source, ref_id, units, unit_cost_cents, amount_cents, occurred_at, meta"
      )
      .eq("account_id", input.account_id)
      .eq("channel", input.channel)
      .eq("provider", input.provider)
      .eq("ref_id", input.ref_id)
      .single()

    if (selErr) throw selErr
    return existing as UsageLedgerRow
  }

  throw insErr
}


