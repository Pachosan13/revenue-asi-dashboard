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
  | "enc24.autos_usados.start"
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

  try {
    switch (intent) {
      case "enc24.autos_usados.start": {
        const accountId = requireAccountId(args, intent)
        const supabase = getSupabaseAdmin()

        const country = typeof args.country === "string" && args.country.trim() ? args.country.trim().toUpperCase() : "PA"
        const limit = Math.min(Math.max(Number(args.limit ?? 50), 1), 500)
        const maxPages = Math.min(Math.max(Number(args.max_pages ?? args.maxPages ?? 1), 1), 5)
        const minYear = Math.min(Math.max(Number(args.min_year ?? args.minYear ?? 2014), 1990), 2035)
        const enqueueLimit = Math.min(Math.max(Number(args.enqueue_limit ?? 200), 1), 5000)

        if (country !== "PA") {
          return {
            ok: false,
            intent,
            args: { ...args, country },
            data: { error: "Por ahora solo soportamos Panamá (country=PA) para Encuentra24 autos usados." },
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
          body: JSON.stringify({ account_id: accountId, country, limit, maxPages, minYear }),
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
          args: { account_id: accountId, country, limit, maxPages, minYear, enqueueLimit },
          data: {
            collected: collectJson,
            enqueued: enq,
            note:
              "La cola quedó preparada. Para producción necesitas el reveal worker corriendo (CDP Chrome real) para consumir lead_hunter.enc24_reveal_tasks.",
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
              const meta = { source: "touch.simulate", action: step_key, step_key, dry_run }

              const { error: trErr } = await supabase.from("touch_runs").insert({
                account_id,
                lead_id,
                step,
                channel,
                payload,
                scheduled_at,
                status: dry_run ? "simulated" : "queued",
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
          const meta = { source: "touch.simulate", action: step_key, step_key, dry_run }

          const { error: trErr } = await supabase.from("touch_runs").insert({
            account_id,
            lead_id,
            step,
            channel: effective_channel,
            payload,
            scheduled_at,
            status: dry_run ? "simulated" : "queued",
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

        const supabase = getSupabaseAdmin()
        const { data, error } = await supabase
          .from("campaigns")
          .update({ is_active: isActive })
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
