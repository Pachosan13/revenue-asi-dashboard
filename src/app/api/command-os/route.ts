import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { callCommandOs } from "@/app/backend/src/command-os/client"
import { handleCommandOsIntent } from "@/app/backend/src/command-os/router"
import { getAccountContext } from "@/app/api/_lib/getAccountId"

export const dynamic = "force-dynamic"

type CommandOsBody = {
  message: string
  context?: Record<string, any>
}

function getOpenAIClient() {
  const key = process.env.OPENAI_API_KEY ?? process.env.OPEN_API_KEY
  if (!key) return null
  return new OpenAI({ apiKey: key })
}

function safeStr(v: any, fallback = "") {
  if (v === null || v === undefined) return fallback
  const s = String(v).trim()
  return s || fallback
}

function safeNum(v: any, fallback = 0) {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

/** Fallback deterministic (si OpenAI #2 falla o no hay API key) */
function fallbackAssistantMessage(execution: any) {
  if (!execution || typeof execution !== "object") return "No hubo respuesta del sistema."

  if (execution.ok === false) {
    const err =
      safeStr(execution?.data?.error) ||
      safeStr(execution?.data?.message) ||
      safeStr(execution?.error) ||
      "Falló la ejecución."
    return `No pude completar eso. Motivo: ${err}`
  }

  const intent = safeStr(execution.intent, "system.status")
  const data = execution.data ?? execution.result ?? {}

  if (intent === "lead.list.recents") {
    const rows = Array.isArray(data?.leads) ? data.leads : []
    if (!rows.length) return "No encontré leads recientes."
    const lines = rows.slice(0, 10).map((l: any, i: number) => {
      const name = safeStr(
        l?.contact_name || l?.lead_name || l?.name || l?.email,
        "Sin nombre",
      )
      const state = safeStr(l?.state || l?.status || l?.lead_state, "—")
      const score = safeNum(l?.priority_score ?? l?.lead_brain_score ?? l?.score, NaN)
      const scoreTxt = Number.isFinite(score) ? ` • score ${score}` : ""
      return `${i + 1}) ${name} • ${state}${scoreTxt}`
    })
    return `Leads recientes:\n${lines.join("\n")}\n\nDime: “inspecciona el #1”.`
  }

  if (intent === "system.status") {
    const checks = Array.isArray(data?.checks) ? data.checks : []
    if (!checks.length) return "Sistema OK. (sin checks detallados)"
    const lines = checks.slice(0, 12).map((c: any) => {
      const st = safeStr(c?.status, "unknown").toUpperCase()
      const nm = safeStr(c?.name, "check")
      const msg = safeStr(c?.message, "")
      return `- ${st} ${nm}${msg ? ` — ${msg}` : ""}`
    })
    return `Estado del sistema:\n${lines.join("\n")}`
  }

  const explicit = safeStr(data?.message, "")
  if (explicit) return explicit

  return `Hecho. (${intent})`
}

/** OpenAI #2: convierte execution/data en respuesta humana (chat) */
async function llmAssistantMessage(input: {
  userMessage: string
  intent: string
  args: any
  execution: any
}) {
  const openai = getOpenAIClient()
  if (!openai) return "" // sin key => fuerza fallback deterministic

  const completion = await openai.chat.completions.create({
    model: "gpt-5.1",
    temperature: 0.2,
    messages: [
      {
        role: "system",
        content: [
          "Eres Revenue ASI Command OS.",
          "Tu tarea: responder al usuario en español, directo y útil, usando SOLO la data en execution.",
          "NO inventes nada. Si falta data, dilo y pide el dato mínimo necesario.",
          "Formato: texto corto + bullets cuando aplique. Máximo 12 líneas.",
          "Si intent = lead.list.recents: lista los top 10 con estado/bucket y score si existe.",
          "Si intent = lead.inspect/latest: resume lead (nombre, email, phone, estado, recomendado).",
          "Si intent = system.status: lista checks principales con OK/WARN/FAIL.",
          "Si hay error: explica causa + siguiente acción concreta.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(input) },
    ],
  })

  return completion.choices[0]?.message?.content?.trim() || ""
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as CommandOsBody | null
    const message = body?.message?.toString?.().trim?.() ?? ""
    if (!message) {
      return NextResponse.json(
        { ok: false, error: "message is required" },
        { status: 400 },
      )
    }

    // ✅ server-derived tenant context (session + account_members)
    const { accountId, userId, role } = await getAccountContext(req)
    const context = {
      ...(body?.context ?? {}),
      account_id: accountId,
      user_id: userId,
      user_role: role,
    }

    // 1) OpenAI #1 → intent + args (JSON)
    const command = await callCommandOs({ message, context })

    // 2) Router → ejecución real (DB, etc)
    const execution = await handleCommandOsIntent(command)

    // 3) OpenAI #2 → respuesta humana para el chat (si hay key)
    let assistant_message = ""
    try {
      assistant_message = await llmAssistantMessage({
        userMessage: message,
        intent: command?.intent ?? execution?.intent ?? "system.status",
        args: command?.args ?? {},
        execution,
      })
    } catch {
      assistant_message = ""
    }

    if (!assistant_message) assistant_message = fallbackAssistantMessage(execution)

    return NextResponse.json({
      ok: Boolean(execution?.ok),
      version: command?.version ?? "v1",
      intent: command?.intent ?? execution?.intent ?? "system.status",
      explanation: command?.explanation ?? "",
      confidence: typeof command?.confidence === "number" ? command.confidence : 0,
      assistant_message,
      artifacts: execution, // drawer/debug
    })
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error"
    const status = msg.includes("Unauthorized") ? 401 : 500
    const artifacts = {
      ok: false,
      intent: "system.status",
      args: {},
      data: { error: msg },
    }
    return NextResponse.json(
      {
        ok: false,
        version: "v1",
        intent: "system.status",
        explanation: "",
        confidence: 0,
        assistant_message: `No pude ejecutar el comando. Motivo: ${msg}`,
        artifacts,
        error: msg,
      },
      { status },
    )
  }
}
