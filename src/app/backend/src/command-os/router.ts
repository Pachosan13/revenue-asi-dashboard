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
    throw new Error(
      "Faltan variables de entorno: SUPABASE_URL y/o SUPABASE_SERVICE_ROLE_KEY",
    )
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

function bestLeadForQuery(query: string, leads: LeadRecord[]): {
  lead: LeadRecord
  score: number
} {
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

// ---------- RESOLVER ULTRA PARA LEADS ----------

async function resolveLeadFromArgs(args: {
  lead_id?: string
  email?: string
  phone?: string
  contact_name?: string
  lead_reference?: string
  name?: string
}): Promise<LeadRecord> {
  const supabase = getSupabaseAdmin()

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
      .eq("id", leadId)
      .maybeSingle()

    if (error) {
      throw new Error(`Error buscando lead por id: ${error.message}`)
    }
    if (!data) {
      throw new Error("No se encontró ningún lead con ese id.")
    }
    return data as LeadRecord
  }

  // 2) Email
  if (email) {
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .ilike("email", email.trim())
      .limit(10)

    if (error) {
      throw new Error(`Error buscando lead por email: ${error.message}`)
    }
    if (!data || data.length === 0) {
      throw new Error("No se encontró ningún lead con ese email.")
    }
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
      .or(
        `phone.eq.${cleanPhone},phone.ilike.%${cleanPhone}%,enriched->>normalized_phone.eq.${cleanPhone}`,
      )
      .limit(10)

    if (error) {
      throw new Error(`Error buscando lead por teléfono: ${error.message}`)
    }
    if (!data || data.length === 0) {
      throw new Error("No se encontró ningún lead con ese teléfono.")
    }
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

    if (error) {
      throw new Error(
        `Error buscando lead por nombre o referencia: ${error.message}`,
      )
    }
    if (!data || data.length === 0) {
      throw new Error(
        "No encontré ningún lead que se parezca a ese nombre. Intenta con email o teléfono.",
      )
    }

    const { lead, score } = bestLeadForQuery(nameQuery, data as LeadRecord[])

    if (score < 0.35 && data.length > 1) {
      throw new Error(
        "Encontré varios leads parecidos, pero ninguno con suficiente certeza. Especifica email o teléfono.",
      )
    }

    return lead
  }

  // 5) Nada usable
  throw new Error(
    "lead.inspect requiere al menos uno de: lead_id, email, phone, contact_name o algún identificador de referencia.",
  )
}

/**
 * Resolver lista de lead_ids para lead.enroll.
 * - Si vienen lead_ids: se usan.
 * - Si viene email / phone / contact_name / lead_reference: se resuelve a UN lead y se usa su id.
 */
async function resolveLeadIdsForEnroll(args: {
  lead_ids?: string[]
  email?: string
  phone?: string
  contact_name?: string
  lead_reference?: string
  name?: string
}): Promise<string[]> {
  if (Array.isArray(args.lead_ids) && args.lead_ids.length > 0) {
    return args.lead_ids
  }

  const lead = await resolveLeadFromArgs({
    email: args.email,
    phone: args.phone,
    contact_name: args.contact_name,
    lead_reference: args.lead_reference,
    name: args.name,
  })

  return [lead.id]
}

// ---------- CAMPAÑAS / ENROL ----------

async function resolveCampaignByName(name: string) {
  const supabase = getSupabaseAdmin()

  const { data, error } = await supabase
    .from("campaigns")
    .select("*")
    .ilike("name", `%${name}%`)
    .limit(2)

  if (error) {
    throw new Error(`Error resolviendo campaña: ${error.message}`)
  }

  if (!data || data.length === 0) {
    throw new Error("No se encontró ninguna campaña con ese nombre.")
  }

  if (data.length > 1) {
    throw new Error("Hay varias campañas que matchean ese nombre. Afina el criterio.")
  }

  return data[0]
}

/**
 * Enrolar leads a campañas vía RPC api_enroll_leads.
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

  if (error) {
    throw new Error(`Error enrolling leads: ${error.message}`)
  }

  return {
    enrolled: (data.enrolled as string[]) ?? [],
    campaign_id: data.campaign_id as string | undefined,
    campaign_name: data.campaign_name as string | undefined,
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
    throw new Error(
      "No hay campos válidos para actualizar. Campos permitidos: " +
        ALLOWED_LEAD_UPDATE_FIELDS.join(", "),
    )
  }

  const { data, error } = await supabase
    .from("leads")
    .update(safeUpdates)
    .eq("id", args.lead_id)
    .select("*")
    .single()

  if (error) {
    throw new Error(`Error updating lead ${args.lead_id}: ${error.message}`)
  }

  return data
}

/**
 * Listar leads recientes con filtros simples.
 */
async function listRecentLeads(args: {
  limit?: number
  status?: string
  state?: string
}): Promise<{ leads: any[] }> {
  const supabase = getSupabaseAdmin()

  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100) // 1–100

  let query = supabase.from("leads").select("*").order("created_at", { ascending: false })

  if (args.status) {
    query = query.eq("status", args.status)
  }

  if (args.state) {
    query = query.eq("state", args.state)
  }

  const { data, error } = await query.limit(limit)

  if (error) {
    throw new Error(`Error listing recent leads: ${error.message}`)
  }

  return { leads: data ?? [] }
}

// ---------- CAMPAÑAS: LIST / INSPECT (LECTURA REAL, CREATE STUB) ----------

async function listCampaigns(args: {
  limit?: number
  status?: string
}): Promise<{ campaigns: any[] }> {
  const supabase = getSupabaseAdmin()

  const limit = Math.min(Math.max(args.limit ?? 20, 1), 100)

  let query = supabase.from("campaigns").select("*").order("created_at", {
    ascending: false,
  })

  if (args.status) {
    query = query.eq("status", args.status)
  }

  const { data, error } = await query.limit(limit)

  if (error) {
    throw new Error(`Error listando campañas: ${error.message}`)
  }

  return { campaigns: data ?? [] }
}

async function inspectCampaign(args: {
  campaign_id?: string
  campaign_name?: string
}) {
  const supabase = getSupabaseAdmin()

  if (args.campaign_id) {
    const { data, error } = await supabase
      .from("campaigns")
      .select("*")
      .eq("id", args.campaign_id)
      .maybeSingle()

    if (error) {
      throw new Error(`Error buscando campaña por id: ${error.message}`)
    }
    if (!data) throw new Error("No se encontró campaña con ese id.")
    return data
  }

  if (args.campaign_name) {
    return resolveCampaignByName(args.campaign_name)
  }

  throw new Error("campaign.inspect requiere campaign_id o campaign_name.")
}

// create stub (para que el chat pueda “crear” campañas sin romper nada)
async function createCampaignStub(args: {
  name: string
  channel?: string
  objective?: string
  notes?: string
}) {
  return {
    message:
      "campaign.create (stub): aquí deberíamos crear la campaña real en la tabla campaigns / Campaign Engine.",
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
  | "lead.inspect"
  | "lead.enroll"
  | "lead.update"
  | "lead.list.recents"
  | "campaign.list"
  | "campaign.inspect"
  | "campaign.create"

interface LeadInspectArgs {
  lead_id?: string
  email?: string
  phone?: string
  contact_name?: string
  lead_reference?: string
  name?: string
}

interface LeadEnrollArgs {
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
  lead_id: string
  updates: Record<string, any>
}

interface LeadListRecentsArgs {
  limit?: number
  status?: string
  state?: string
}

interface CampaignListArgs {
  limit?: number
  status?: string
}

interface CampaignInspectArgs {
  campaign_id?: string
  campaign_name?: string
}

interface CampaignCreateArgs {
  name: string
  channel?: string
  objective?: string
  notes?: string
}

function isLeadInspectArgs(args: Record<string, any>): args is LeadInspectArgs {
  return (
    (typeof args.lead_id === "string" && args.lead_id.length > 0) ||
    (typeof args.email === "string" && args.email.length > 0) ||
    (typeof args.phone === "string" && args.phone.length > 0) ||
    (typeof args.contact_name === "string" && args.contact_name.length > 0) ||
    (typeof args.lead_reference === "string" && args.lead_reference.length > 0) ||
    (typeof args.name === "string" && args.name.length > 0)
  )
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
  return (
    typeof args.lead_id === "string" &&
    args.lead_id.length > 0 &&
    args.updates &&
    typeof args.updates === "object"
  )
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

export async function handleCommandOsIntent(
  cmd: CommandOsResponse,
): Promise<CommandOsExecutionResult> {
  const intent = cmd.intent as KnownIntent
  const args = (cmd.args ?? {}) as Record<string, any>

  try {
    switch (intent) {
      case "system.status": {
        return {
          ok: true,
          intent,
          args,
          data: {
            message: "system.status OK — wiring conectado. Falta health real.",
            checks: {
              command_os_router: "ok",
              supabase_env:
                !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY
                  ? "configured"
                  : "missing",
            },
          },
        }
      }

      case "lead.inspect": {
        if (!isLeadInspectArgs(args)) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error:
                "lead.inspect requiere algún identificador: lead_id, email, phone, contact_name o referencia.",
            },
          }
        }

        const lead = await resolveLeadFromArgs({
          lead_id: args.lead_id,
          email: args.email,
          phone: args.phone,
          contact_name: args.contact_name,
          lead_reference: args.lead_reference,
          name: args.name,
        })

        return {
          ok: true,
          intent,
          args,
          data: {
            lead,
          },
        }
      }

      case "lead.enroll": {
        if (!isLeadEnrollArgs(args)) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error:
                "lead.enroll requiere lead_ids: string[] o un selector (email, phone, contact_name, referencia).",
            },
          }
        }

        const confirm = args.confirm ?? false

        const leadIds = await resolveLeadIdsForEnroll({
          lead_ids: args.lead_ids,
          email: args.email,
          phone: args.phone,
          contact_name: args.contact_name,
          lead_reference: args.lead_reference,
          name: args.name,
        })

        if (!confirm && leadIds.length > 20) {
          return {
            ok: false,
            intent,
            args: { ...args, lead_ids: leadIds },
            data: {
              error:
                "Intento de enrolar muchos leads sin confirm=true. Bloqueado por safety.",
            },
          }
        }

        let campaignId: string | null | undefined = args.campaign_id ?? null
        let campaignName: string | null | undefined = args.campaign_name ?? null

        if (!campaignId && campaignName) {
          const campaign = await resolveCampaignByName(campaignName)
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
          args: {
            ...args,
            lead_ids: leadIds,
            campaign_id: campaignId,
            campaign_name: campaignName,
          },
          data: {
            message: "Lead(s) enrolados vía api_enroll_leads.",
            result,
          },
        }
      }

      case "lead.update": {
        if (!isLeadUpdateArgs(args)) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error:
                "lead.update requiere lead_id: string y updates: object con campos permitidos.",
            },
          }
        }

        const updated = await updateLead({
          lead_id: args.lead_id,
          updates: args.updates,
        })

        return {
          ok: true,
          intent,
          args,
          data: {
            message: "Lead actualizado correctamente.",
            lead: updated,
            allowed_fields: ALLOWED_LEAD_UPDATE_FIELDS,
          },
        }
      }

      case "lead.list.recents": {
        if (!isLeadListRecentsArgs(args)) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error:
                "lead.list.recents acepta limit?: number, status?: string, state?: string.",
            },
          }
        }

        const result = await listRecentLeads({
          limit: args.limit,
          status: args.status,
          state: args.state,
        })

        return {
          ok: true,
          intent,
          args,
          data: {
            message: "Leads recientes obtenidos.",
            ...result,
          },
        }
      }

      case "campaign.list": {
        if (!isCampaignListArgs(args)) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error: "campaign.list acepta limit?: number, status?: string.",
            },
          }
        }

        const result = await listCampaigns({
          limit: args.limit,
          status: args.status,
        })

        return {
          ok: true,
          intent,
          args,
          data: {
            message: "Campañas recientes obtenidas.",
            ...result,
          },
        }
      }

      case "campaign.inspect": {
        if (!isCampaignInspectArgs(args)) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error:
                "campaign.inspect requiere campaign_id: string o campaign_name: string.",
            },
          }
        }

        const campaign = await inspectCampaign({
          campaign_id: args.campaign_id,
          campaign_name: args.campaign_name,
        })

        return {
          ok: true,
          intent,
          args,
          data: {
            message: "Detalle de campaña obtenido.",
            campaign,
          },
        }
      }

      case "campaign.create": {
        if (!isCampaignCreateArgs(args)) {
          return {
            ok: false,
            intent,
            args,
            data: {
              error: "campaign.create requiere al menos name: string.",
            },
          }
        }

        const result = await createCampaignStub({
          name: args.name,
          channel: args.channel,
          objective: args.objective,
          notes: args.notes,
        })

        return {
          ok: true,
          intent,
          args,
          data: result,
        }
      }

      default: {
        return {
          ok: false,
          intent: cmd.intent,
          args,
          data: {
            error: "Intent no implementado todavía en Command OS router",
          },
        }
      }
    }
  } catch (e: any) {
    return {
      ok: false,
      intent,
      args,
      data: {
        error: e?.message ?? "Error inesperado en Command OS router",
      },
    }
  }
}
