import { NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

export async function GET(req: NextRequest) {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => req.cookies.getAll(),
        setAll: () => {},
      },
    },
  )

  const { data, error } = await supabase.auth.getUser()

  return NextResponse.json({
    ok: !error,
    user: data?.user ? { id: data.user.id, email: data.user.email } : null,
    error: error?.message ?? null,
    cookieNames: req.cookies.getAll().map((c) => c.name),
  })
}

