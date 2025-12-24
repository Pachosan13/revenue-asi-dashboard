// src/lib/supabase/server.ts
import { NextRequest, NextResponse } from "next/server"
import { cookies as nextCookies } from "next/headers"
import { createServerClient } from "@supabase/ssr"

/**
 * Server Supabase client con soporte para:
 * - middleware: (req, res) => lee + puede setear cookies en res
 * - route handlers: (req) => lee cookies (setAll no-op)
 * - server components: () => usa next/headers cookies() (setAll no-op)
 */
export function createSupabaseServerClient(
  req?: NextRequest,
  res?: NextResponse,
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !anon) throw new Error("Missing Supabase env vars")

  // --- Cookies adapter ---
  const cookieAdapter = {
    getAll: () => {
      // ✅ Middleware / Route handler
      if (req) return req.cookies.getAll()

      // ✅ Server components / Server actions
      const store = nextCookies()
      // Next 16: cookies().getAll existe, pero lo protegemos por si acaso
      return typeof (store as any).getAll === "function" ? (store as any).getAll() : []
    },

    setAll: (cookies: Array<{ name: string; value: string; options?: any }>) => {
      // ✅ Solo middleware/flows donde realmente retornas un NextResponse
      if (!res) return
      cookies.forEach(({ name, value, options }) => {
        res.cookies.set(name, value, options)
      })
    },
  }

  return createServerClient(url, anon, { cookies: cookieAdapter })
}
