import { NextRequest, NextResponse } from "next/server"
import { getAccountContext } from "@/app/api/_lib/getAccountId"

export async function GET(req: NextRequest) {
  try {
    const { user, accountId, role } = await getAccountContext(req)
    return NextResponse.json({ ok: true, user, accountId, role })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 401 })
  }
}
