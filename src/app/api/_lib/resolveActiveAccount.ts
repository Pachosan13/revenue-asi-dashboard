import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"
import { getAccessTokenFromRequest } from "@/app/api/_lib/getAccessToken"

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
}

export function createSupabaseUserClientFromJwt(jwt: string) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error("Missing Supabase env vars")

  return createClient(url, anon, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
}

export async function resolveActiveAccountFromJwt(req: Request): Promise<
  | { ok: true; account_id: string; role: string; user_id: string; jwt: string }
  | { ok: false; status: number; error: string }
> {
  const jwt = await getAccessTokenFromRequest()
  if (!jwt) return { ok: false, status: 401, error: "Missing Authorization Bearer token" }

  const userClient = createSupabaseUserClientFromJwt(jwt)
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData?.user?.id) return { ok: false, status: 401, error: "Invalid session" }

  const user_id = userData.user.id
  if (!isUuidLike(user_id)) return { ok: false, status: 401, error: "Invalid session" }

  // RLS: account_members_read_self ensures user_id=auth.uid()
  const { data: m, error: mErr } = await userClient
    .from("account_members")
    .select("account_id, role, created_at")
    .eq("user_id", user_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (mErr) return { ok: false, status: 500, error: mErr.message }
  if (!m?.account_id) return { ok: false, status: 403, error: "No account membership" }

  return {
    ok: true,
    account_id: String(m.account_id),
    role: String(m.role || "member"),
    user_id,
    jwt,
  }
}

export function setRevenueAccountCookie(res: NextResponse, accountId: string) {
  res.cookies.set("revenue_account_id", accountId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  })
}


