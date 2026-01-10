import { NextRequest, NextResponse } from "next/server"
import OpenAI from "openai"
import { callCommandOs } from "@/app/backend/src/command-os/client"
import { handleCommandOsIntent } from "@/app/backend/src/command-os/router"
import { getAccountContext } from "@/app/api/_lib/getAccountId"
import { getOpenAiEnvDebug, getOpenAiKey } from "@/app/api/_lib/openaiEnv"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

type CommandOsBody = {
  message: string
  context?: Record<string, any>
}

// Minimal in-memory cache to support "inspecciona #3" after "leads recientes".
// Keyed by accountId (multi-tenant scoped). TTL-based. No secrets stored.
const _recentLeadIdsByAccount = new Map<string, { ts: number; lead_ids: string[] }>()

let _openaiEnvLogged = false

function logOpenAiEnvOnceDevOnly() {
  if (_openaiEnvLogged) return
  _openaiEnvLogged = true
  if (process.env.NODE_ENV === "production") return

  // Never log full secrets.
  console.log("OPENAI_ENV", getOpenAiEnvDebug())
}

function getOpenAIClient() {
  logOpenAiEnvOnceDevOnly()
  const { key } = getOpenAiKey()
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

  if (intent === "campaign.list") {
    const running = Array.isArray(data?.campaigns_running) ? data.campaigns_running : []
    const legacy = Array.isArray(data?.campaigns_status_active) ? data.campaigns_status_active : []
    const rows = running.length ? running : legacy
    if (!rows.length) return "No encontré campañas running en esta cuenta."
    const lines = rows.slice(0, 15).map((c: any, i: number) => {
      const name = safeStr(c?.name, "Untitled")
      const id = safeStr(c?.id, "")
      const st = Boolean(c?.is_active) ? "running" : safeStr(c?.status, "paused")
      return `${i + 1}) ${name}${id ? ` • ${id}` : ""} • ${st}`
    })
    return `Campañas running (is_active=true):\n${lines.join("\n")}\n\nTip: “pausa todas” para detenerlas.`
  }

  if (intent === "campaign.toggle.bulk") {
    const n = safeNum(data?.count_updated, 0)
    const changed = Array.isArray(data?.changed_campaigns) ? data.changed_campaigns : []
    if (!n) return "No cambié campañas. (0 actualizadas)"
    const lines = changed.slice(0, 15).map((c: any, i: number) => {
      const name = safeStr(c?.name, "Untitled")
      const st = Boolean(c?.is_active) ? "running" : "paused"
      return `${i + 1}) ${name} • ${st}`
    })
    return `Listo. Actualicé ${n} campañas.\n${lines.join("\n")}`
  }

  if (intent === "program.list") {
    const rows = Array.isArray(data?.programs) ? data.programs : []
    if (!rows.length) return "No encontré programas LeadGen configurados."
    const lines = rows.slice(0, 10).map((p: any, i: number) => {
      const name = safeStr(p?.name, "Program")
      const key = safeStr(p?.key, "")
      const enabled = Boolean(p?.enabled)
      const tasks = safeNum(p?.last_60m_tasks, NaN)
      const leads = safeNum(p?.last_60m_leads, NaN)
      const stats =
        Number.isFinite(tasks) || Number.isFinite(leads)
          ? ` • 60m: ${Number.isFinite(tasks) ? `${tasks} tasks` : ""}${Number.isFinite(tasks) && Number.isFinite(leads) ? ", " : ""}${Number.isFinite(leads) ? `${leads} leads` : ""}`
          : ""
      return `${i + 1}) ${name}${key ? ` • ${key}` : ""} • ${enabled ? "enabled" : "disabled"}${stats}`
    })
    return `LeadGen programs:\n${lines.join("\n")}\n\nDime: “qué de craigslist está activo?”`
  }

  if (intent === "program.status") {
    const program = safeStr(data?.program, "program")
    if (program === "craigslist") {
      const city = safeStr(data?.city, "—")
      const routing = Boolean(data?.routing_active)
      const health = Boolean(data?.worker_health)
      const tasks60 = safeNum(data?.last_60m_tasks, 0)
      const leads60 = safeNum(data?.last_60m_leads, 0)
      const next = safeStr(data?.next_action, "")
      return `Craigslist (${city}):\n- routing_active: ${routing}\n- worker_health: ${health}\n- last_60m: ${tasks60} tasks, ${leads60} leads\n${next ? `\nNext: ${next}` : ""}`
    }
    const next = safeStr(data?.next_action, "")
    return `Program status (${program}).${next ? ` Next: ${next}` : ""}`
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

  if (intent === "enc24.autos_usados.metrics.leads_contacted_today") {
    const date = safeStr(data?.date, "hoy")
    const contacted = safeNum(data?.contacted_leads, 0)
    const touches = safeNum(data?.touches_total, 0)
    return `Encuentra24 — ${date}:\n- Leads contactados: ${contacted}\n- Touches creados: ${touches}`
  }

  if (intent === "enc24.autos_usados.leads.list_today") {
    const date = safeStr(data?.date, "hoy")
    const rows = Array.isArray(data?.leads) ? data.leads : []
    const total = safeNum(data?.total, rows.length)
    if (!rows.length) return `Encuentra24 — ${date}: no encontré leads creados hoy.`
    const lines = rows.slice(0, 15).map((l: any, i: number) => {
      const name = safeStr(l?.contact_name, "Sin nombre")
      const phone = safeStr(l?.phone, "—")
      const car = safeStr(l?.car, "")
      const price = safeStr(l?.price, "")
      const city = safeStr(l?.city, "")
      const url = safeStr(l?.listing_url, "")
      const bits = [car, price, city].filter(Boolean).join(" • ")
      return `${i + 1}) ${name} • ${phone}${bits ? ` • ${bits}` : ""}${url ? `\n   ${url}` : ""}`
    })
    return `Leads de Encuentra24 — ${date} (total ${total}):\n${lines.join("\n")}`
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
          "Si intent = enc24.autos_usados.leads.list_today: lista los top leads del día con nombre/teléfono + auto (make/model/year/price) + url.",
          "Si intent = lead.inspect/latest: resume lead (nombre, email, phone, estado, next_action si existe).",
          "Si intent = lead.next_action: explica la recomendación usando SOLO next_action/priority_score/delay del execution.",
          "Si intent = campaign.list: usa campaigns_running (is_active=true) como verdad; no uses status como truth.",
          "Si intent = campaign.toggle.bulk: confirma cuántas se cambiaron y su nuevo estado.",
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
    let message = body?.message?.toString?.().trim?.() ?? ""
    if (!message) {
      return NextResponse.json(
        { ok: false, error: "message is required" },
        { status: 400 },
      )
    }

    // ✅ server-derived tenant context (session + account_members)
    const { accountId, userId, role } = await getAccountContext(req)
    const now = Date.now()
    const cached = accountId ? _recentLeadIdsByAccount.get(accountId) : null
    const cachedIds =
      cached && now - cached.ts < 30 * 60 * 1000 && Array.isArray(cached.lead_ids)
        ? cached.lead_ids
        : []

    // If user says "inspecciona #N" and we have a recent list, rewrite message to use the actual lead_id.
    const idxMatch = message.match(/#\s*(\d{1,3})\b/)
    if (idxMatch && cachedIds.length > 0) {
      const n = Number(idxMatch[1])
      const leadId = Number.isFinite(n) && n >= 1 && n <= cachedIds.length ? cachedIds[n - 1] : null
      if (leadId) message = `inspecciona el lead ${leadId}`
    }

    const context = {
      ...(body?.context ?? {}),
      account_id: accountId,
      user_id: userId,
      user_role: role,
      last_lead_ids: cachedIds,
    }

    // 1) OpenAI #1 → intent + args (JSON)
    // If OpenAI is down/misconfigured, allow DB-only fallbacks for critical commands.
    let command: any
    try {
      command = await callCommandOs({ message, context })
    } catch (e: any) {
      const msg = e?.message ?? ""
      const m = message
        .toString()
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")

      const isSystemStatus =
        m === "system.status" ||
        m === "system status" ||
        m === "status del sistema" ||
        m === "estado del sistema" ||
        (m.includes("status") && m.includes("sistema")) ||
        (m.includes("estado") && m.includes("sistema"))

      const isCampaignsPrendidasAhora =
        (m.includes("campan") || m.includes("campaign")) &&
        (m.includes("prendid") || m.includes("activa") || m.includes("activas") || m.includes("encend"))

      if (isSystemStatus || isCampaignsPrendidasAhora) {
        command = {
          version: "v1",
          intent: isSystemStatus ? "system.status" : "campaign.list",
          args: isSystemStatus ? {} : { status: "active", limit: 50 },
          explanation: "fallback_no_openai_parse",
          confidence: 1,
        }
      } else {
        throw new Error(msg || "Command OS parse error")
      }
    }

    // 2) Router → ejecución real (DB, etc)
    const execution = await handleCommandOsIntent(command)

    // Update recent list cache after successful lead.list.recents.
    if (execution?.ok === true && execution?.intent === "lead.list.recents" && accountId) {
      const leads = Array.isArray((execution as any)?.data?.leads) ? (execution as any).data.leads : []
      const leadIds = leads
        .map((l: any) => String(l?.lead_id ?? l?.id ?? "").trim())
        .filter((x: any) => typeof x === "string" && x.length > 0)
      if (leadIds.length > 0) _recentLeadIdsByAccount.set(accountId, { ts: now, lead_ids: leadIds })
    }

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
