import { NextRequest, NextResponse } from "next/server"
import { getAccountContextOrThrow } from "@/app/api/_lib/getAccountContextOrThrow"
import { handleCommandOsIntent } from "@/app/backend/src/command-os/router"

export const runtime = "nodejs"

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await getAccountContextOrThrow(req)
    const body = await req.json().catch(() => ({} as any))

    const campaignId = String(body?.campaign_id ?? "").trim()
    const isActive = body?.is_active

    if (!campaignId) return NextResponse.json({ ok: false, error: "campaign_id required" }, { status: 400 })
    if (typeof isActive !== "boolean") return NextResponse.json({ ok: false, error: "is_active boolean required" }, { status: 400 })

    const execution = await handleCommandOsIntent({
      version: "v1",
      intent: "campaign.toggle" as any,
      args: { account_id: accountId, campaign_id: campaignId, is_active: isActive },
      explanation: "api_campaigns_toggle",
      confidence: 1,
    })

    return NextResponse.json(execution, { status: execution.ok ? 200 : 400 })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 })
  }
}


