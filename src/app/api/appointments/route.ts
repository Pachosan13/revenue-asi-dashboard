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

  // Ajusta esto a tu lógica real si ya tienes getAccountContextOrThrow.
  // Aquí solo evitamos que reviente el build.
  let query = supabase.from("appointments").select("*").order("created_at", { ascending: false }).limit(100)

  if (account_id) query = query.eq("account_id", account_id)

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data })
}

export async function POST(req: Request) {
  const supabase = getSupabaseAdmin()
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase env vars" },
      { status: 500 },
    )
  }

  const body = await req.json().catch(() => ({}))
  const { account_id, ...payload } = body ?? {}

  if (!account_id) {
    return NextResponse.json(
      { ok: false, error: "Missing account_id" },
      { status: 400 },
    )
  }

  const { data, error } = await supabase
    .from("appointments")
    .insert({ account_id, ...payload })
    .select()
    .maybeSingle()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, data })
}
