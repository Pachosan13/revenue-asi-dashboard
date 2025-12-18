import { NextResponse } from "next/server"
import { handleWebhookIntake } from "@/app/backend/src/command-os/intake-webhook"

export async function POST(req: Request) {
  try {
    const payload = await req.json()
    const result = await handleWebhookIntake(payload)
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Webhook intake failed" },
      { status: 500 },
    )
  }
}
