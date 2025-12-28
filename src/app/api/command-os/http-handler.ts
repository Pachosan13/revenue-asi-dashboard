// src/app/api/command-os/http-handler.ts
// Stub neutro para Command OS en entornos fuera de Next.
// No se usa en el runtime de Next.js, pero así dejamos feliz a TypeScript.

export type CommandOsResponse = {
  ok: boolean
  intent: string
  explanation?: string
  confidence?: number
  version?: string
  result?: {
    ok: boolean
    intent: string
    args: Record<string, unknown>
    data: Record<string, unknown>
  }
}

/**
 * Handler genérico "dummy" para evitar errores de build.
 * Si algún día quieres usar Command OS vía Express u otro framework,
 * aquí se cablea de verdad.
 */
export async function commandOsHttpHandler(
  _body: unknown,
): Promise<CommandOsResponse> {
  return {
    ok: false,
    intent: "system.status",
    explanation: "Command OS HTTP handler stub (not wired)",
    confidence: 0,
    version: "v1",
    result: {
      ok: false,
      intent: "system.status",
      args: {},
      data: {
        message: "Command OS backend is not wired yet",
      },
    },
  }
}
