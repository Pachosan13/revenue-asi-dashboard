import { NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabaseServer"

const UUID_REGEX = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/

export async function POST(req: Request) {
  let body: unknown

  try {
    body = await req.json()
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body"
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }

  const campaignId = typeof (body as { campaign_id?: unknown })?.campaign_id === "string"
    ? (body as { campaign_id: string }).campaign_id
    : null

  if (!campaignId || !UUID_REGEX.test(campaignId)) {
    return NextResponse.json({ ok: false, error: "Invalid campaign_id" }, { status: 400 })
  }

  try {
    const supabase = createServiceRoleClient()
    const { data, error } = await supabase.functions.invoke("touch-orchestrator-v6", {
      body: { campaign_id: campaignId, debug: true },
    })

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, data })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
