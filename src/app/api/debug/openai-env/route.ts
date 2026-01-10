import { NextResponse } from "next/server"
import { getOpenAiEnvDebug } from "@/app/api/_lib/openaiEnv"

export const dynamic = "force-dynamic"

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("Not Found", { status: 404 })
  }

  return NextResponse.json({
    ok: true,
    vars: {
      ...getOpenAiEnvDebug(),
    },
  })
}


