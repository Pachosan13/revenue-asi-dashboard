// app/backend/src/command-os/client.ts
import OpenAI from "openai"
import { getOpenAiEnvDebug, getOpenAiKey } from "@/app/api/_lib/openaiEnv"

export const COMMAND_OS_VERSION = "v1"

export type CommandOsIntent =
  | "system.status"
  | "system.metrics"
  | "system.kill_switch"
  | "enc24.autos_usados.start"
  | "enc24.autos_usados.voice_start"
  | "enc24.autos_usados.autopilot.start"
  | "enc24.autos_usados.autopilot.stop"
  | "enc24.autos_usados.autopilot.status"
  | "enc24.autos_usados.metrics.leads_contacted_today"
  | "enc24.autos_usados.leads.list_today"
  | "touch.simulate"
  | "touch.list"
  | "touch.inspect"
  | "lead.inspect"
  | "lead.inspect.latest"
  | "lead.list.recents"
  | "lead.enroll"
  | "lead.update"
  | "lead.next_action"
  | "campaign.list"
  | "campaign.inspect"
  | "campaign.create"
  | "campaign.toggle"
  | "campaign.toggle.bulk"
  | "campaign.metrics"
  | "program.list"
  | "program.status"
  | "orchestrator.run"
  | "dispatcher.run"
  | "enrichment.run"
  | "appointment.list"
  | "appointment.inspect"

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
- "system.status" - Estado general del sistema
- "system.metrics" - Métricas y KPIs del sistema
- "system.kill_switch" - Ver/controlar kill switch global
- "enc24.autos_usados.start" - Buscar autos usados en Panamá (stage1 collect + enqueue reveal)
- "enc24.autos_usados.voice_start" - Buscar autos usados y preparar llamadas (collect + enqueue + promote + campaña voz + touch_runs)
- "enc24.autos_usados.autopilot.start" - Encender autopilot (cada 5 min, 1–2 leads nuevos, 8am–7pm PTY)
- "enc24.autos_usados.autopilot.stop" - Apagar autopilot
- "enc24.autos_usados.autopilot.status" - Ver estado del autopilot
- "enc24.autos_usados.metrics.leads_contacted_today" - ¿Cuántos leads de Encuentra24 han sido contactados hoy?
- "enc24.autos_usados.leads.list_today" - Listar leads creados hoy (America/Panama) desde Encuentra24.
- "touch.simulate" - Simular touches
- "touch.list" - Listar touch_runs con filtros
- "touch.inspect" - Ver detalle de un touch_run
- "lead.inspect" - Inspeccionar lead por id/email/phone/nombre
- "lead.inspect.latest" - Ver el último lead creado
- "lead.list.recents" - Listar leads recientes
- "lead.enroll" - Enrolar leads en campañas
- "lead.update" - Actualizar campos de un lead
- "lead.next_action" - Ver siguiente acción recomendada para un lead (si existe)
- "campaign.list" - Listar campañas
- "campaign.inspect" - Ver detalle de campaña
- "campaign.create" - Crear nueva campaña
- "campaign.toggle" - Activar/desactivar campaña
- "campaign.toggle.bulk" - Activar/desactivar campañas en lote (requiere confirm=true)
- "campaign.metrics" - Métricas de una campaña
- "program.list" - Listar LeadGen programs (Craigslist, etc)
- "program.status" - Ver status de un LeadGen program específico
- "orchestrator.run" - Ejecutar orchestrator manualmente
- "dispatcher.run" - Ejecutar dispatcher manualmente
- "enrichment.run" - Ejecutar enrichment manualmente
- "appointment.list" - Listar appointments
- "appointment.inspect" - Ver detalle de appointment

REGLA CRÍTICA: "último lead"
- Si el usuario dice: "último lead", "más reciente" + "inspeccionar/ver"
  => intent = "lead.inspect.latest"

REGLAS DE SEGURIDAD
- Acciones masivas o peligrosas deben usar confirm (si aplica) con false por defecto.
- No inventes campos. Usa solo lo que el usuario te dio + context.

REGLA: CRAIGSLIST ≠ CAMPAIGN
- Craigslist es un LeadGen Program, NO una fila en public.campaigns.
- Si el usuario pregunta por Craigslist, usa program.status o program.list (no campaign.list).

CÓMO ELEGIR
- Ver info => lead.inspect, lead.inspect.latest, lead.list.recents, campaign.inspect, campaign.list, campaign.metrics, system.status, system.metrics, touch.list, touch.inspect, appointment.list, appointment.inspect
- Cambiar => lead.update, lead.enroll, campaign.toggle, system.kill_switch
- Cambios masivos => campaign.toggle.bulk (confirm=false por defecto)
- Simular/Ejecutar => touch.simulate, orchestrator.run, dispatcher.run, enrichment.run
- Control => campaign.toggle, system.kill_switch

EJEMPLOS DE USO
- "dame métricas del sistema" => system.metrics
- "vamos a buscar carros usados en panamá" => enc24.autos_usados.start (country: "PA", limit: 2, max_pages: 1)
- "vamos a buscar carros usados en panamá y llamalos" => enc24.autos_usados.voice_start (country: "PA", limit: 2, promote_limit: 2, dispatch_now: false, dry_run: true)
- "enciende el autopilot de encuentra24" => enc24.autos_usados.autopilot.start (interval_minutes: 5, max_new_per_tick: 2, start_hour: 8, end_hour: 19)
- "apaga el autopilot de encuentra24" => enc24.autos_usados.autopilot.stop
- "estado del autopilot de encuentra24" => enc24.autos_usados.autopilot.status
- "leads recientes" => lead.list.recents (limit: 10)
- "inspecciona el lead <uuid>" => lead.inspect { lead_id }
- "busca el lead por teléfono/email/nombre" => lead.inspect { phone/email/contact_name }
- "qué sigue para este lead <uuid>" => lead.next_action { lead_id }
- "mueve el lead <uuid> a qualified" => lead.update { lead_id, lead_state: "qualified" }
- "suprime el lead <uuid>" => lead.update { lead_id, suppress: true }
- "reactiva el lead <uuid>" => lead.update { lead_id, suppress: false }
- "lista programas leadgen" => program.list {}
- "qué de craigslist está activo?" => program.status { program: "craigslist" }
- "prende encuentra24" => enc24.autos_usados.autopilot.start
- "apaga encuentra24" => enc24.autos_usados.autopilot.stop
- "status encuentra24" => enc24.autos_usados.autopilot.status
- "¿cuántos leads ha contactado hoy de encuentra24?" => enc24.autos_usados.metrics.leads_contacted_today
- "dame los leads de hoy de encuentra24" => enc24.autos_usados.leads.list_today
- "muéstrame la campaña X" => campaign.inspect (campaign_name: "X")
- "activa la campaña Y" => campaign.toggle (campaign_name: "Y", is_active: true)
- "ejecuta el orchestrator de touch" => orchestrator.run (orchestrator: "touch")
- "lista los últimos 20 touches" => touch.list (limit: 20)
- "muéstrame appointments de hoy" => appointment.list (status: "scheduled")

FIN >>>
` as const

// ✅ CAMBIO CLAVE: OpenAI "lazy" (no se instancia en import-time)
// Esto evita que next build reviente al "collect page data"
let _openai: OpenAI | null = null
let _openaiEnvLogged = false

function logOpenAiEnvOnceDevOnly() {
  if (_openaiEnvLogged) return
  _openaiEnvLogged = true
  if (process.env.NODE_ENV === "production") return

  // Never log full secrets.
  console.log("OPENAI_ENV", getOpenAiEnvDebug())
}

function getOpenAI(): OpenAI {
  if (_openai) return _openai

  logOpenAiEnvOnceDevOnly()
  const { key } = getOpenAiKey()
  if (!key) {
    throw new Error("Missing credentials. Please set OPENAI_API_KEY (or OPEN_AI_KEY / OPEN_API_KEY) environment variable.")
  }

  _openai = new OpenAI({ apiKey: key })
  return _openai
}

function norm(value: string): string {
  return (value ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
}

/**
 * Parser determinístico para comandos ultra-frecuentes.
 * Objetivo: que "prende/apaga/status encuentra24" funcione incluso si el LLM falla.
 */
function tryRuleBasedCommandOs(input: { message: string; context?: any }): CommandOsResponse | null {
  const raw = input.message ?? ""
  const m = norm(raw)

  // system.status (DB-only via router; no LLM required)
  const isSystemStatus =
    m === "system.status" ||
    m === "system status" ||
    m === "status del sistema" ||
    m === "estado del sistema" ||
    (m.includes("status") && m.includes("sistema")) ||
    (m.includes("estado") && m.includes("sistema"))

  if (isSystemStatus) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "system.status",
      args: {},
      explanation: "rule_based_match: system.status",
      confidence: 1,
    }
  }

  // “que campañas estan prendidas ahora?” => campaign.list { status:"active" }
  const isCampaignsPrendidasAhora =
    (m.includes("campan") || m.includes("campaign")) &&
    (m.includes("prendid") || m.includes("activa") || m.includes("activas") || m.includes("encend"))

  if (isCampaignsPrendidasAhora) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "campaign.list",
      args: { status: "active", limit: 50, query_text: raw },
      explanation: "rule_based_match: campaign.list active",
      confidence: 1,
    }
  }

  // LeadGen programs
  const mentionsCraigslist = m.includes("craigslist")
  const wantsPrograms =
    (m.includes("programa") || m.includes("programas") || m.includes("leadgen")) &&
    (m.includes("lista") || m.includes("listame") || m.includes("muestrame") || m.includes("muéstrame"))

  if (wantsPrograms) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "program.list",
      args: {},
      explanation: "rule_based_match: program.list",
      confidence: 1,
    }
  }

  const wantsCraigslistStatus =
    mentionsCraigslist &&
    (m.includes("activo") || m.includes("activa") || m.includes("prendid") || m.includes("status") || m.includes("estado"))

  if (wantsCraigslistStatus) {
    const city = m.includes("miami") ? "miami" : undefined
    return {
      version: COMMAND_OS_VERSION,
      intent: "program.status",
      args: { program: "craigslist", ...(city ? { city } : null) },
      explanation: "rule_based_match: program.status craigslist",
      confidence: 1,
    }
  }

  // “pausa todas” => campaign.toggle.bulk (confirm=false by default)
  const isPauseAll =
    (m.includes("pausa") || m.includes("pausar") || m.includes("pause")) &&
    (m.includes("todas") || m.includes("todo") || m.includes("all"))

  if (isPauseAll) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "campaign.toggle.bulk",
      args: { apply_to: "is_active_true", set_active: false, confirm: false },
      explanation: "rule_based_match: campaign.toggle.bulk pause all running (confirm required)",
      confidence: 1,
    }
  }

  // “confirmado todo” / “confirmo” => campaign.toggle.bulk confirm=true (same defaults)
  const isConfirmAll =
    (m.includes("confirmado") || m.includes("confirmo") || m.includes("confirmar") || m === "confirmado todo") &&
    (m.includes("todo") || m.includes("todas") || m.includes("all"))

  if (isConfirmAll) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "campaign.toggle.bulk",
      args: { apply_to: "is_active_true", set_active: false, confirm: true },
      explanation: "rule_based_match: campaign.toggle.bulk confirm pause all running",
      confidence: 1,
    }
  }

  // must mention enc24/encuentra24 for these shortcuts
  const mentionsEnc24 =
    m.includes("encuentra24") ||
    m.includes("enc 24") ||
    m.includes("enc24") ||
    m.includes("enc-24")

  if (!mentionsEnc24) return null

  const isStart =
    m === "prende encuentra24" ||
    m === "prende enc24" ||
    m === "prende enc 24" ||
    m.startsWith("prende encuentra24 ") ||
    m.startsWith("enciende encuentra24") ||
    m.includes("autopilot") && (m.includes("prende") || m.includes("enciende") || m.includes("activar") || m.includes("activa"))

  const isStop =
    m === "apaga encuentra24" ||
    m === "apaga enc24" ||
    m === "apaga enc 24" ||
    m.startsWith("apaga encuentra24 ") ||
    m.startsWith("apaga el encuentra24") ||
    m.includes("autopilot") && (m.includes("apaga") || m.includes("desactivar") || m.includes("desactiva"))

  const isStatus =
    m === "status encuentra24" ||
    m === "estado encuentra24" ||
    m === "status enc24" ||
    m === "estado enc24" ||
    m.includes("status") ||
    (m.includes("estado") && m.includes("encuentra24")) ||
    (m.includes("como va") && m.includes("encuentra24"))

  // metric
  const isMetric =
    (m.includes("cuantos") || m.includes("cuantas") || m.includes("count") || m.includes("numero")) &&
    m.includes("lead") &&
    (m.includes("hoy") || m.includes("today")) &&
    (m.includes("contact") || m.includes("llam") || m.includes("touch"))

  if (isMetric) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "enc24.autos_usados.metrics.leads_contacted_today",
      args: {},
      explanation: "rule_based_match: enc24 leads_contacted_today",
      confidence: 1,
    }
  }

  const wantsList =
    (m.includes("dame") || m.includes("lista") || m.includes("listame") || m.includes("muestrame") || m.includes("muéstrame") || m.includes("enumera") || m.includes("ensename") || m.includes("enséñame")) &&
    m.includes("lead") &&
    (m.includes("hoy") || m.includes("today")) &&
    !m.includes("contact") &&
    !m.includes("touch") &&
    !m.includes("llam")

  if (wantsList) {
    const nMatch = m.match(/\b(\d{1,3})\b/)
    const n = nMatch ? Number(nMatch[1]) : NaN
    const limit = Number.isFinite(n) ? Math.max(1, Math.min(n, 50)) : 10
    return {
      version: COMMAND_OS_VERSION,
      intent: "enc24.autos_usados.leads.list_today",
      args: { limit },
      explanation: "rule_based_match: enc24 list leads today",
      confidence: 1,
    }
  }

  if (isStart && !isStop) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "enc24.autos_usados.autopilot.start",
      args: {},
      explanation: "rule_based_match: enc24 autopilot start",
      confidence: 1,
    }
  }

  if (isStop) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "enc24.autos_usados.autopilot.stop",
      args: {},
      explanation: "rule_based_match: enc24 autopilot stop",
      confidence: 1,
    }
  }

  if (isStatus) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "enc24.autos_usados.autopilot.status",
      args: {},
      explanation: "rule_based_match: enc24 autopilot status",
      confidence: 1,
    }
  }

  return null
}

/**
 * Craigslist V0 shortcuts (deterministic)
 * - "prende craigslist miami fl" => craigslist.cto.start { city: "Miami, FL" }
 * - "apaga craigslist miami fl" => craigslist.cto.stop { city: "Miami, FL" }
 *
 * City parsing is best-effort (no external geo mapping). If missing, router should return an error.
 */
function tryRuleBasedCraigslist(input: { message: string; context?: any }): CommandOsResponse | null {
  const raw = input.message ?? ""
  const m = norm(raw)

  if (!m.includes("craigslist")) return null

  const isStop =
    m === "apaga craigslist" ||
    m.startsWith("apaga craigslist ") ||
    m.startsWith("apaga el craigslist") ||
    m.startsWith("deten craigslist") ||
    ((m.includes("apaga") || m.includes("deten") || m.includes("para")) && m.includes("craigslist"))

  const isStart =
    m === "prende craigslist" ||
    m.startsWith("prende craigslist ") ||
    m.startsWith("enciende craigslist") ||
    (m.includes("prende") || m.includes("enciende")) && m.includes("craigslist")

  if (!isStart && !isStop) return null

  const confirm =
    m.includes("apagar-y-recrear") ? "apagar-y-recrear" : m.includes("crear") ? "crear" : m.includes("dejar") ? "dejar" : null
  const override = m.includes("override") || m.includes("forzar")

  // Best-effort city extraction: everything after "craigslist" (preserve raw casing).
  // UNRESOLVED: full US geo normalization (city->site mapping) is not in repo; caller may pass args.site explicitly.
  const rawAfter = raw.toLowerCase().includes("craigslist")
    ? raw.split(/craigslist/i)[1] ?? ""
    : ""
  const cityRaw = rawAfter.replace(/^(\\s+en\\s+)?/i, "").trim()
  const city = cityRaw ? cityRaw.replace(/\s+/g, " ").trim() : null

  return {
    version: COMMAND_OS_VERSION,
    intent: isStop ? "craigslist.cto.stop" : "craigslist.cto.start",
    args: {
      ...(city ? { city } : {}),
      ...(confirm ? { confirm } : {}),
      ...(override ? { override: true } : {}),
    },
    explanation: isStop ? "rule_based_match: craigslist stop" : "rule_based_match: craigslist start",
    confidence: 1,
  }
}

export async function callCommandOs(input: {
  message: string
  context?: any
}): Promise<CommandOsResponse> {
  const ruleBased = tryRuleBasedCommandOs(input) ?? tryRuleBasedCraigslist(input)
  if (ruleBased) {
    // auto-inject account_id desde context si existe
    const ctxAccountId =
      typeof input?.context?.account_id === "string" ? input.context.account_id.trim() : ""
    if (ctxAccountId) {
      ruleBased.args = ruleBased.args ?? {}
      if (!ruleBased.args.account_id) ruleBased.args.account_id = ctxAccountId
    }
    return ruleBased
  }

  // If OpenAI is missing/misconfigured, keep Command OS usable.
  const { key } = getOpenAiKey()
  if (!key) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "system.status",
      args: {},
      explanation: "fallback_no_openai_key",
      confidence: 1,
    }
  }

  const openai = getOpenAI()

  let completion: any
  try {
    completion = await openai.chat.completions.create({
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
  } catch (e: any) {
    return {
      version: COMMAND_OS_VERSION,
      intent: "system.status",
      args: {},
      explanation: `fallback_openai_error:${String(e?.message ?? "unknown")}`,
      confidence: 1,
    }
  }

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
