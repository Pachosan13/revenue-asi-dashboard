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

function isLocalSupabaseUrl() {
  const u = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
  return /localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(u)
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
  if (!m?.account_id) {
    // Local-only convenience: auto-provision a default account + membership for the logged-in user.
    // This prevents Command OS from being unusable right after `supabase db reset`.
    if (!isLocalSupabaseUrl()) throw new Error("Unauthorized: no membership in account_members")

    const { data: acct, error: aErr } = await supabase
      .from("accounts")
      .insert({ name: "Local Account" })
      .select("id")
      .single()

    if (aErr) throw new Error(`Account auto-provision failed: ${aErr.message}`)

    const { error: amErr } = await supabase.from("account_members").insert({
      account_id: acct.id,
      user_id: userId,
      role: "owner",
    })

    if (amErr) throw new Error(`Membership auto-provision failed: ${amErr.message}`)

    return {
      supabase,
      user: { id: userId, email: auth.user.email ?? null },
      userId,
      accountId: acct.id as string,
      role: "owner",
    }
  }

  return {
    supabase,
    user: { id: userId, email: auth.user.email ?? null },
    userId,
    accountId: m.account_id as string,
    role: (m.role as string) ?? "member",
  }
}
