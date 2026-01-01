import { NextRequest, NextResponse } from "next/server"
import { createServiceRoleClient } from "@/lib/supabaseServer"
import { getAccountContextOrThrow } from "@/app/api/_lib/getAccountContextOrThrow"

async function callSupabaseFunction(path: string, body: any) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

  const res = await fetch(`${url}/functions/v1/${path}`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  })

  const text = await res.text().catch(() => "")
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text }
  }
  return { ok: res.ok, status: res.status, json }
}

export async function POST(req: NextRequest) {
  try {
    const { accountId } = await getAccountContextOrThrow(req)
    const body = await req.json().catch(() => ({} as any))

    const campaignId = String(body?.campaign_id ?? "").trim()
    const dryRun = Boolean(body?.dry_run ?? false)

    if (!campaignId) return NextResponse.json({ ok: false, error: "campaign_id required" }, { status: 400 })

    // Ensure campaign belongs to account (basic guard)
    const supabase = createServiceRoleClient()
    const { data: c, error: cErr } = await supabase
      .from("campaigns")
      .select("id")
      .eq("id", campaignId)
      .eq("account_id", accountId)
      .maybeSingle()

    if (cErr) return NextResponse.json({ ok: false, error: cErr.message }, { status: 500 })
    if (!c?.id) return NextResponse.json({ ok: false, error: "campaign not found" }, { status: 404 })

    // 1) Orchestrate due touches -> touch_runs
    const orch = await callSupabaseFunction("touch-orchestrator-v7", {
      account_id: accountId,
      limit: 200,
      dry_run: dryRun,
    })

    if (!orch.ok || orch.json?.ok !== true) {
      return NextResponse.json(
        { ok: false, error: "touch-orchestrator-v7 failed", details: orch.json, status: orch.status },
        { status: 500 },
      )
    }

    // 2) Dispatch voice touches (will no-op if none eligible)
    const dispatch = await callSupabaseFunction("dispatch-touch-voice-v5", {
      account_id: accountId,
      limit: 50,
      dry_run: dryRun,
    })

    if (!dispatch.ok || dispatch.json?.ok !== true) {
      return NextResponse.json(
        { ok: false, error: "dispatch-touch-voice-v5 failed", details: dispatch.json, status: dispatch.status },
        { status: 500 },
      )
    }

    return NextResponse.json({
      ok: true,
      version: "v1",
      selected: Number(orch.json?.processed_leads ?? 0),
      inserted: Number(orch.json?.inserted ?? 0),
      dry_run: dryRun,
      errors: [...(orch.json?.errors ?? []), ...(dispatch.json?.errors ?? [])],
      orchestrator: orch.json,
      dispatcher: dispatch.json,
    })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 })
  }
}


