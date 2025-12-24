// app/backend/src/command-os/client.ts
import OpenAI from "openai"

export const COMMAND_OS_VERSION = "v1"

export type CommandOsIntent =
  | "system.status"
  | "touch.simulate"
  | "lead.inspect"
  | "lead.inspect.latest"
  | "lead.list.recents"
  | "lead.enroll"
  | "lead.update"
  | "campaign.list"
  | "campaign.inspect"
  | "campaign.create"

export interface CommandOsResponse {
  version: string
  intent: CommandOsIntent
  args: Record<string, any>
  explanation: string
  confidence: number // 0–1
}

// Prompt v1 (alineado a lo que el router soporta HOY)
const COMMAND_OS_PROMPT_V1 = `
<<< REVENUE ASI — COMMAND OS (v1)
Eres la capa de control conversacional de Revenue ASI.

TU TRABAJO
- Traduces lenguaje humano a un intent + args.
- NO ejecutas código. NO haces SQL. NO inventas IDs.

MULTI-TENANT (OBLIGATORIO)
- Si context.account_id existe, SIEMPRE inclúyelo en args como "account_id".
- Si el usuario pide acciones que tocan leads/campaigns y NO hay account_id en context,
  igual elige el intent correcto, pero en args deja "account_id": null y en explanation exige account_id.

CONTRATO DE SALIDA (OBLIGATORIO)
Responde SOLO con un JSON válido (sin texto fuera):

{
  "version": "v1",
  "intent": "<string>",
  "args": { },
  "explanation": "<string>",
  "confidence": 0.0
}

INTENTS SOPORTADOS EN ESTE BUILD
- "system.status"
- "touch.simulate"
- "lead.inspect"
- "lead.inspect.latest"
- "lead.list.recents"
- "lead.enroll"
- "lead.update"
- "campaign.list"
- "campaign.inspect"
- "campaign.create"

REGLA CRÍTICA: "último lead"
- Si el usuario dice: "último lead", "más reciente" + "inspeccionar/ver"
  => intent = "lead.inspect.latest"

REGLAS DE SEGURIDAD
- Acciones masivas o peligrosas deben usar confirm (si aplica) con false por defecto.
- No inventes campos. Usa solo lo que el usuario te dio + context.

CÓMO ELEGIR
- Ver info => lead.inspect, lead.inspect.latest, lead.list.recents, campaign.inspect, campaign.list, system.status
- Cambiar => lead.update, lead.enroll
- Simular => touch.simulate

FIN >>>
` as const

// ✅ CAMBIO CLAVE: OpenAI "lazy" (no se instancia en import-time)
// Esto evita que next build reviente al "collect page data"
let _openai: OpenAI | null = null
function getOpenAI(): OpenAI {
  if (_openai) return _openai

  const key = process.env.OPENAI_API_KEY
  if (!key) {
    throw new Error("Missing credentials. Please set OPENAI_API_KEY environment variable.")
  }

  _openai = new OpenAI({ apiKey: key })
  return _openai
}

export async function callCommandOs(input: {
  message: string
  context?: any
}): Promise<CommandOsResponse> {
  const openai = getOpenAI()

  const completion = await openai.chat.completions.create({
    model: "gpt-5.1",
    messages: [
      {
        role: "system",
        content:
          COMMAND_OS_PROMPT_V1 +
          `

A partir de ahora SIEMPRE responde SOLO con un JSON válido con esta forma exacta:
{
  "version": "v1",
  "intent": "<string>",
  "args": { },
  "explanation": "<string>",
  "confidence": 0.0
}
No escribas nada fuera de ese JSON.
`,
      },
      { role: "user", content: JSON.stringify(input) },
    ],
  })

  const raw = completion.choices[0].message?.content?.trim() || "{}"

  let parsed: CommandOsResponse
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    console.error("Command OS devolvió JSON inválido:", raw)
    throw new Error("Command OS JSON parse error")
  }

  if (!parsed.version) parsed.version = COMMAND_OS_VERSION

  // auto-inject account_id desde context si el modelo no lo puso
  const ctxAccountId =
    typeof input?.context?.account_id === "string" ? input.context.account_id.trim() : ""
  if (ctxAccountId) {
    parsed.args = parsed.args ?? {}
    if (!parsed.args.account_id) parsed.args.account_id = ctxAccountId
  }

  return parsed
}
