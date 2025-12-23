import { NextResponse } from "next/server"

export async function POST(req: Request) {
  try {
    const body = await req.json()

    // ✅ Placeholder: reemplazar con tu engine
    return NextResponse.json({
      ok: true,
      source: "manual",
      lead_id: "TEMP-LEAD-ID",
      body,
    })
  } catch {
    return NextResponse.json({ error: "Manual intake failed" }, { status: 500 })
  }
}
