import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabaseServer"
import { getAccountContextOrThrow } from "@/app/api/_lib/getAccountContextOrThrow"

function slugify(s: string) {
  return s
    .toLowerCase()
    .trim()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
}

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await getAccountContextOrThrow(req)
    const body = await req.json().catch(() => ({} as any))

    const name = String(body?.name ?? "").trim()
    const type = String(body?.type ?? "outbound").trim()
    const status = String(body?.status ?? "draft").trim()

    if (!name) return NextResponse.json({ ok: false, error: "name required" }, { status: 400 })

    const supabase = createServiceRoleClient()
    const keyBase = slugify(name) || "campaign"
    const campaignKey = `${keyBase}-${Math.random().toString(16).slice(2, 8)}`

    const { data, error } = await supabase
      .from("campaigns")
      .insert({
        account_id: accountId,
        campaign_key: campaignKey,
        name,
        type,
        status,
      })
      .select("*")
      .single()

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, campaign: data })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 })
  }
}


