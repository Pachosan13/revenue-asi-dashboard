import { NextResponse } from "next/server"
import { getDirectorOverview } from "@/lib/director"

export async function GET() {
  try {
    const { campaigns, evaluations } = await getDirectorOverview()
    return NextResponse.json({ ok: true, campaigns, evaluations })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error"
    return NextResponse.json({ ok: false, error: message }, { status: 500 })
  }
}
