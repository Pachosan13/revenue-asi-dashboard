import { NextResponse } from "next/server"
import { setRevenueAccountCookie } from "@/app/api/_lib/resolveActiveAccount"
import { getAccessTokenFromRequest } from "@/app/api/_lib/getAccessToken"
import { createServiceRoleClient, createUserClientFromJwt } from "@/app/api/_lib/createUserClientFromJwt"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const token = await getAccessTokenFromRequest()
  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing Authorization Bearer token" }, { status: 401 })
  }

  // Deterministic JWT validation: always validate using service role client.
  const authClient = createServiceRoleClient()
  const { data: userData, error: userErr } = await authClient.auth.getUser(token)
  if (userErr || !userData?.user?.id) {
    return NextResponse.json({ ok: false, error: "Invalid session" }, { status: 401 })
  }
  const user_id = userData.user.id

  // RLS client (anon + Bearer JWT) for all membership queries
  const supabase = createUserClientFromJwt(token)

  // RLS: account_members_read_self ensures user_id=auth.uid()
  const { data: m, error: mErr } = await supabase
    .from("account_members")
    .select("account_id, role, created_at")
    .eq("user_id", user_id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle()

  if (mErr) {
    return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 })
  }
  if (!m?.account_id) {
    return NextResponse.json({ ok: false, error: "No account membership" }, { status: 403 })
  }

  const res = NextResponse.json({ ok: true, account_id: String(m.account_id), role: String(m.role || "member") })
  setRevenueAccountCookie(res, String(m.account_id))
  return res
}


