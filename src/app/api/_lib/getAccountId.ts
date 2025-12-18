import { cookies as nextCookies } from "next/headers"
import { NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

type AccountContext = {
  supabase: ReturnType<typeof createServerClient>
  user: { id: string; email?: string | null }
  userId: string
  accountId: string
  role: string
}

function cookieAdapter(req?: NextRequest) {
  // ✅ API route: usa req.cookies (esto es lo que funciona en Next 16)
  if (req) {
    return {
      getAll: () => req.cookies.getAll(),
      setAll: () => {}, // solo lectura (en routes no “setees” aquí)
    }
  }

  // ✅ Server Component: usa next/headers cookies()
  const store = nextCookies()
  return {
    getAll: () => (typeof (store as any).getAll === "function" ? (store as any).getAll() : []),
    setAll: () => {}, // solo lectura
  }
}

export async function getAccountContext(req?: NextRequest): Promise<AccountContext> {
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: cookieAdapter(req) },
  )

  const { data: auth, error: authErr } = await supabase.auth.getUser()
  if (authErr) throw new Error(authErr.message)
  const userId = auth?.user?.id
  if (!userId) throw new Error("Unauthorized: no session")

  // ✅ tu tabla real: account_members (account_id, user_id, role)
  const { data: m, error: mErr } = await supabase
    .from("account_members")
    .select("account_id, role")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()

  if (mErr) throw new Error(`Membership lookup failed: ${mErr.message}`)
  if (!m?.account_id) throw new Error("Unauthorized: no membership in account_members")

  return {
    supabase,
    user: { id: userId, email: auth.user.email ?? null },
    userId,
    accountId: m.account_id as string,
    role: (m.role as string) ?? "member",
  }
}
