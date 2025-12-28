// src/app/api/auth/login/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: false }, { status: 400 })

  try {
    const body = (await req.json().catch(() => null)) as
      | { email?: string; password?: string }
      | null

    const email = (body?.email ?? "").trim().toLowerCase()
    const password = body?.password ?? ""

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Missing email/password" }, { status: 400 })
    }

    const supabase = createSupabaseServerClient(req, res)

    const { data, error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 401 })
    }

    // res ya trae las cookies seteadas por setAll()
    return NextResponse.json(
      { ok: true, user: { id: data.user?.id, email: data.user?.email } },
      { status: 200, headers: res.headers },
    )
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Login failed" }, { status: 500 })
  }
}
