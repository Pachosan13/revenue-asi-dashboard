import { NextRequest, NextResponse } from "next/server"
import { getAccountContextOrThrow } from "@/app/api/_lib/getAccountContextOrThrow"
import { handleCommandOsIntent } from "@/app/backend/src/command-os/router"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await getAccountContextOrThrow(req)
    const body = await req.json().catch(() => ({} as any))

    const applyTo = body?.apply_to
    const setActive = body?.set_active
    const confirm = body?.confirm

    const execution = await handleCommandOsIntent({
      version: "v1",
      intent: "campaign.toggle.bulk" as any,
      args: { account_id: accountId, apply_to: applyTo, set_active: setActive, confirm },
      explanation: "api_campaigns_toggle_bulk",
      confidence: 1,
    })

    return NextResponse.json(execution, { status: execution.ok ? 200 : 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 })
  }
}


