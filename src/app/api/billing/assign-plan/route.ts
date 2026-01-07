// src/app/api/billing/assign-plan/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { resolveActiveAccountFromJwt, setRevenueAccountCookie } from "@/app/api/_lib/resolveActiveAccount"
import { getAccessTokenFromRequest } from "@/app/api/_lib/getAccessToken"

export const dynamic = "force-dynamic"

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const rawAccountId = String(body?.account_id || "").trim()
    const plan_id = String(body?.plan_id || "").trim()

    if (!isUuidLike(plan_id)) {
      return NextResponse.json({ ok: false, error: "Invalid plan_id" }, { status: 400 })
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !ANON_KEY) {
      return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 })
    }

    const jwt = await getAccessTokenFromRequest()
    if (!jwt) {
      return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 })
    }

    // userClient: anon + Bearer JWT (RLS enforced)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })

    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user?.id) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 })
    }
    const user_id = String(userData.user.id)

    // Resolve account_id (body optional; fallback to JWT membership)
    let account_id = rawAccountId
    if (!isUuidLike(account_id)) {
      const resolved = await resolveActiveAccountFromJwt(req)
      if (!resolved.ok) {
        return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status })
      }
      account_id = resolved.account_id
    }

    // Membership check (owner/admin) for that account_id
    const { data: mem, error: memErr } = await userClient
      .from("account_members")
      .select("role")
      .eq("account_id", account_id)
      .eq("user_id", user_id)
      .maybeSingle()

    if (memErr) throw memErr
    const role = String(mem?.role || "")
    if (!mem || (role !== "owner" && role !== "admin")) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 })
    }

    // Validate plan exists using service role (billing_plans is server-only)
    if (!SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 })
    }
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data: plan, error: planErr } = await admin
      .from("billing_plans")
      .select("id, name, currency, billing_cycle, included, unit_cost_cents")
      .eq("id", plan_id)
      .limit(1)
      .maybeSingle()

    if (planErr) throw planErr
    if (!plan?.id) {
      return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 })
    }

    // Upsert into account_billing using userClient (RLS enforced).
    // Try with updated_at; if column doesn't exist, retry without it.
    const nowIso = new Date().toISOString()
    const baseRow: Record<string, any> = { account_id, plan_id, status: "active" }

    const tryUpsert = async (row: Record<string, any>) => {
      return await userClient.from("account_billing").upsert(row, { onConflict: "account_id" })
    }

    let upErr = (await tryUpsert({ ...baseRow, updated_at: nowIso })).error
    if (upErr && String(upErr.message || "").toLowerCase().includes("updated_at")) {
      upErr = (await tryUpsert(baseRow)).error
    }
    if (upErr) throw upErr

    const res = NextResponse.json({ ok: true, account_id, plan_id })
    setRevenueAccountCookie(res, account_id)
    return res
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}
