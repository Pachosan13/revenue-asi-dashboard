// src/app/api/auth/logout/route.ts
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true }, { status: 200 })

  try {
    const supabase = createSupabaseServerClient(req, res)
    await supabase.auth.signOut()
  } catch (e: any) {
    // Even if signOut fails, return ok=true so the UI can hard-redirect to /login.
    return NextResponse.json({ ok: true, warning: e?.message ?? "logout_failed" }, { status: 200 })
  }

  return NextResponse.json({ ok: true }, { status: 200, headers: res.headers })
}


