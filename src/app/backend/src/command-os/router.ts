// app/backend/src/command-os/router.ts
import { createClient, SupabaseClient } from "@supabase/supabase-js"
import type { CommandOsResponse } from "./client"

export interface CommandOsExecutionResult {
  ok: boolean
  intent: string
  args: Record<string, any>
  data?: any
}

// ---------- SUPABASE ADMIN CLIENT ----------

let supabaseAdmin: SupabaseClient | null = null

function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdmin) return supabaseAdmin

  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!url || !key) {
    throw new Error("Faltan variables de entorno: SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY")
  }

  supabaseAdmin = createClient(url, key, {
    auth: { persistSession: false },
  })

  return supabaseAdmin
}

// ---------- HELPERS DE NORMALIZACIÓN / FUZZY ----------

type LeadRecord = {
  id: string
  contact_name: string | null
  company_name: string | null
  email: string | null
  phone: string | null
  state: string | null
  status: string | null
  score: number | null
  enriched?: any
  account_id?: string | null
  lead_state?: string | null
  [key: string]: any
}

function norm(value: string | null | undefined): string {
  if (!value) return ""
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
}

function similarityScore(query: string, candidate: string): number {
  const q = norm(query)
  const c = norm(candidate)
  if (!q || !c) return 0

  if (q === c) return 1
  if (c.includes(q)) return 0.85
  if (q.includes(c)) return 0.8

  const qParts = q.split(/\s+/)
  const cParts = c.split(/\s+/)

  let hits = 0
  for (const qp of qParts) {
    if (!qp) continue
    if (cParts.some((cp) => cp === qp)) hits += 1
  }

  if (!hits) return 0
  const ratio = hits / qParts.length
  return 0.5 * ratio
}

function bestLeadForQuery(query: string, leads: LeadRecord[]): { lead: LeadRecord; score: number } {
  let bestScore = -1
  let bestLead = leads[0]

  for (const lead of leads) {
    const fields: string[] = []

    if (lead.contact_name) fields.push(lead.contact_name)
    if (lead.company_name) fields.push(lead.company_name)
    if (lead.email) fields.push(lead.email)
    if (lead.phone) fields.push(lead.phone)
    if (lead.enriched?.contact_name) fields.push(lead.enriched.contact_name)
    if (lead.enriched?.company_name) fields.push(lead.enriched.company_name)

    let localBest = 0
    for (const f of fields) {
      const s = similarityScore(query, f)
      if (s > localBest) localBest = s
    }

    const state = norm((lead.state || lead.status) ?? "")
    if (state.includes("enriched") || state.includes("engaged")) {
      localBest += 0.05
    }

    if (localBest > bestScore) {
      bestScore = localBest
      bestLead = lead
    }
  }

  return { lead: bestLead, score: bestScore }
}

// ---------- MULTI-TENANT GUARD ----------

function requireAccountId(args: Record<string, any>, intent: string): string {
  const accountId = typeof args.account_id === "string" ? args.account_id.trim() : ""
  if (!accountId) {
    throw new Error(`Missing account_id (required for ${intent}). Provide context.account_id.`)
  }
  return accountId
}

// ---------- RESOLVER ULTRA PARA LEADS (SCOPED) ----------

async function resolveLeadFromArgs(
  args: {
    account_id: string
    lead_id?: string
    email?: string
    phone?: string
    contact_name?: string
    lead_reference?: string
    name?: string
  },
): Promise<LeadRecord> {
  const supabase = getSupabaseAdmin()

  const accountId = args.account_id
  const leadId = args.lead_id
  const email = args.email
  const phone = args.phone
  const contactName = args.contact_name
  const leadReference = args.lead_reference || args.name

  // 1) UUID directo
  if (leadId) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("account_id", accountId)
      .eq("id", leadId)
      .maybeSingle()

    if (error) throw new Error(`Error buscando lead por id: ${error.message}`)
    if (!data) throw new Error("No se encontró ningún lead con ese id en esta cuenta.")
    return data as LeadRecord
  }

  // 2) Email
  if (email) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("account_id", accountId)
      .ilike("email", email.trim())
      .limit(10)

    if (error) throw new Error(`Error buscando lead por email: ${error.message}`)
    if (!data || data.length === 0) throw new Error("No se encontró ningún lead con ese email.")
    if (data.length === 1) return data[0] as LeadRecord

    const { lead } = bestLeadForQuery(email, data as LeadRecord[])
    return lead
  }

  // 3) Phone (incluye enriched.normalized_phone)
  if (phone) {
    const cleanPhone = phone.replace(/[^\d+]/g, "")
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("account_id", accountId)
      .or(`phone.eq.${cleanPhone},phone.ilike.%${cleanPhone}%,enriched->>normalized_phone.eq.${cleanPhone}`)
      .limit(10)

    if (error) throw new Error(`Error buscando lead por teléfono: ${error.message}`)
    if (!data || data.length === 0) throw new Error("No se encontró ningún lead con ese teléfono.")
    if (data.length === 1) return data[0] as LeadRecord

    const { lead } = bestLeadForQuery(cleanPhone, data as LeadRecord[])
    return lead
  }

  // 4) Nombre / referencia libre
  const nameQuery = contactName || leadReference
  if (nameQuery) {
    const like = `%${nameQuery.trim()}%`

    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("account_id", accountId)
      .or(
        [
          `contact_name.ilike.${like}`,
          `company_name.ilike.${like}`,
          `email.ilike.${like}`,
          `enriched->>contact_name.ilike.${like}`,
          `enriched->>company_name.ilike.${like}`,
        ].join(","),
      )
      .limit(20)

    if (error) throw new Error(`Error buscando lead por nombre o referencia: ${error.message}`)
    if (!data || data.length === 0) {
      throw new Error("No encontré ningún lead que se parezca a ese nombre. Intenta con email o teléfono.")
    }

    const { lead, score } = bestLeadForQuery(nameQuery, data as LeadRecord[])

    if (score < 0.35 && data.length > 1) {
      throw new Error("Encontré varios leads parecidos, pero ninguno con suficiente certeza. Especifica email o teléfono.")
    }

    return lead
  }

  throw new Error("lead.inspect requiere al menos uno de: lead_id, email, phone, contact_name o algún identificador de referencia.")
}

/**
 * Resolver lista de lead_ids para lead.enroll.
 */
async function resolveLeadIdsForEnroll(args: {
  account_id: string
  lead_ids?: string[]
  email?: string
  phone?: string
  contact_name?: string
  lead_reference?: string
  name?: string
}): Promise<string[]> {
  if (Array.isArray(args.lead_ids) && args.lead_ids.length > 0) return args.lead_ids

  const lead = await resolveLeadFromArgs({
    account_id: args.account_id,
    email: args.email,
    phone: args.phone,
    contact_name: args.contact_name,
    lead_reference: args.lead_reference,
    name: args.name,
  })

  return [lead.id]
}

// ---------- CAMPAÑAS / ENROL ----------

async function resolveCampaignByName(accountId: string, name: string) {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .eq("account_id", accountId)
    .ilike("name", `%${name}%`)
    .limit(2)

  if (error) throw new Error(`Error resolviendo campaña: ${error.message}`)
  if (!data || data.length === 0) throw new Error("No se encontró ninguna campaña con ese nombre.")
  if (data.length > 1) throw new Error("Hay varias campañas que matchean ese nombre. Afina el criterio.")
  return data[0]
}

/**
 * Enrolar leads a campañas vía RPC api_enroll_leads.
 * Nota: esta RPC debe validar account_id internamente (RLS o lógica).
 */
async function enrollLeadsToCampaign(args: {
  campaign_id?: string | null
  campaign_name?: string | null
  lead_ids: string[]
  source?: string
}): Promise<{ enrolled: string[]; campaign_id?: string; campaign_name?: string }> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase.rpc("api_enroll_leads", {
    p_campaign_id: args.campaign_id ?? null,
    p_campaign_name: args.campaign_name ?? null,
    p_lead_ids: args.lead_ids,
    p_source: args.source ?? "command_os",
  })

  if (error) throw new Error(`Error enrolling leads: ${error.message}`)

  return {
    enrolled: (data?.enrolled as string[]) ?? [],
    campaign_id: data?.campaign_id as string | undefined,
    campaign_name: data?.campaign_name as string | undefined,
  }
}

// ---------- UPDATE LEADS / LIST LEADS ----------

const ALLOWED_LEAD_UPDATE_FIELDS = [
  "status",
  "state",
  "score",
  "lead_brain_score",
  "lead_brain_bucket",
  "notes",
  "last_touched_at",
  "last_channel",
] as const

type AllowedLeadUpdateField = (typeof ALLOWED_LEAD_UPDATE_FIELDS)[number]

async function updateLead(args: {
  account_id: string
  lead_id: string
  updates: Record<string, any>
}): Promise<any> {
  const supabase = getSupabaseAdmin()

  const safeUpdates: Record<string, any> = {}
  for (const key of Object.keys(args.updates)) {
    if (ALLOWED_LEAD_UPDATE_FIELDS.includes(key as AllowedLeadUpdateField)) {
      safeUpdates[key] = args.updates[key]
    }
  }

  if (Object.keys(safeUpdates).length === 0) {
    throw new Error("No hay campos válidos para actualizar. Campos permitidos: " + ALLOWED_LEAD_UPDATE_FIELDS.join(", "))
  }

  const { data, error } = await supabase
    .from("leads")
    .update(safeUpdates)
    .eq("account_id", args.account_id)
    .eq("id", args.lead_id)
    .select("*")
    .single()

  if (error) throw new Error(`Error updating lead ${args.lead_id}: ${error.message}`)
  return data
}

/**
 * Listar leads recientes con filtros simples.
 */
async function listRecentLeads(args: {
  account_id: string
  limit?: number
  status?: string
  state?: string
}): Promise<{ leads: any[] }> {
  const supabase = getSupabaseAdmin()
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100)

  let query = supabase
    .from("leads")
    .select("*")
    .eq("account_id", args.account_id)
    .order("created_at", { ascending: false })

  if (args.status) query = query.eq("status", args.status)
  if (args.state) query = query.eq("state", args.state)

  const { data, error } = await query.limit(limit)
  if (error) throw new Error(`Error listing recent leads: ${error.message}`)

  return { leads: data ?? [] }
}

/**
 * Inspect latest lead (most recent by created_at)
 */
async function inspectLatestLead(args: { account_id: string }): Promise<{ lead: any }> {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("account_id", args.account_id)
    .order("created_at", { ascending: false })
    .limit(1)

  if (error) throw new Error(`Error buscando último lead: ${error.message}`)
  const lead = data?.[0]
  if (!lead) throw new Error("No hay leads recientes en esta cuenta.")
  return { lead }
}

// ---------- CAMPAÑAS: LIST / INSPECT (LECTURA REAL, CREATE STUB) ----------

async function listCampaigns(args: { account_id: string; limit?: number; status?: string }): Promise<{ campaigns: any[] }> {
  const supabase = getSupabaseAdmin()
  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100)

  let query = supabase
    .from("campaigns")
    .select("*")
    .eq("account_id", args.account_id)
    .order("created_at", { ascending: false })

  if (args.status) query = query.eq("status", args.status)

  const { data, error } = await query.limit(limit)
  if (error) throw new Error(`Error listando campañas: ${error.message}`)

  return { campaigns: data ?? [] }
}

async function inspectCampaign(args: { account_id: string; campaign_id?: string; campaign_name?: string }) {
  const supabase = getSupabaseAdmin()

  if (args.campaign_id) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("account_id", args.account_id)
      .eq("id", args.campaign_id)
      .maybeSingle()

    if (error) throw new Error(`Error buscando campaña por id: ${error.message}`)
    if (!data) throw new Error("No se encontró campaña con ese id en esta cuenta.")
    return data
  }

  if (args.campaign_name) {
    return resolveCampaignByName(args.account_id, args.campaign_name)
  }

  throw new Error("campaign.inspect requiere campaign_id o campaign_name.")
}

async function createCampaignStub(args: { name: string; channel?: string; objective?: string; notes?: string }) {
  return {
    message: "campaign.create (stub): aquí deberíamos crear la campaña real en la tabla campaigns / Campaign Engine.",
    suggested_payload: {
      name: args.name,
      channel: args.channel ?? "multi",
      objective: args.objective ?? "appointments",
      notes: args.notes ?? null,
    },
  }
}

// ---------- INTENTS & TYPEGUARDS ----------

type KnownIntent =
  | "system.status"
  | "system.metrics"
  | "system.kill_switch"
  | "craigslist.cto.start"
  | "craigslist.cto.stop"
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
  | "lead.enroll"
  | "lead.update"
  | "lead.list.recents"
  | "campaign.list"
  | "campaign.inspect"
  | "campaign.create"
  | "campaign.toggle"
  | "campaign.metrics"
  | "orchestrator.run"
  | "dispatcher.run"
  | "enrichment.run"
  | "appointment.list"
  | "appointment.inspect"

interface LeadInspectArgs {
  account_id?: string
  lead_id?: string
  email?: string
  phone?: string
  contact_name?: string
  lead_reference?: string
  name?: string
}

interface LeadEnrollArgs {
  account_id?: string
  campaign_id?: string
  campaign_name?: string
  lead_ids?: string[]
  email?: string
  phone?: string
  contact_name?: string
  lead_reference?: string
  name?: string
  source?: string
  confirm?: boolean
}

interface LeadUpdateArgs {
  account_id?: string
  lead_id: string
  updates: Record<string, any>
}

interface LeadListRecentsArgs {
  account_id?: string
  limit?: number
  status?: string
  state?: string
}

interface CampaignListArgs {
  account_id?: string
  limit?: number
  status?: string
}

interface CampaignInspectArgs {
  account_id?: string
  campaign_id?: string
  campaign_name?: string
}

interface CampaignCreateArgs {
  account_id?: string
  name: string
  channel?: string
  objective?: string
  notes?: string
}

function isLeadInspectArgs(args: Record<string, any>): args is LeadInspectArgs {
  const hasSelector =
    (typeof args.lead_id === "string" && args.lead_id.length > 0) ||
    (typeof args.email === "string" && args.email.length > 0) ||
    (typeof args.phone === "string" && args.phone.length > 0) ||
    (typeof args.contact_name === "string" && args.contact_name.length > 0) ||
    (typeof args.lead_reference === "string" && args.lead_reference.length > 0) ||
    (typeof args.name === "string" && args.name.length > 0)

  return hasSelector
}

function isLeadEnrollArgs(args: Record<string, any>): args is LeadEnrollArgs {
  const hasLeadIds =
    Array.isArray(args.lead_ids) &&
    args.lead_ids.length > 0 &&
    args.lead_ids.every((id: any) => typeof id === "string")

  const hasSelector =
    (typeof args.email === "string" && args.email.length > 0) ||
    (typeof args.phone === "string" && args.phone.length > 0) ||
    (typeof args.contact_name === "string" && args.contact_name.length > 0) ||
    (typeof args.lead_reference === "string" && args.lead_reference.length > 0) ||
    (typeof args.name === "string" && args.name.length > 0)

  return hasLeadIds || hasSelector
}

function isLeadUpdateArgs(args: Record<string, any>): args is LeadUpdateArgs {
  return typeof args.lead_id === "string" && args.lead_id.length > 0 && args.updates && typeof args.updates === "object"
}

function isLeadListRecentsArgs(args: Record<string, any>): args is LeadListRecentsArgs {
  if (args.limit !== undefined && typeof args.limit !== "number") return false
  if (args.status !== undefined && typeof args.status !== "string") return false
  if (args.state !== undefined && typeof args.state !== "string") return false
  return true
}

function isCampaignListArgs(args: Record<string, any>): args is CampaignListArgs {
  if (args.limit !== undefined && typeof args.limit !== "number") return false
  if (args.status !== undefined && typeof args.status !== "string") return false
  return true
}

function isCampaignInspectArgs(args: Record<string, any>): args is CampaignInspectArgs {
  return (
    (typeof args.campaign_id === "string" && args.campaign_id.length > 0) ||
    (typeof args.campaign_name === "string" && args.campaign_name.length > 0)
  )
}

function isCampaignCreateArgs(args: Record<string, any>): args is CampaignCreateArgs {
  return typeof args.name === "string" && args.name.length > 0
}

// ---------- ROUTER PRINCIPAL COMMAND OS ----------

export async function handleCommandOsIntent(cmd: CommandOsResponse): Promise<CommandOsExecutionResult> {
  const intent = cmd.intent as KnownIntent
  const args = (cmd.args ?? {}) as Record<string, any>

  const panamaNow = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Panama",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date())
    const hh = Number(parts.find((p) => p.type === "hour")?.value ?? "0")
    const mm = Number(parts.find((p) => p.type === "minute")?.value ?? "0")
    return { hh, mm }
  }

  // Panamá no tiene DST: offset fijo UTC-5. Esto simplifica "hoy" con precisión.
  const panamaTodayUtcRange = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Panama",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date())
    const yyyy = Number(parts.find((p) => p.type === "year")?.value ?? "1970")
    const mm = Number(parts.find((p) => p.type === "month")?.value ?? "01")
    const dd = Number(parts.find((p) => p.type === "day")?.value ?? "01")

    // midnight PTY == 05:00:00Z
    const start = new Date(Date.UTC(yyyy, mm - 1, dd, 5, 0, 0, 0))
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000)
    const date = `${String(yyyy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`
    return { startIso: start.toISOString(), endIso: end.toISOString(), date, tz: "America/Panama" as const }
  }

  try {
    switch (intent) {
      case "enc24.autos_usados.autopilot.start": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()
        const country = typeof args.country === "string" && args.country.trim() ? args.country.trim().toUpperCase() : "PA"
        const intervalMinutes = Math.min(Math.max(Number(args.interval_minutes ?? 5), 1), 60)
        const maxNew = Math.min(Math.max(Number(args.max_new_per_tick ?? 2), 1), 5)
        const startHour = Math.min(Math.max(Number(args.start_hour ?? 8), 0), 23)
        const endHour = Math.min(Math.max(Number(args.end_hour ?? 19), 0), 23)

        const { error } = await supabase
          .schema("lead_hunter")
          .from("enc24_autopilot_settings")
          .upsert(
            {
              account_id: accountId,
              enabled: true,
              country,
              interval_minutes: intervalMinutes,
              max_new_per_tick: maxNew,
              start_hour: startHour,
              end_hour: endHour,
              updated_at: new Date().toISOString(),
            } as any,
            { onConflict: "account_id" },
          )

        if (error) {
          return { ok: false, intent, args, data: { error: "autopilot.start failed", details: error.message } }
        }

        return {
          ok: true,
          intent,
          args: { account_id: accountId, country, intervalMinutes, maxNew, startHour, endHour },
          data: { enabled: true, note: "Autopilot enabled. Run the daemon worker to execute ticks." },
        }
      }

      case "enc24.autos_usados.autopilot.stop": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()
        const { error } = await supabase
          .schema("lead_hunter")
          .from("enc24_autopilot_settings")
          .upsert({ account_id: accountId, enabled: false, updated_at: new Date().toISOString() } as any, { onConflict: "account_id" })
        if (error) return { ok: false, intent, args, data: { error: "autopilot.stop failed", details: error.message } }
        return { ok: true, intent, args: { account_id: accountId }, data: { enabled: false } }
      }

      case "enc24.autos_usados.autopilot.status": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()
        const { data, error } = await supabase
          .schema("lead_hunter")
          .from("enc24_autopilot_settings")
          .select("*")
          .eq("account_id", accountId)
          .maybeSingle()
        if (error) return { ok: false, intent, args, data: { error: "autopilot.status failed", details: error.message } }
        return { ok: true, intent, args: { account_id: accountId }, data: { settings: data ?? { account_id: accountId, enabled: false } } }
      }

      case "enc24.autos_usados.metrics.leads_contacted_today": {
        /**
         * Definición (por ahora, sin Twilio):
         * - "contactado hoy" = lead con `enriched.source = 'encuentra24'` que tenga >=1 touch_run creado hoy (PTY)
         * - Incluye estados: queued/scheduled/executing/sent/failed. Excluye canceled.
         */
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()
        const { startIso, endIso, date, tz } = panamaTodayUtcRange()

        // 1) Touches del día (por cuenta)
        const { data: touches, error: tErr } = await supabase
          .from("touch_runs")
          .select("lead_id,status,created_at")
          .eq("account_id", accountId)
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .neq("status", "canceled")
          .limit(5000)

        if (tErr) {
          return { ok: false, intent, args, data: { error: "metric query failed (touch_runs)", details: tErr.message } }
        }

        const touchRows = (touches ?? []).filter((r: any) => typeof r?.lead_id === "string" && r.lead_id.length > 0)
        const leadIds = Array.from(new Set(touchRows.map((r: any) => r.lead_id)))

        if (leadIds.length === 0) {
          return {
            ok: true,
            intent,
            args: { account_id: accountId },
            data: {
              date,
              tz,
              contacted_leads: 0,
              touches_total: 0,
              note: "No hay touch_runs hoy para esta cuenta.",
            },
          }
        }

        // 2) Leads fuente Encuentra24 (por lead_ids del día)
        const { data: leads, error: lErr } = await supabase
          .from("leads")
          .select("id,enriched")
          .eq("account_id", accountId)
          .in("id", leadIds)

        if (lErr) {
          return { ok: false, intent, args, data: { error: "metric query failed (leads)", details: lErr.message } }
        }

        const encLeadIds = new Set<string>()
        for (const r of leads ?? []) {
          const src = String((r as any)?.enriched?.source ?? "").trim().toLowerCase()
          if (src === "encuentra24") encLeadIds.add(String((r as any).id))
        }

        // 3) Distinct leads contactados + breakdown por status (touches, no leads)
        const contactedDistinct = new Set<string>()
        const touchesByStatus: Record<string, number> = {}
        let touchesTotal = 0

        for (const tr of touchRows) {
          const leadId = String(tr.lead_id)
          if (!encLeadIds.has(leadId)) continue
          contactedDistinct.add(leadId)
          const st = String(tr.status ?? "unknown")
          touchesByStatus[st] = (touchesByStatus[st] ?? 0) + 1
          touchesTotal += 1
        }

        return {
          ok: true,
          intent,
          args: { account_id: accountId },
          data: {
            date,
            tz,
            contacted_leads: contactedDistinct.size,
            touches_total: touchesTotal,
            touches_by_status: touchesByStatus,
            definition:
              "contactado_hoy = lead(enriched.source='encuentra24') con >=1 touch_run creado hoy (America/Panama), excluyendo status=canceled.",
            window_utc: { start: startIso, end: endIso },
          },
        }
      }

      case "enc24.autos_usados.leads.list_today": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()
        const { startIso, endIso, date, tz } = panamaTodayUtcRange()

        const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 50)

        const { data, error, count } = await supabase
          .from("leads")
          .select("id,created_at,phone,contact_name,enriched", { count: "exact" })
          .eq("account_id", accountId)
          .eq("enriched->>source", "encuentra24")
          .gte("created_at", startIso)
          .lt("created_at", endIso)
          .order("created_at", { ascending: false })
          .limit(limit)

        if (error) {
          return { ok: false, intent, args, data: { error: "enc24 leads.list_today failed", details: error.message } }
        }

        const leads = (data ?? []).map((r: any) => {
          const enc24 = r?.enriched?.enc24 ?? {}
          const stage1 = enc24?.raw?.stage1 ?? {}
          const make = String(stage1?.make ?? "").trim()
          const model = String(stage1?.model ?? "").trim()
          const year = Number(stage1?.year)
          const price = Number(stage1?.price)
          const city = String(stage1?.city ?? "").trim()
          const car = [make, model, Number.isFinite(year) ? String(year) : ""].filter(Boolean).join(" ")
          const priceTxt = Number.isFinite(price) && price > 0 ? `$${price}` : ""

          return {
            id: String(r.id),
            created_at: r.created_at,
            phone: r.phone ?? null,
            contact_name: r.contact_name ?? null,
            listing_url: enc24?.listing_url ?? null,
            car: car || null,
            price: priceTxt || null,
            city: city || null,
          }
        })

        return {
          ok: true,
          intent,
          args: { account_id: accountId, limit },
          data: {
            date,
            tz,
            window_utc: { start: startIso, end: endIso },
            total: typeof count === "number" ? count : leads.length,
            leads,
          },
        }
      }

      case "craigslist.cto.start": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()

        const city = typeof args.city === "string" ? args.city.trim() : ""
        const site = typeof args.site === "string" ? args.site.trim().toLowerCase() : ""

        if (!city) {
          return { ok: false, intent, args, data: { error: "city required (example: 'Miami, FL')" } }
        }

        const { data: taskId, error: enqErr } = await supabase
          .schema("lead_hunter")
          .rpc("enqueue_craigslist_discover_v1", { p_account_id: accountId, p_city: city })

        if (enqErr) {
          return { ok: false, intent, args, data: { error: "enqueue_craigslist_discover_v1 failed", details: enqErr.message } }
        }

        // SSV (Supply Velocity) via view (UTC day boundaries). Timezone mapping per city is UNRESOLVED in repo.
        const { data: ssv, error: ssvErr } = await supabase
          .from("v_craigslist_ssv_v0")
          .select("city,listings_today,avg_last_7_days")
          .eq("city", city)
          .maybeSingle()

        return {
          ok: true,
          intent,
          args: { account_id: accountId, city, site: site || null },
          data: {
            enqueued_task_id: taskId ?? null,
            ssv: ssvErr ? { error: ssvErr.message } : (ssv ?? null),
            note: ssv ? null : "SSV empty until worker inserts leads.",
          },
        }
      }

      case "craigslist.cto.stop": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()

        const city = typeof args.city === "string" ? args.city.trim() : ""
        if (!city) {
          return { ok: false, intent, args, data: { error: "city required (example: 'Miami, FL')" } }
        }

        // "Stop" = fail any queued tasks for this city/account so the worker stops consuming new work.
        const { data: stopped, error: stopErr } = await supabase
          .schema("lead_hunter")
          .from("craigslist_tasks_v1")
          .update({ status: "failed", last_error: "stopped_by_user", updated_at: new Date().toISOString() })
          .eq("account_id", accountId)
          .eq("city", city)
          .eq("status", "queued")
          .select("id")

        if (stopErr) {
          return { ok: false, intent, args, data: { error: "Failed to stop queued tasks", details: stopErr.message } }
        }

        return {
          ok: true,
          intent,
          args: { account_id: accountId, city },
          data: {
            stopped_queued_tasks: (stopped ?? []).length,
            note: "Stop sets queued tasks to failed; claimed tasks continue until worker finishes them.",
          },
        }
      }

      case "enc24.autos_usados.start": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()

        const country = typeof args.country === "string" && args.country.trim() ? args.country.trim().toUpperCase() : "PA"
        // Soft defaults: collect only 1–2 new listings per run to reduce anti-bot triggers.
        const limit = Math.min(Math.max(Number(args.limit ?? 2), 1), 500)
        const maxPages = Math.min(Math.max(Number(args.max_pages ?? args.maxPages ?? 1), 1), 5)
        const minYear = Math.min(Math.max(Number(args.min_year ?? args.minYear ?? 2014), 1990), 2035)
        const enqueueLimit = Math.min(Math.max(Number(args.enqueue_limit ?? limit), 1), 5000)
        const businessHoursOnly = args.business_hours_only !== false
        const startHour = Math.min(Math.max(Number(args.start_hour ?? 8), 0), 23)
        const endHour = Math.min(Math.max(Number(args.end_hour ?? 19), 0), 23)

        if (country !== "PA") {
          return {
            ok: false,
            intent,
            args: { ...args, country },
            data: { error: "Por ahora solo soportamos Panamá (country=PA) para Encuentra24 autos usados." },
          }
        }

        if (businessHoursOnly) {
          const { hh } = panamaNow()
          if (!(hh >= startHour && hh < endHour)) {
            return {
              ok: true,
              intent,
              args: { account_id: accountId, country, limit, maxPages, minYear, enqueueLimit, businessHoursOnly, startHour, endHour },
              data: { skipped: true, reason: "outside_business_hours", tz: "America/Panama", hour: hh },
            }
          }
        }

        // 1) Collect Stage1 listings into lead_hunter.enc24_listings (Edge Function)
        const url = process.env.SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) {
          return { ok: false, intent, args, data: { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" } }
        }

        const collectRes = await fetch(`${url}/functions/v1/enc24-collect-stage1`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            account_id: accountId,
            country,
            limit,
            maxPages,
            minYear,
            businessHoursOnly,
            startHour,
            endHour,
          }),
        })

        const collectText = await collectRes.text().catch(() => "")
        let collectJson: any = null
        try { collectJson = collectText ? JSON.parse(collectText) : null } catch { collectJson = { raw: collectText } }

        if (!collectRes.ok || !collectJson?.ok) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error: "enc24-collect-stage1 failed",
              status: collectRes.status,
              result: collectJson,
            },
          }
        }

        // 2) Enqueue reveal tasks from enc24_listings (DB RPC)
        const { data: enq, error: enqErr } = await supabase
          .schema("lead_hunter")
          .rpc("enqueue_enc24_reveal_tasks", { p_limit: enqueueLimit })

        if (enqErr) {
          return { ok: false, intent, args, data: { error: "enqueue_enc24_reveal_tasks failed", details: enqErr.message } }
        }

        return {
          ok: true,
          intent,
          args: { account_id: accountId, country, limit, maxPages, minYear, enqueueLimit, businessHoursOnly, startHour, endHour },
          data: {
            collected: collectJson,
            enqueued: enq,
            note:
              "La cola quedó preparada. Para producción necesitas el reveal worker corriendo (CDP Chrome real) para consumir lead_hunter.enc24_reveal_tasks.",
          },
        }
      }

      case "enc24.autos_usados.voice_start": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()

        const country = typeof args.country === "string" && args.country.trim() ? args.country.trim().toUpperCase() : "PA"
        const limit = Math.min(Math.max(Number(args.limit ?? 2), 1), 500)
        const maxPages = Math.min(Math.max(Number(args.max_pages ?? args.maxPages ?? 1), 1), 5)
        const minYear = Math.min(Math.max(Number(args.min_year ?? args.minYear ?? 2014), 1990), 2035)
        const enqueueLimit = Math.min(Math.max(Number(args.enqueue_limit ?? limit), 1), 5000)
        const promoteLimit = Math.min(Math.max(Number(args.promote_limit ?? limit), 1), 500)
        const dispatchNow = Boolean(args.dispatch_now ?? false)
        const dryRun = Boolean(args.dry_run ?? true)
        const businessHoursOnly = args.business_hours_only !== false
        const startHour = Math.min(Math.max(Number(args.start_hour ?? 8), 0), 23)
        const endHour = Math.min(Math.max(Number(args.end_hour ?? 19), 0), 23)

        if (country !== "PA") {
          return {
            ok: false,
            intent,
            args: { ...args, country },
            data: { error: "Por ahora solo soportamos Panamá (country=PA) para Encuentra24 autos usados." },
          }
        }

        if (businessHoursOnly) {
          const { hh } = panamaNow()
          if (!(hh >= startHour && hh < endHour)) {
            return {
              ok: true,
              intent,
              args: { account_id: accountId, country, limit, maxPages, minYear, enqueueLimit, promoteLimit, dispatchNow, dryRun, businessHoursOnly, startHour, endHour },
              data: { skipped: true, reason: "outside_business_hours", tz: "America/Panama", hour: hh },
            }
          }
        }

        const url = process.env.SUPABASE_URL
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY
        if (!url || !key) {
          return { ok: false, intent, args, data: { error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" } }
        }

        // 1) Collect stage1
        const collectRes = await fetch(`${url}/functions/v1/enc24-collect-stage1`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            account_id: accountId,
            country,
            limit,
            maxPages,
            minYear,
            businessHoursOnly,
            startHour,
            endHour,
          }),
        })

        const collectText = await collectRes.text().catch(() => "")
        let collectJson: any = null
        try {
          collectJson = collectText ? JSON.parse(collectText) : null
        } catch {
          collectJson = { raw: collectText }
        }

        if (!collectRes.ok || !collectJson?.ok) {
          return {
            ok: false,
            intent,
            args,
            data: { error: "enc24-collect-stage1 failed", status: collectRes.status, result: collectJson },
          }
        }

        // 2) Enqueue reveal tasks
        const { data: enq, error: enqErr } = await supabase
          .schema("lead_hunter")
          .rpc("enqueue_enc24_reveal_tasks", { p_limit: enqueueLimit })

        if (enqErr) {
          return { ok: false, intent, args, data: { error: "enqueue_enc24_reveal_tasks failed", details: enqErr.message } }
        }

        // 3) Promote revealed phones -> public.leads (idempotent by account+phone)
        const { data: encRows, error: encErr } = await supabase
          .schema("lead_hunter")
          .from("enc24_listings")
          .select("id, account_id, listing_url, seller_name, phone_e164, raw, first_seen_at, last_seen_at")
          .eq("account_id", accountId)
          .not("phone_e164", "is", null)
          .order("last_seen_at", { ascending: false })
          .limit(promoteLimit)

        if (encErr) {
          return { ok: false, intent, args, data: { error: "read enc24_listings failed", details: encErr.message } }
        }

        const phones = Array.from(new Set((encRows ?? []).map((r: any) => String(r.phone_e164 ?? "").trim()).filter(Boolean)))
        let existingPhones = new Set<string>()
        if (phones.length) {
          const { data: existing, error: exErr } = await supabase
            .from("leads")
            .select("phone")
            .eq("account_id", accountId)
            .in("phone", phones)
          if (!exErr && existing) existingPhones = new Set(existing.map((r: any) => String(r.phone ?? "").trim()).filter(Boolean))
        }

        const toInsert = (encRows ?? [])
          .filter((r: any) => {
            const p = String(r.phone_e164 ?? "").trim()
            return p && !existingPhones.has(p)
          })
          .map((r: any) => ({
            account_id: accountId,
            phone: String(r.phone_e164).trim(),
            contact_name: r.seller_name ? String(r.seller_name).trim() : null,
            company: null,
            lead_state: "new",
            status: "new",
            enriched: {
              source: "encuentra24",
              listing_url: r.listing_url,
              listing_id: r.id,
              title: r?.raw?.listing_text ?? null,
            },
          }))

        let promoted = 0
        if (toInsert.length) {
          const { error: insErr } = await supabase.from("leads").insert(toInsert)
          if (insErr) {
            return { ok: false, intent, args, data: { error: "promote to public.leads failed", details: insErr.message } }
          }
          promoted = toInsert.length
        }

        // 4) Ensure a VOICE campaign exists + step1
        const campaignKey = "enc24-autos-usados-pa-voice-v1"
        let campaignId: string | null = null
        {
          const { data: c, error: cErr } = await supabase
            .from("campaigns")
            .select("id")
            .eq("account_id", accountId)
            .eq("campaign_key", campaignKey)
            .maybeSingle()

          if (cErr) return { ok: false, intent, args, data: { error: "campaign lookup failed", details: cErr.message } }

          if (c?.id) {
            campaignId = c.id as string
          } else {
            const { data: created, error: crErr } = await supabase
              .from("campaigns")
              .insert({
                account_id: accountId,
                campaign_key: campaignKey,
                name: "Enc24 Autos Usados PA — Voice",
                type: "outbound",
                status: "active",
              })
              .select("id")
              .single()
            if (crErr) return { ok: false, intent, args, data: { error: "campaign create failed", details: crErr.message } }
            campaignId = created.id as string
          }
        }

        // step 1 voice (idempotent)
        {
          const { data: st, error: stErr } = await supabase
            .from("campaign_steps")
            .select("id")
            .eq("campaign_id", campaignId!)
            .eq("step", 1)
            .eq("channel", "voice")
            .eq("account_id", accountId)
            .maybeSingle()

          if (stErr) return { ok: false, intent, args, data: { error: "campaign_steps lookup failed", details: stErr.message } }

          if (!st?.id) {
            const { error: insErr } = await supabase.from("campaign_steps").insert({
              account_id: accountId,
              campaign_id: campaignId!,
              step: 1,
              channel: "voice",
              delay_minutes: 0,
              is_active: true,
              payload: {
                delivery: {
                  body:
                    "Hola, ¿hablo con {contact_name}? Te llamo por el carro del anuncio en Encuentra24. Estoy ayudando a Darmesh, que está interesado. ¿Tienes 30 segundos?",
                },
                voice: {
                  mode: "interactive_v1",
                  buyer_name: "Darmesh",
                },
                routing: {
                  advance_on: "call_status",
                  fallback: {
                    order: ["voice", "whatsapp", "sms", "email"],
                    max_attempts: { voice: 3, whatsapp: 2, sms: 0, email: 0 },
                    cooldown_minutes: { voice: 10, whatsapp: 120, sms: 120, email: 1440 },
                  },
                },
              },
            })
            if (insErr) return { ok: false, intent, args, data: { error: "campaign_steps insert failed", details: insErr.message } }
          }
        }

        // step 2 voice (retry 1) + step 3 voice (retry 2) + step 4 whatsapp (fallback)
        // We keep them idempotent and lightweight. Smart-router will create the next step only after the voice status callback.
        const ensureStep = async (step: number, channel: "voice" | "whatsapp", delay_minutes: number, payload: any) => {
          const { data: ex, error: exErr } = await supabase
            .from("campaign_steps")
            .select("id")
            .eq("campaign_id", campaignId!)
            .eq("step", step)
            .eq("channel", channel)
            .eq("account_id", accountId)
            .maybeSingle()
          if (exErr) return { ok: false as const, error: exErr.message }
          if (ex?.id) return { ok: true as const, created: false as const }
          const { error: insErr } = await supabase.from("campaign_steps").insert({
            account_id: accountId,
            campaign_id: campaignId!,
            step,
            channel,
            delay_minutes,
            is_active: true,
            payload,
          })
          if (insErr) return { ok: false as const, error: insErr.message }
          return { ok: true as const, created: true as const }
        }

        // Voice retries: shorter, respectful
        const voiceRetryPayload = (n: number) => ({
          delivery: {
            body:
              n === 1
                ? "Hola, soy parte del equipo de Darmesh. Es rápido: ¿el carro del anuncio sigue disponible? Si te queda mejor, te escribo por WhatsApp."
                : "Hola, última vez que intento. ¿El carro del anuncio sigue disponible? Si prefieres, te escribo por WhatsApp para coordinar.",
          },
          voice: {
            mode: "interactive_v1",
            buyer_name: "Darmesh",
          },
          routing: {
            advance_on: "call_status",
            fallback: {
              order: ["voice", "whatsapp", "sms", "email"],
              max_attempts: { voice: 3, whatsapp: 2, sms: 0, email: 0 },
              cooldown_minutes: { voice: 10, whatsapp: 120, sms: 120, email: 1440 },
            },
          },
        })

        const waPayload = {
          message:
            "Hola, soy parte del equipo de Darmesh. Te escribo por el carro que publicaste en Encuentra24. ¿Sigue disponible? Si quieres, me dices el precio final y en qué zona se puede ver. Gracias.",
          routing: {
            advance_on: "sent",
            fallback: {
              order: ["whatsapp", "sms", "email"],
              max_attempts: { whatsapp: 2, sms: 0, email: 0 },
              cooldown_minutes: { whatsapp: 180, sms: 120, email: 1440 },
            },
          },
        }

        const s2 = await ensureStep(2, "voice", 10, voiceRetryPayload(1))
        if (!s2.ok) return { ok: false, intent, args, data: { error: "campaign_steps step2 failed", details: s2.error } }
        const s3 = await ensureStep(3, "voice", 60, voiceRetryPayload(2))
        if (!s3.ok) return { ok: false, intent, args, data: { error: "campaign_steps step3 failed", details: s3.error } }
        const s4 = await ensureStep(4, "whatsapp", 180, waPayload)
        if (!s4.ok) return { ok: false, intent, args, data: { error: "campaign_steps step4 failed", details: s4.error } }

        // 5) Enroll promoted/existing leads by phone -> campaign_leads
        // Fetch leads by the phones we just saw (both new and existing), then upsert enrollments.
        const phonesToEnroll = phones.slice(0, promoteLimit)
        let enrolled = 0
        if (phonesToEnroll.length) {
          const { data: leads, error: lErr } = await supabase
            .from("leads")
            .select("id, phone")
            .eq("account_id", accountId)
            .in("phone", phonesToEnroll)

          if (lErr) return { ok: false, intent, args, data: { error: "lead lookup for enroll failed", details: lErr.message } }

          const rows = (leads ?? []).map((l: any) => ({
            account_id: accountId,
            campaign_id: campaignId!,
            lead_id: l.id,
            status: "active",
            next_action_at: new Date().toISOString(),
          }))

          if (rows.length) {
            const { error: eErr } = await supabase
              .from("campaign_leads")
              .upsert(rows, { onConflict: "account_id,campaign_id,lead_id", ignoreDuplicates: true })
            if (eErr) return { ok: false, intent, args, data: { error: "campaign_leads upsert failed", details: eErr.message } }
            enrolled = rows.length
          }
        }

        // 6) Orchestrate -> touch_runs (uses service role auth fallback in the function)
        const orchRes = await fetch(`${url}/functions/v1/touch-orchestrator-v7`, {
          method: "POST",
          headers: {
            apikey: key,
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ account_id: accountId, limit: 200, dry_run: dryRun }),
        })
        const orchText = await orchRes.text().catch(() => "")
        let orchJson: any = null
        try { orchJson = orchText ? JSON.parse(orchText) : null } catch { orchJson = { raw: orchText } }

        if (!orchRes.ok || orchJson?.ok !== true) {
          return {
            ok: false,
            intent,
            args,
            data: { error: "touch-orchestrator-v7 failed", status: orchRes.status, result: orchJson },
          }
        }

        // 7) Optionally dispatch voice
        let dispatchJson: any = null
        if (dispatchNow) {
          const dRes = await fetch(`${url}/functions/v1/dispatch-touch-voice-v5`, {
            method: "POST",
            headers: {
              apikey: key,
              Authorization: `Bearer ${key}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ account_id: accountId, limit: 50, dry_run: dryRun }),
          })
          const dText = await dRes.text().catch(() => "")
          try { dispatchJson = dText ? JSON.parse(dText) : null } catch { dispatchJson = { raw: dText } }
          if (!dRes.ok || dispatchJson?.ok !== true) {
            return {
              ok: false,
              intent,
              args,
              data: { error: "dispatch-touch-voice-v5 failed", status: dRes.status, result: dispatchJson },
            }
          }
        }

        return {
          ok: true,
          intent,
          args: { account_id: accountId, country, limit, maxPages, minYear, enqueueLimit, promoteLimit, dispatchNow, dryRun },
          data: {
            collected: collectJson,
            enqueued: enq,
            promoted,
            enrolled,
            campaign_id: campaignId,
            orchestrator: orchJson,
            dispatcher: dispatchJson,
            note:
              "Si dry_run=true no se insertan touch_runs reales / no se dispara Twilio. Para producción: corre el reveal worker y pon dispatch_now=true + configura Twilio env.",
          },
        }
      }

      case "system.status": {
        const checks = [
          {
            name: "command_os_router",
            status: "ok",
            message: "wiring conectado",
          },
          {
            name: "supabase_env",
            status:
              !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
                ? "configured"
                : "missing",
            message: "SUPABASE_URL / SERVICE_ROLE_KEY",
          },
          {
            name: "multi_tenant",
            status: typeof args.account_id === "string" && args.account_id.trim() ? "ok" : "warn",
            message: typeof args.account_id === "string" && args.account_id.trim() ? "account_id presente" : "falta account_id",
          },
        ]

        return { ok: true, intent, args, data: { checks } }
      }

      case "touch.simulate": {
        // touch.simulate se deja como lo tenías (no lo multi-tenantizamos aquí
        // porque está leyendo un view global; si quieres, lo filtramos por account_id luego).
        // Mantengo todo tu bloque tal cual para no romper.
        const supabase = getSupabaseAdmin()

        const dry_run = args.dry_run !== false
        const limit = Math.min(Math.max(Number(args.limit ?? 10), 1), 100)

        const { data: rows, error } = await supabase
          .from("lead_next_action_view_v5")
          .select("lead_id,recommended_channel,recommended_action,recommended_delay_minutes,priority_score,effective_channel,lead_state")
          .order("priority_score", { ascending: false })
          .limit(limit)

        if (error) {
          const { data: rows2, error: error2 } = await supabase
            .from("lead_next_action_view_v5")
            .select("lead_id,recommended_channel,recommended_action,recommended_delay_minutes,priority_score")
            .order("priority_score", { ascending: false })
            .limit(limit)

          if (error2) {
            return { ok: false, intent, args, data: { error: "Failed to read lead_next_action_view_v5", details: error2.message } }
          }

          return await (async () => {
            const leads = rows2 ?? []

            const leadIds = Array.from(
              new Set(
                leads
                  .map((r: any) => r?.lead_id as string | null)
                  .filter((x: any) => typeof x === "string" && x.length > 0),
              ),
            )

            if (leadIds.length === 0) {
              return { ok: true, intent, args, data: { simulated: 0, dry_run, results: [] } }
            }

            const { data: leadRows, error: leadErr } = await supabase
              .from("leads")
              .select("id,account_id,lead_state")
              .in("id", leadIds)

            if (leadErr) {
              return { ok: false, intent, args, data: { error: "Failed to load leads (account_id/lead_state)", details: leadErr.message } }
            }

            const byId = new Map<string, { account_id: string | null; lead_state: string | null }>()
            for (const r of leadRows ?? []) {
              byId.set(r.id, { account_id: r.account_id ?? null, lead_state: (r as any).lead_state ?? null })
            }

            const results: any[] = []

            for (const row of leads) {
              const lead_id = (row as any).lead_id as string | null
              const channel = ((row as any).recommended_channel as string | null)?.toLowerCase() ?? null
              const action = (row as any).recommended_action as string | null
              const delay = Number((row as any).recommended_delay_minutes ?? 0)

              if (!lead_id || !channel) {
                results.push({ lead_id, ok: false, error: "Missing lead_id or channel" })
                continue
              }

              const info = byId.get(lead_id)
              const account_id = info?.account_id ?? null
              const lead_state = (info?.lead_state ?? "").toLowerCase()

              if (lead_state === "dead") {
                results.push({ lead_id, ok: true, skipped: true, reason: "dead=stop" })
                continue
              }

              if (!account_id) {
                results.push({ lead_id, ok: false, error: "No account_id found for lead" })
                continue
              }

              const step = 1
              const step_key = action ?? "send"

              const scheduled_at = dry_run
                ? new Date(Date.now() + delay * 60_000).toISOString()
                : new Date(Date.now() - 30_000).toISOString()

              const payload = {}
              const meta = { source: "touch.simulate", action: step_key, step_key, dry_run, simulated: dry_run }

              // Preferred behavior: in dry_run/simulate, do NOT write to touch_runs at all.
              if (dry_run) {
                results.push({ lead_id, ok: true, skipped: true, reason: "dry_run_no_db_write", account_id, channel, step, step_key, scheduled_at })
                continue
              }

              const { error: trErr } = await supabase.from("touch_runs").insert({
                account_id,
                lead_id,
                step,
                channel,
                payload,
                scheduled_at,
                status: "queued",
                meta,
              })

              if (trErr) results.push({ lead_id, ok: false, error: trErr.message })
              else {
                results.push({ lead_id, ok: true, skipped: false, account_id, channel, step, step_key, scheduled_at, dry_run })
              }
            }

            return { ok: true, intent, args, data: { simulated: results.length, dry_run, results } }
          })()
        }

        const leads = rows ?? []

        const leadIds = Array.from(
          new Set(
            leads
              .map((r: any) => r?.lead_id as string | null)
              .filter((x: any) => typeof x === "string" && x.length > 0),
          ),
        )

        if (leadIds.length === 0) {
          return { ok: true, intent, args, data: { simulated: 0, dry_run, results: [] } }
        }

        const { data: leadRows, error: leadErr } = await supabase
          .from("leads")
          .select("id,account_id,lead_state")
          .in("id", leadIds)

        if (leadErr) {
          return { ok: false, intent, args, data: { error: "Failed to load leads (account_id/lead_state)", details: leadErr.message } }
        }

        const byId = new Map<string, { account_id: string | null; lead_state: string | null }>()
        for (const r of leadRows ?? []) {
          byId.set(r.id, { account_id: r.account_id ?? null, lead_state: (r as any).lead_state ?? null })
        }

        const results: any[] = []

        for (const row of leads) {
          const lead_id = (row as any).lead_id as string | null
          const effective_channel =
            ((row as any).effective_channel as string | null)?.toLowerCase() ??
            ((row as any).recommended_channel as string | null)?.toLowerCase() ??
            null

          const action = (row as any).recommended_action as string | null
          const delay = Number((row as any).recommended_delay_minutes ?? 0)

          if (!lead_id) {
            results.push({ lead_id, ok: false, error: "Missing lead_id" })
            continue
          }

          const info = byId.get(lead_id)
          const account_id = info?.account_id ?? null
          const lead_state_db = (info?.lead_state ?? "").toLowerCase()

          if (lead_state_db === "dead") {
            results.push({ lead_id, ok: true, skipped: true, reason: "dead=stop" })
            continue
          }

          if (!effective_channel) {
            results.push({ lead_id, ok: true, skipped: true, reason: "no_effective_channel" })
            continue
          }

          if (!account_id) {
            results.push({ lead_id, ok: false, error: "No account_id found for lead" })
            continue
          }

          const step = 1
          const step_key = action ?? "send"

          const scheduled_at = dry_run
            ? new Date(Date.now() + delay * 60_000).toISOString()
            : new Date(Date.now() - 30_000).toISOString()

          const payload = {}
          const meta = { source: "touch.simulate", action: step_key, step_key, dry_run, simulated: dry_run }

          // Preferred behavior: in dry_run/simulate, do NOT write to touch_runs at all.
          if (dry_run) {
            results.push({ lead_id, ok: true, skipped: true, reason: "dry_run_no_db_write", account_id, channel: effective_channel, step, step_key, scheduled_at })
            continue
          }

          const { error: trErr } = await supabase.from("touch_runs").insert({
            account_id,
            lead_id,
            step,
            channel: effective_channel,
            payload,
            scheduled_at,
            status: "queued",
            meta,
          })

          if (trErr) results.push({ lead_id, ok: false, error: trErr.message })
          else {
            results.push({ lead_id, ok: true, skipped: false, account_id, channel: effective_channel, step, step_key, scheduled_at, dry_run })
          }
        }

        return { ok: true, intent, args, data: { simulated: results.length, dry_run, results } }
      }

      case "lead.inspect.latest": {
        const accountId = requireAccountId(args, intent)
        const { lead } = await inspectLatestLead({ account_id: accountId })
        return { ok: true, intent, args, data: { lead } }
      }

      case "lead.inspect": {
        if (!isLeadInspectArgs(args)) {
          return { ok: false, intent, args, data: { error: "lead.inspect requiere algún identificador: lead_id, email, phone, contact_name o referencia." } }
        }

        const accountId = requireAccountId(args, intent)

        const lead = await resolveLeadFromArgs({
          account_id: accountId,
          lead_id: args.lead_id,
          email: args.email,
          phone: args.phone,
          contact_name: args.contact_name,
          lead_reference: args.lead_reference,
          name: args.name,
        })

        return { ok: true, intent, args, data: { lead } }
      }

      case "lead.enroll": {
        if (!isLeadEnrollArgs(args)) {
          return { ok: false, intent, args, data: { error: "lead.enroll requiere lead_ids: string[] o un selector (email, phone, contact_name, referencia)." } }
        }

        const accountId = requireAccountId(args, intent)
        const confirm = args.confirm ?? false

        const leadIds = await resolveLeadIdsForEnroll({
          account_id: accountId,
          lead_ids: args.lead_ids,
          email: args.email,
          phone: args.phone,
          contact_name: args.contact_name,
          lead_reference: args.lead_reference,
          name: args.name,
        })

        if (!confirm && leadIds.length > 20) {
          return { ok: false, intent, args: { ...args, lead_ids: leadIds }, data: { error: "Intento de enrolar muchos leads sin confirm=true. Bloqueado por safety." } }
        }

        let campaignId: string | null | undefined = args.campaign_id ?? null
        let campaignName: string | null | undefined = args.campaign_name ?? null

        if (!campaignId && campaignName) {
          const campaign = await resolveCampaignByName(accountId, campaignName)
          campaignId = campaign.id as string
          campaignName = campaign.name as string
        }

        const result = await enrollLeadsToCampaign({
          campaign_id: campaignId,
          campaign_name: campaignName,
          lead_ids: leadIds,
          source: args.source,
        })

        return {
          ok: true,
          intent,
          args: { ...args, lead_ids: leadIds, campaign_id: campaignId, campaign_name: campaignName },
          data: { message: "Lead(s) enrolados vía api_enroll_leads.", result },
        }
      }

      case "lead.update": {
        if (!isLeadUpdateArgs(args)) {
          return { ok: false, intent, args, data: { error: "lead.update requiere lead_id: string y updates: object con campos permitidos." } }
        }

        const accountId = requireAccountId(args, intent)

        const updated = await updateLead({
          account_id: accountId,
          lead_id: args.lead_id,
          updates: args.updates,
        })

        return { ok: true, intent, args, data: { message: "Lead actualizado correctamente.", lead: updated, allowed_fields: ALLOWED_LEAD_UPDATE_FIELDS } }
      }

      case "lead.list.recents": {
        if (!isLeadListRecentsArgs(args)) {
          return { ok: false, intent, args, data: { error: "lead.list.recents acepta limit?: number, status?: string, state?: string." } }
        }

        const accountId = requireAccountId(args, intent)

        const result = await listRecentLeads({
          account_id: accountId,
          limit: args.limit,
          status: args.status,
          state: args.state,
        })

        return { ok: true, intent, args, data: { message: "Leads recientes obtenidos.", leads: result.leads } }
      }

      case "campaign.list": {
        if (!isCampaignListArgs(args)) {
          return { ok: false, intent, args, data: { error: "campaign.list acepta limit?: number, status?: string." } }
        }

        const accountId = requireAccountId(args, intent)

        const result = await listCampaigns({
          account_id: accountId,
          limit: args.limit,
          status: args.status,
        })

        return { ok: true, intent, args, data: { message: "Campañas recientes obtenidas.", campaigns: result.campaigns } }
      }

      case "campaign.inspect": {
        if (!isCampaignInspectArgs(args)) {
          return { ok: false, intent, args, data: { error: "campaign.inspect requiere campaign_id: string o campaign_name: string." } }
        }

        const accountId = requireAccountId(args, intent)

        const campaign = await inspectCampaign({
          account_id: accountId,
          campaign_id: args.campaign_id,
          campaign_name: args.campaign_name,
        })

        return { ok: true, intent, args, data: { message: "Detalle de campaña obtenido.", campaign } }
      }

      case "campaign.create": {
        if (!isCampaignCreateArgs(args)) {
          return { ok: false, intent, args, data: { error: "campaign.create requiere al menos name: string." } }
        }

        // create stub: igual exigimos account_id para que sea consistente (aunque no escriba DB)
        requireAccountId(args, intent)

        const result = await createCampaignStub({
          name: args.name,
          channel: args.channel,
          objective: args.objective,
          notes: args.notes,
        })

        return { ok: true, intent, args, data: result }
      }

      case "campaign.toggle": {
        const accountId = requireAccountId(args, intent)
        const campaignId = args.campaign_id as string | undefined
        const campaignName = args.campaign_name as string | undefined
        const isActive = args.is_active as boolean | undefined

        if (!campaignId && !campaignName) {
          return { ok: false, intent, args, data: { error: "campaign.toggle requiere campaign_id o campaign_name" } }
        }

        if (typeof isActive !== "boolean") {
          return { ok: false, intent, args, data: { error: "campaign.toggle requiere is_active: boolean" } }
        }

        let finalCampaignId = campaignId
        if (!finalCampaignId && campaignName) {
          const campaign = await resolveCampaignByName(accountId, campaignName)
          finalCampaignId = campaign.id as string
        }

        // Runtime contract: campaigns are enabled/disabled via campaigns.status, not campaigns.is_active.
        // Quick check:
        //   rg "from\\(\"campaigns\"\\).*\\.eq\\(\"status\",\\s*\"active\"\\)" -n supabase/functions touch-orchestrator*
        const nextStatus = isActive ? "active" : "paused"

        const supabase = getSupabaseAdmin()
        const { data, error } = await supabase
          .from("campaigns")
          .update({ status: nextStatus })
          .eq("id", finalCampaignId)
          .eq("account_id", accountId)
          .select()
          .single()

        if (error) {
          return { ok: false, intent, args, data: { error: error.message } }
        }

        return { ok: true, intent, args, data: { message: `Campaña ${isActive ? "activada" : "desactivada"}`, campaign: data } }
      }

      case "campaign.metrics": {
        const accountId = requireAccountId(args, intent)
        const campaignId = args.campaign_id as string | undefined
        const campaignName = args.campaign_name as string | undefined

        if (!campaignId && !campaignName) {
          return { ok: false, intent, args, data: { error: "campaign.metrics requiere campaign_id o campaign_name" } }
        }

        let finalCampaignId = campaignId
        if (!finalCampaignId && campaignName) {
          const campaign = await resolveCampaignByName(accountId, campaignName)
          finalCampaignId = campaign.id as string
        }

        const supabase = getSupabaseAdmin()
        const { data, error } = await supabase
          .from("campaign_funnel_overview")
          .select("*")
          .eq("campaign_id", finalCampaignId)
          .maybeSingle()

        if (error) {
          return { ok: false, intent, args, data: { error: error.message } }
        }

        return { ok: true, intent, args, data: { metrics: data } }
      }

      case "system.metrics": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()

        const [dashboardData, funnelData] = await Promise.all([
          supabase.from("lead_state_summary").select("*").eq("account_id", accountId),
          supabase.from("v_touch_funnel_campaign_summary").select("*").eq("account_id", accountId),
        ])

        return {
          ok: true,
          intent,
          args,
          data: {
            lead_states: dashboardData.data ?? [],
            campaign_funnels: funnelData.data ?? [],
          },
        }
      }

      case "system.kill_switch": {
        const supabase = getSupabaseAdmin()
        const action = args.action as "get" | "set" | undefined
        const value = args.value as boolean | undefined

        if (action === "set") {
          if (typeof value !== "boolean") {
            return { ok: false, intent, args, data: { error: "system.kill_switch set requiere value: boolean" } }
          }

          const { error } = await supabase
            .from("system_controls")
            .upsert({ key: "global_kill_switch", value }, { onConflict: "key" })

          if (error) {
            return { ok: false, intent, args, data: { error: error.message } }
          }

          return { ok: true, intent, args, data: { message: `Kill switch ${value ? "activado" : "desactivado"}`, value } }
        }

        // get (default)
        const { data, error } = await supabase
          .from("system_controls")
          .select("value")
          .eq("key", "global_kill_switch")
          .maybeSingle()

        if (error) {
          return { ok: false, intent, args, data: { error: error.message } }
        }

        return { ok: true, intent, args, data: { value: Boolean(data?.value ?? false) } }
      }

      case "touch.list": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()
        const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200)
        const status = args.status as string | undefined
        const channel = args.channel as string | undefined

        let query = supabase
          .from("touch_runs")
          .select("*")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false })
          .limit(limit)

        if (status) query = query.eq("status", status)
        if (channel) query = query.eq("channel", channel)

        const { data, error } = await query

        if (error) {
          return { ok: false, intent, args, data: { error: error.message } }
        }

        return { ok: true, intent, args, data: { touch_runs: data ?? [] } }
      }

      case "touch.inspect": {
        const accountId = requireAccountId(args, intent)
        const touchId = args.touch_id as string | undefined

        if (!touchId) {
          return { ok: false, intent, args, data: { error: "touch.inspect requiere touch_id" } }
        }

        const supabase = getSupabaseAdmin()
        const { data, error } = await supabase
          .from("touch_runs")
          .select("*")
          .eq("id", touchId)
          .eq("account_id", accountId)
          .maybeSingle()

        if (error) {
          return { ok: false, intent, args, data: { error: error.message } }
        }

        if (!data) {
          return { ok: false, intent, args, data: { error: "Touch run no encontrado" } }
        }

        return { ok: true, intent, args, data: { touch_run: data } }
      }

      case "orchestrator.run": {
        const orchestrator = args.orchestrator as "touch" | "reactivation" | undefined
        const campaignId = args.campaign_id as string | undefined

        if (!orchestrator) {
          return { ok: false, intent, args, data: { error: "orchestrator.run requiere orchestrator: 'touch' | 'reactivation'" } }
        }

        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseKey) {
          return { ok: false, intent, args, data: { error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" } }
        }

        const functionName =
          orchestrator === "touch" ? "touch-orchestrator-v9" : orchestrator === "reactivation" ? "reactivation-orchestrator-v1" : null

        if (!functionName) {
          return { ok: false, intent, args, data: { error: "Orchestrator no válido" } }
        }

        const url = `${supabaseUrl}/functions/v1/${functionName}`
        const body: any = { limit: args.limit ?? 20, dry_run: args.dry_run ?? false }
        if (campaignId) body.campaign_id = campaignId

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
              apikey: supabaseKey,
            },
            body: JSON.stringify(body),
          })

          const result = await res.json()
          return { ok: res.ok, intent, args, data: { result, orchestrator, function_name: functionName } }
        } catch (e: any) {
          return { ok: false, intent, args, data: { error: e?.message ?? "Error ejecutando orchestrator" } }
        }
      }

      case "dispatcher.run": {
        const dispatcher = args.dispatcher as "touch" | "email" | "whatsapp" | undefined

        if (!dispatcher) {
          return { ok: false, intent, args, data: { error: "dispatcher.run requiere dispatcher: 'touch' | 'email' | 'whatsapp'" } }
        }

        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseKey) {
          return { ok: false, intent, args, data: { error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" } }
        }

        const functionName =
          dispatcher === "touch"
            ? "dispatch-touch"
            : dispatcher === "email"
              ? "dispatch-touch-email"
              : dispatcher === "whatsapp"
                ? "dispatch-touch-whatsapp-v2"
                : null

        if (!functionName) {
          return { ok: false, intent, args, data: { error: "Dispatcher no válido" } }
        }

        const url = `${supabaseUrl}/functions/v1/${functionName}`
        const body: any = { limit: args.limit ?? 50, dry_run: args.dry_run ?? false }

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
              apikey: supabaseKey,
            },
            body: JSON.stringify(body),
          })

          const result = await res.json()
          return { ok: res.ok, intent, args, data: { result, dispatcher, function_name: functionName } }
        } catch (e: any) {
          return { ok: false, intent, args, data: { error: e?.message ?? "Error ejecutando dispatcher" } }
        }
      }

      case "enrichment.run": {
        const supabaseUrl = process.env.SUPABASE_URL
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

        if (!supabaseUrl || !supabaseKey) {
          return { ok: false, intent, args, data: { error: "Missing SUPABASE_URL or SERVICE_ROLE_KEY" } }
        }

        const url = `${supabaseUrl}/functions/v1/run-enrichment`
        const body: any = { limit: args.limit ?? 50 }

        try {
          const res = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${supabaseKey}`,
              apikey: supabaseKey,
            },
            body: JSON.stringify(body),
          })

          const result = await res.json()
          return { ok: res.ok, intent, args, data: { result } }
        } catch (e: any) {
          return { ok: false, intent, args, data: { error: e?.message ?? "Error ejecutando enrichment" } }
        }
      }

      case "appointment.list": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()
        const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 200)
        const status = args.status as string | undefined

        let query = supabase
          .from("appointments")
          .select("*")
          .eq("account_id", accountId)
          .order("starts_at", { ascending: false })
          .limit(limit)

        if (status) query = query.eq("status", status)

        const { data, error } = await query

        if (error) {
          return { ok: false, intent, args, data: { error: error.message } }
        }

        return { ok: true, intent, args, data: { appointments: data ?? [] } }
      }

      case "appointment.inspect": {
        const accountId = requireAccountId(args, intent)
        const appointmentId = args.appointment_id as string | undefined

        if (!appointmentId) {
          return { ok: false, intent, args, data: { error: "appointment.inspect requiere appointment_id" } }
        }

        const supabase = getSupabaseAdmin()
        const { data, error } = await supabase
          .from("appointments")
          .select("*")
          .eq("id", appointmentId)
          .eq("account_id", accountId)
          .maybeSingle()

        if (error) {
          return { ok: false, intent, args, data: { error: error.message } }
        }

        if (!data) {
          return { ok: false, intent, args, data: { error: "Appointment no encontrado" } }
        }

        return { ok: true, intent, args, data: { appointment: data } }
      }

      default: {
        return { ok: false, intent: cmd.intent, args, data: { error: "Intent no implementado todavía en Command OS router" } }
      }
    }
  } catch (e: any) {
    return {
      ok: false,
      intent: intent ?? cmd.intent,
      args,
      data: { error: e?.message ?? "Error inesperado en Command OS router" },
    }
  }
}
