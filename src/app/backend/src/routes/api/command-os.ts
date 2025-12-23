// app/backend/src/routes/api/command-os.ts
import { callCommandOs } from "../../command-os/client"
import { handleCommandOsIntent } from "../../command-os/router"
import type { CommandOsResponse } from "../../command-os/client"

export interface CommandOsHttpBody {
  message: string
  context?: any
}

export interface CommandOsHttpResult {
  ok: boolean
  intent: string
  explanation: string
  confidence: number
  version: string
  result: {
    ok: boolean
    intent: string
    args: Record<string, any>
    data?: any
  }
}

export async function commandOsHttpHandler(
  body: CommandOsHttpBody,
): Promise<CommandOsHttpResult> {
  const { message, context } = body

  // 1) LLM → intent + args
  const cmd: CommandOsResponse = await callCommandOs({ message, context })

  // 2) Router → ejecuta intent contra Revenue ASI
  const execResult = await handleCommandOsIntent(cmd)

  // 3) Respuesta estándar
  return {
    ok: execResult.ok,
    intent: cmd.intent,
    explanation: cmd.explanation,
    confidence: cmd.confidence,
    version: cmd.version,
    result: execResult,
  }
}
