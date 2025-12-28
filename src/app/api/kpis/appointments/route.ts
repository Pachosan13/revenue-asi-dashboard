import { NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false } })
}

export async function GET(req: Request) {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase env vars" },
      { status: 500 },
    )
  }

  const { searchParams } = new URL(req.url)
  const account_id = searchParams.get("account_id")

  // Cambia esto por tu view/rpc real si ya existe.
  // Lo importante: nada explota en build.
  let q = supabase
    .from("appointments")
    .select("id, outcome, created_at, account_id")
    .order("created_at", { ascending: false })
    .limit(500)

  if (account_id) q = q.eq("account_id", account_id)

  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const total = data?.length ?? 0
  const byOutcome: Record<string, number> = {}
  for (const row of data ?? []) {
    const k = (row as any).outcome ?? "unknown"
    byOutcome[k] = (byOutcome[k] ?? 0) + 1
  }

  return NextResponse.json({ ok: true, total, byOutcome })
}
