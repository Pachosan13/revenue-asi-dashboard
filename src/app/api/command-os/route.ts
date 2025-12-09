// src/app/api/command-os/route.ts
import { NextRequest, NextResponse } from "next/server"

export const dynamic = "force-dynamic"

// Tipo mínimo para no romper nada
type CommandOsResponse = {
  ok: boolean
  intent: string
  explanation: string
  confidence: number
  version: string
  result: {
    ok: boolean
    intent: string
    args: Record<string, unknown>
    data: Record<string, unknown>
  }
}

// Stub interno por ahora (hasta tener el backend real)
async function handleCommandOsIntent(_body: {
  message: string
  context?: unknown
}): Promise<CommandOsResponse> {
  return {
    ok: false,
    intent: "system.status",
    explanation: "Command OS backend is not wired yet",
    confidence: 0,
    version: "v1",
    result: {
      ok: false,
      intent: "system.status",
      args: {},
      data: {
        message: "Command OS router not implemented yet",
      },
    },
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      message: string
      context?: unknown
    }

    const resData = await handleCommandOsIntent(body)
    return NextResponse.json(resData)
  } catch (e) {
    console.error("command-os POST error", e)

    const fallback: CommandOsResponse = {
      ok: false,
      intent: "system.status",
      explanation: "Command OS endpoint failed",
      confidence: 0,
      version: "v1",
      result: {
        ok: false,
        intent: "system.status",
        args: {},
        data: {
          message: "Command OS error",
        },
      },
    }

    return NextResponse.json(fallback, { status: 500 })
  }
}
