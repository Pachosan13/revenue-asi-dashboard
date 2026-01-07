import { NextResponse } from "next/server"
import { resolveActiveAccountFromJwt, setRevenueAccountCookie } from "@/app/api/_lib/resolveActiveAccount"

export const dynamic = "force-dynamic"

export async function GET(req: Request) {
  const resolved = await resolveActiveAccountFromJwt(req)
  if (!resolved.ok) {
    return NextResponse.json({ ok: false, error: resolved.error }, { status: resolved.status })
  }

  const res = NextResponse.json({
    ok: true,
    account_id: resolved.account_id,
    role: resolved.role,
  })
  setRevenueAccountCookie(res, resolved.account_id)
  return res
}


