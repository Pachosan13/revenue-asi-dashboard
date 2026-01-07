// src/app/api/billing/assign-plan/route.ts
import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

export const dynamic = "force-dynamic"

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
}

function getBearerToken(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/^Bearer\s+(.+)$/i)
  return m?.[1]?.trim() || null
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const account_id = String(body?.account_id || "").trim()
    const plan_id = String(body?.plan_id || "").trim()

    if (!isUuidLike(account_id)) {
      return NextResponse.json({ ok: false, error: "Invalid account_id" }, { status: 400 })
    }
    if (!isUuidLike(plan_id)) {
      return NextResponse.json({ ok: false, error: "Invalid plan_id" }, { status: 400 })
    }

    const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
    const ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !ANON_KEY || !SERVICE_ROLE_KEY) {
      return NextResponse.json({ ok: false, error: "Missing Supabase env vars" }, { status: 500 })
    }

    const jwt = getBearerToken(req)
    if (!jwt) {
      return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 })
    }

    // Client with user JWT (RLS enforced)
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    })

    // 1) Validate JWT + get user id
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData?.user?.id) {
      return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 })
    }
    const user_id = userData.user.id

    // 2) Must be owner/admin on that account (your RLS policies match this)
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

    // 3) Validate plan exists (server-only check; does NOT bypass RLS for account_billing)
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } })
    const { data: plan, error: planErr } = await admin
      .from("billing_plans")
      .select("id, name")
      .eq("id", plan_id)
      .maybeSingle()

    if (planErr) throw planErr
    if (!plan) {
      return NextResponse.json({ ok: false, error: "Plan not found" }, { status: 404 })
    }

    // 4) Upsert into account_billing using ONLY columns that exist
    const nowIso = new Date().toISOString()
    const { error: upErr } = await userClient
      .from("account_billing")
      .upsert(
        {
          account_id,
          plan_id,
          status: "active",
          updated_at: nowIso,
          created_at: nowIso, // safe even if conflict; DB can keep original
        },
        { onConflict: "account_id" }
      )

    if (upErr) throw upErr

    return NextResponse.json({
      ok: true,
      account_id,
      plan_id,
      plan_name: plan.name,
      status: "active",
    })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 })
  }
}
