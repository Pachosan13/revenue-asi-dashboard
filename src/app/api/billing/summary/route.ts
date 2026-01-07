// src/app/api/billing/summary/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveActiveAccountFromJwt, setRevenueAccountCookie } from "@/app/api/_lib/resolveActiveAccount"
import { getAccessTokenFromRequest } from "@/app/api/_lib/getAccessToken"
import { createServiceRoleClient, createUserClientFromJwt } from "@/app/api/_lib/createUserClientFromJwt"

export const dynamic = "force-dynamic"

function startOfMonthISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
}

function startOfNextMonthISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 1).toISOString()
}

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
}

function getInternalToken(req: Request) {
  return (req.headers.get("x-internal-token") || "").trim() || null
}

function parseCookies(header: string | null): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out

  header.split(";").forEach((part) => {
    const [k, ...v] = part.trim().split("=")
    if (!k) return
    out[k] = decodeURIComponent(v.join("="))
  })
  return out
}

export async function GET(req: Request) {
  try {
    // ─────────────────────────────────────────
    // 1) Account context (hard, explicit, safe)
    // ─────────────────────────────────────────
    const cookieHeader = req.headers.get("cookie")
    const cookies = parseCookies(cookieHeader)
    let accountId = cookies["revenue_account_id"]
    let shouldSetAccountCookie = false

    // If cookie missing/invalid, resolve active account from JWT membership and set cookie for compatibility.
    if (!accountId || !isUuidLike(accountId)) {
      const resolved = await resolveActiveAccountFromJwt(req)
      if (!resolved.ok) {
        return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status })
      }
      accountId = resolved.account_id
      shouldSetAccountCookie = true
    }

    // ─────────────────────────────────────────
    // 2) Supabase clients
    // ─────────────────────────────────────────
    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !ANON_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing Supabase env vars" },
        { status: 500 }
      )
    }

    const from = startOfMonthISO()
    const to = startOfNextMonthISO()
    const now = new Date()

    // ─────────────────────────────────────────
    // 2.05) Minimal authz
    // Prefer membership check via JWT. Optional hard-gate via internal token for emergencies.
    // ─────────────────────────────────────────
    const INTERNAL_ONLY = String(process.env.BILLING_INTERNAL_ONLY || "").toLowerCase() === "true"
    const internalToken = getInternalToken(req)
    const internalExpected = String(process.env.BILLING_INTERNAL_TOKEN || "")

    const jwt = INTERNAL_ONLY ? null : await getAccessTokenFromRequest()
    const userClient = INTERNAL_ONLY || !jwt ? null : createUserClientFromJwt(jwt)

    if (INTERNAL_ONLY) {
      if (!internalExpected || !internalToken || internalToken !== internalExpected) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
      }
    } else {
      if (!jwt) {
        return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 })
      }
      if (!userClient) {
        return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 })
      }

      // Deterministic JWT validation: always validate using service role client.
      const authClient = createServiceRoleClient()
      const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
      if (userErr) {
        return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 })
      }
      const authedUserId = userData?.user?.id ?? null
      if (!authedUserId) {
        return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 })
      }

      // RLS on account_members should enforce user_id=auth.uid(), but we still filter explicitly.
      const { data: mem, error: memErr } = await userClient
        .from("account_members")
        .select("role")
        .eq("account_id", accountId)
        .eq("user_id", authedUserId)
        .maybeSingle()

      if (memErr) throw memErr
      if (!mem) {
        return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
      }
    }

    // ─────────────────────────────────────────
    // 2.1) Plan lookup (READ-ONLY; do not mutate on GET)
    // ─────────────────────────────────────────
    const billingClient =
      INTERNAL_ONLY && SERVICE_ROLE_KEY
        ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
        : userClient

    if (!billingClient) {
      return NextResponse.json({ ok: false, error: "Missing billing client" }, { status: 500 })
    }

    const { data: abRow, error: abErr } = await billingClient
      .from("account_billing")
      .select("plan_id, status")
      .eq("account_id", accountId)
      .maybeSingle()

    if (abErr) throw abErr

    const needsPlan = !(abRow as any)?.plan_id
    const planId: string | null = (abRow as any)?.plan_id ?? null

    let planRow: any | null = null
    if (planId && SERVICE_ROLE_KEY) {
      const srv = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
      const { data: pRow, error: pErr } = await srv
        .from("billing_plans")
        .select("id, name, currency, billing_cycle, included, unit_cost_cents, active")
        .eq("id", planId)
        .maybeSingle()
      if (pErr) throw pErr
      planRow = pRow ?? null
    }

    // ─────────────────────────────────────────
    // 3) Totales por canal
    // ─────────────────────────────────────────
    const byChannel = new Map<string, { units: number; amount_cents: number }>()
    let totalUnits = 0
    let totalCents = 0

    const { data: chAgg, error: chErr } = await billingClient.rpc("billing_usage_by_channel", {
      p_account_id: accountId,
      p_from: from,
      p_to: to,
    })
    if (chErr) throw chErr

    for (const r of (chAgg as any[]) ?? []) {
      const ch = String(r.channel)
      const u = Number(r.units ?? 0)
      const a = Number(r.amount_cents ?? 0)
      byChannel.set(ch, { units: u, amount_cents: a })
      totalUnits += u
      totalCents += a
    }

    const bySource = new Map<string, { units: number; amount_cents: number }>()
    const { data: srcAgg, error: srcErr } = await billingClient.rpc("billing_usage_by_source", {
      p_account_id: accountId,
      p_from: from,
      p_to: to,
    })
    if (srcErr) throw srcErr

    for (const r of (srcAgg as any[]) ?? []) {
      const s = String(r.source ?? "unknown")
      const u = Number(r.units ?? 0)
      const a = Number(r.amount_cents ?? 0)
      bySource.set(s, { units: u, amount_cents: a })
    }

    // ─────────────────────────────────────────
    // 4) Últimos eventos
    // ─────────────────────────────────────────
    const { data: recent } = await billingClient
      .from("usage_ledger")
      .select(
        "id, channel, units, unit_cost_cents, amount_cents, source, ref_id, occurred_at, meta"
      )
      .eq("account_id", accountId)
      .order("occurred_at", { ascending: false })
      .limit(50)

    // ─────────────────────────────────────────
    // 5) Plan/overage + pace projection
    // ─────────────────────────────────────────
    const plan =
      planRow && planRow.name
        ? {
            name: String(planRow.name),
            currency: (String(planRow.currency || "USD") as "USD") || "USD",
            billing_cycle: (String(planRow.billing_cycle || "monthly") as "monthly") || "monthly",
            included: (planRow.included ?? {}) as Record<string, number>,
            unit_cost_cents: (planRow.unit_cost_cents ?? {}) as Record<string, number>,
          }
        : null

    const usedByChannel: Record<string, number> = {}
    for (const [ch, v] of byChannel.entries()) usedByChannel[ch] = Number(v.units ?? 0)

    const overage =
      plan && plan.included && plan.unit_cost_cents
        ? (() => {
            const overage_units: Record<string, number> = {}
            const overage_cents: Record<string, number> = {}
            let included_total_cents = 0
            let included_left_cents = 0
            let total_overage_cents = 0

            for (const ch of Object.keys(plan.included || {})) {
              const includedUnits = Number((plan.included as any)?.[ch] ?? 0)
              const usedUnits = Number(usedByChannel[ch] ?? 0)
              const unitCost = Number((plan.unit_cost_cents as any)?.[ch] ?? 0)

              const overUnits = Math.max(usedUnits - includedUnits, 0)
              const leftUnits = Math.max(includedUnits - usedUnits, 0)

              overage_units[ch] = overUnits
              overage_cents[ch] = overUnits * unitCost

              included_total_cents += includedUnits * unitCost
              included_left_cents += leftUnits * unitCost
              total_overage_cents += overage_cents[ch]
            }

            return {
              included_total_cents,
              included_left_cents,
              overage_units,
              overage_cents,
              total_overage_cents,
            }
          })()
        : null

    const elapsedMs = Math.max(now.getTime() - new Date(from).getTime(), 1)
    const elapsedDays = Math.max(1, Math.ceil(elapsedMs / (24 * 60 * 60 * 1000)))
    const daysInMonth = Math.max(
      1,
      Math.round((new Date(to).getTime() - new Date(from).getTime()) / (24 * 60 * 60 * 1000))
    )
    const multiplier = daysInMonth / elapsedDays

    const projectedAmount = Math.round(totalCents * multiplier)
    const projectedUnits = Math.round(totalUnits * multiplier)

    const projectedOverageCents =
      plan && overage
        ? (() => {
            let sum = 0
            for (const ch of Object.keys(plan.included || {})) {
              const includedUnits = Number((plan.included as any)?.[ch] ?? 0)
              const unitCost = Number((plan.unit_cost_cents as any)?.[ch] ?? 0)
              const usedUnits = Number(usedByChannel[ch] ?? 0)
              const projUnits = Math.round(usedUnits * multiplier)
              sum += Math.max(projUnits - includedUnits, 0) * unitCost
            }
            return sum
          })()
        : 0

    const projection = {
      pace: { elapsed_days: elapsedDays, days_in_month: daysInMonth, multiplier },
      projected_amount_cents: projectedAmount,
      projected_units: projectedUnits,
      projected_overage_cents: projectedOverageCents,
      projected_total_cents: projectedAmount,
    }

    const res = NextResponse.json({
      ok: true,
      account_id: accountId,
      period: { from, to },
      totals: {
        units: totalUnits,
        amount_cents: totalCents,
      },
      by_channel: Array.from(byChannel.entries()).map(([channel, v]) => ({
        channel,
        ...v,
      })),
      by_source: Array.from(bySource.entries()).map(([source, v]) => ({
        source,
        ...v,
      })),
      recent: recent ?? [],
      plan,
      overage,
      projection,
      needs_plan: needsPlan,
    })

    if (shouldSetAccountCookie) setRevenueAccountCookie(res, accountId)
    return res
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    )
  }
}
