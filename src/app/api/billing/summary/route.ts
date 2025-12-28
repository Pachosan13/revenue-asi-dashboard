// src/app/api/billing/summary/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

function startOfMonthISO(d = new Date()) {
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString()
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
    const accountId = cookies["revenue_account_id"]

    if (!accountId) {
      return NextResponse.json(
        { ok: false, error: "Missing revenue_account_id cookie" },
        { status: 401 }
      )
    }

    // ─────────────────────────────────────────
    // 2) Supabase admin (billing = service role)
    // ─────────────────────────────────────────
    const SUPABASE_URL = process.env.SUPABASE_URL
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { ok: false, error: "Missing Supabase env vars" },
        { status: 500 }
      )
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })

    const from = startOfMonthISO()

    // ─────────────────────────────────────────
    // 3) Totales por canal
    // ─────────────────────────────────────────
    const { data: rows, error } = await admin
      .from("usage_ledger")
      .select("channel, units, amount_cents")
      .eq("account_id", accountId)
      .gte("occurred_at", from)

    if (error) throw error

    const byChannel = new Map<string, { units: number; amount_cents: number }>()
    let totalUnits = 0
    let totalCents = 0

    for (const r of rows ?? []) {
      const ch = r.channel
      const u = Number(r.units ?? 0)
      const a = Number(r.amount_cents ?? 0)

      totalUnits += u
      totalCents += a

      const cur = byChannel.get(ch) ?? { units: 0, amount_cents: 0 }
      cur.units += u
      cur.amount_cents += a
      byChannel.set(ch, cur)
    }

    // ─────────────────────────────────────────
    // 4) Últimos eventos
    // ─────────────────────────────────────────
    const { data: recent } = await admin
      .from("usage_ledger")
      .select(
        "id, channel, units, unit_cost_cents, amount_cents, source, ref_id, occurred_at, meta"
      )
      .eq("account_id", accountId)
      .order("occurred_at", { ascending: false })
      .limit(50)

    return NextResponse.json({
      ok: true,
      account_id: accountId,
      period: { from, to: new Date().toISOString() },
      totals: {
        units: totalUnits,
        amount_cents: totalCents,
      },
      by_channel: Array.from(byChannel.entries()).map(([channel, v]) => ({
        channel,
        ...v,
      })),
      recent: recent ?? [],
      plan: null,
      overage: null,
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? String(err) },
      { status: 500 }
    )
  }
}
