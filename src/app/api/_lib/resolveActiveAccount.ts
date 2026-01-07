import { NextResponse } from "next/server"
import { getAccessTokenFromRequest } from "@/app/api/_lib/getAccessToken"
import { createServiceRoleClient, createUserClientFromJwt } from "@/app/api/_lib/createUserClientFromJwt"

function isUuidLike(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)
}

function expectedIssuer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ""
  return url ? `${url.replace(/\/$/, "")}/auth/v1` : ""
}

function decodeJwtPayload(token: string): any | null {
  try {
    const parts = token.split(".")
    if (parts.length < 2) return null
    const b64url = parts[1]
    const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4)
    const json =
      typeof Buffer !== "undefined"
        ? Buffer.from(b64, "base64").toString("utf8")
        : decodeURIComponent(
            Array.from(atob(b64))
              .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, "0")}`)
              .join("")
          )
    return JSON.parse(json)
  } catch {
    return null
  }
}

function issuerMismatch(token: string) {
  if (process.env.NODE_ENV === "production") return false
  const payload = decodeJwtPayload(token)
  const iss = String(payload?.iss || "")
  const exp = expectedIssuer()
  return Boolean(iss && exp && iss !== exp)
}

export async function resolveActiveAccountFromJwt(req: Request): Promise<
  | { ok: true; account_id: string; role: string; user_id: string; jwt: string }
  | { ok: false; status: number; error: string }
> {
  const jwt = await getAccessTokenFromRequest()
  if (!jwt) return { ok: false, status: 401, error: "Missing Authorization Bearer token" }
  if (issuerMismatch(jwt)) return { ok: false, status: 401, error: "Invalid session (issuer mismatch)" }

  // Deterministic JWT validation: always validate using service role client.
  const authClient = createServiceRoleClient()
  const { data: userData, error: userErr } = await authClient.auth.getUser(jwt)
  if (userErr || !userData?.user?.id) return { ok: false, status: 401, error: "Invalid session" }

  const user_id = userData.user.id
  if (!isUuidLike(user_id)) return { ok: false, status: 401, error: "Invalid session" }

  // RLS client (anon + Bearer JWT) for all membership queries
  const userClient = createUserClientFromJwt(jwt)

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


