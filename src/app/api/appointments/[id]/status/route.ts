import { NextRequest, NextResponse } from "next/server"
import { getAccountContextOrThrow } from "@/app/api/_lib/getAccountContextOrThrow"

type ActionType = "show" | "no_show" | "rescheduled" | "cancelled"

type Body = {
  action?: ActionType
  new_starts_at?: string
}

function mapActionToUpdate(action: ActionType, newStartsAt?: string) {
  switch (action) {
    case "show":
      return { status: "completed", outcome: "show" }
    case "no_show":
      return { status: "no_show", outcome: "no_show" }
    case "cancelled":
      return { status: "cancelled", outcome: "cancelled" }
    case "rescheduled":
      if (!newStartsAt) throw new Error("new_starts_at required")
      return {
        status: "scheduled",
        outcome: "rescheduled",
        starts_at: newStartsAt,
        scheduled_for: newStartsAt,
      }
    default:
      throw new Error("Invalid action")
  }
}

// Next 16: params viene como Promise
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { supabase, accountId } = await getAccountContextOrThrow(req)
    const { id } = await ctx.params

    const body = (await req.json().catch(() => ({}))) as Body

    if (!id) {
      return NextResponse.json({ ok: false, error: "Missing appointment id" }, { status: 400 })
    }
    if (!body?.action) {
      return NextResponse.json({ ok: false, error: "Missing action" }, { status: 400 })
    }

    const patch = mapActionToUpdate(body.action, body.new_starts_at)

    const { data, error } = await supabase
      .from("appointments")
      .update(patch)
      .eq("id", id)
      .eq("account_id", accountId)
      .select(`
        id,
        lead_id,
        account_id,
        starts_at,
        scheduled_for,
        status,
        outcome,
        channel,
        notes,
        created_at
      `)
      .single()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    return NextResponse.json({ ok: true, action: body.action, appointment: data })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Unexpected error" },
      { status: e?.message?.includes("Unauthorized") ? 401 : 500 },
    )
  }
}
