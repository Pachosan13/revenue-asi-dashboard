// src/middleware.ts
import { NextRequest, NextResponse } from "next/server"
import { createSupabaseServerClient } from "@/lib/supabase/server"

export async function middleware(req: NextRequest) {
  const res = NextResponse.next()
  const supabase = createSupabaseServerClient(req, res)

  const { data } = await supabase.auth.getUser()
  const user = data?.user ?? null

  const path = req.nextUrl.pathname

  const isProtected =
    path.startsWith("/command-os") ||
    path.startsWith("/dashboard") ||
    path.startsWith("/director") ||
    path.startsWith("/appointments") ||
    path.startsWith("/leads")

  if (isProtected && !user) {
    const url = req.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("next", path)
    return NextResponse.redirect(url)
  }

  return res
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api).*)"],
}
