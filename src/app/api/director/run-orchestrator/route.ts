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

  const campaignId =
    typeof (body as { campaign_id?: unknown })?.campaign_id === "string"
      ? (body as { campaign_id: string }).campaign_id
      : null

  const limitRaw = (body as { limit?: unknown })?.limit
  const dryRunRaw = (body as { dry_run?: unknown })?.dry_run

  const limit = typeof limitRaw === "number" && Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50
  const dry_run = typeof dryRunRaw === "boolean" ? dryRunRaw : false

  if (!campaignId) {
    return NextResponse.json({ ok: false, error: "Missing campaign_id" }, { status: 400 })
  }

  if (!UUID_REGEX.test(campaignId)) {
    return NextResponse.json({ ok: false, error: "Invalid campaign_id" }, { status: 400 })
  }

  try {
    const supabase = createServiceRoleClient()

    const { data: campaign, error: cErr } = await supabase
      .from("campaigns")
      .select("account_id")
      .eq("id", campaignId)
      .maybeSingle()

    if (cErr) {
      return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 })
    }

    const account_id = campaign?.account_id ? String(campaign.account_id) : null

    if (!account_id) {
      return NextResponse.json({ ok: false, error: "Campaign not found" }, { status: 404 })
    }

    const { data: result, error } = await supabase.functions.invoke("touch-orchestrator-v7", {
      body: { account_id, limit, dry_run },
    })

    if (error) {
      return NextResponse.json(
        { ok: false, invoked: "touch-orchestrator-v7", account_id, campaign_id: campaignId, dry_run, error: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      invoked: "touch-orchestrator-v7",
      account_id,
      campaign_id: campaignId,
      dry_run,
      result,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
