// supabase/functions/_shared/director_touch.ts

// Canales soportados por Revenue ASI
export type Channel = "voice" | "whatsapp" | "sms" | "email"

// Config de fallback por canal
export interface FallbackConfig {
  order: Channel[]
  max_attempts: Record<Channel, number>
  cooldown_minutes: Record<Channel, number>
}

// Estrategia de campaña (lo define el Director Engine según nicho/oferta)
export interface CampaignStrategy {
  campaign_id: string | null
  message_class: "cold_outreach" | "nurture" | "post_demo"
  primary_channel: Channel
  fallback: FallbackConfig
  template_key: string // ej: "cold_dentist_v1_step1"
}

// Contexto mínimo del lead que necesitamos para el primer touch
export interface LeadContext {
  lead_id: string
  account_id: string
  first_name?: string | null
  clinic_name?: string | null
  phone_e164: string // "+50765699957"
}

// Lo que vamos a insertar en public.touch_runs (sin id/created_at)
export interface NewTouchInsert {
  campaign_id: string | null
  campaign_run_id: string | null
  lead_id: string
  step: number
  channel: Channel
  payload: any
  scheduled_at: string
  sent_at: string | null
  status: "queued" | "scheduled"
  error: string | null
  type: string | null
  intent: string | null
  outcome: string | null
  meta: any
  retry_count: number
  max_retries: number | null
  executed_at: string | null
  execution_ms: number | null
  message_class: string | null
  account_id: string
}

/**
 * Builder de payload v2 con Fallback Matrix
 * Este payload es el "contrato" que ya probamos con voice + whatsapp.
 */
export function buildInitialPayloadV2(
  strategy: CampaignStrategy,
  lead: LeadContext,
  step: number,
  options?: {
    dry_run?: boolean
    debug_tag?: string
  },
) {
  const dry_run = options?.dry_run ?? true
  const debug_tag =
    options?.debug_tag ?? `${strategy.message_class}_step_${step}`

  // expiración arbitraria a 30 días; se puede ajustar
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  return {
    meta: {
      dry_run,
      debug_tag,
      created_by: "director_engine",
    },
    step,
    dry_run,
    routing: {
      fallback: {
        order: strategy.fallback.order,
        max_attempts: strategy.fallback.max_attempts,
        cooldown_minutes: strategy.fallback.cooldown_minutes,
      },
      expires_at: expiresAt.toISOString(),
      stop_on_events: [
        "reply_positive",
        "appointment_booked",
        "do_not_contact",
      ],
      current_channel: strategy.primary_channel,
      primary_channel: strategy.primary_channel,
    },
    delivery: {
      // OJO: aquí luego conectas con tu librería de prompts/templates
      body: "Test de llamada desde dispatcher v5 (payload v2)",
      language: "es",
      variables: {
        first_name: lead.first_name ?? "",
        clinic_name: lead.clinic_name ?? "",
      },
      template_key: strategy.template_key,
      channel_overrides: {
        sms: { template_name: "dentist_cold_sms_v1" },
        email: {
          subject: "Pacientes nuevos sin subir tu ads spend",
          template_name: "dentist_cold_email_v1",
        },
        voice: { script_key: "dentist_cold_call_v1" },
        whatsapp: { template_name: "dentist_cold_whatsapp_v1" },
      },
    },
    provider: "twilio",
    campaign_id: strategy.campaign_id,
    message_class: strategy.message_class,
    to_normalized: lead.phone_e164,
    provider_config: {},
  }
}

/**
 * Builder del PRIMER touch de una cadencia (típicamente VOICE step 1)
 * Devuelve el objeto listo para insertar en public.touch_runs
 */
export function buildFirstTouchRun(
  strategy: CampaignStrategy,
  lead: LeadContext,
  step: number = 1,
  options?: {
    dry_run?: boolean
    debug_tag?: string
    schedule_immediately?: boolean // si true, lo pone "ya" para el dispatcher
  },
): NewTouchInsert {
  const now = new Date()
  const payload = buildInitialPayloadV2(strategy, lead, step, options)

  const scheduleImmediately = options?.schedule_immediately ?? true
  const scheduledAt = scheduleImmediately
    ? new Date(now.getTime() - 60_000) // 1 minuto en el pasado para que el dispatcher lo vea de una
    : now

  return {
    campaign_id: strategy.campaign_id,
    campaign_run_id: null,
    lead_id: lead.lead_id,
    step,
    channel: strategy.primary_channel, // ej: "voice"
    payload,
    scheduled_at: scheduledAt.toISOString(),
    sent_at: null,
    status: "queued",
    error: null,
    type: null,
    intent: null,
    outcome: null,
    meta: {}, // espacio para meta de orquestador si luego quieres
    retry_count: 0,
    max_retries: null,
    executed_at: null,
    execution_ms: null,
    message_class: strategy.message_class,
    account_id: lead.account_id,
  }
}

/**
 * Ejemplo de estrategia por defecto para cold outreach de dentistas
 * (puedes duplicar esto por nicho/oferta y cambiar fallback, templates, etc.)
 */
export function defaultDentistColdStrategy(
  campaign_id: string | null,
): CampaignStrategy {
  const fallback: FallbackConfig = {
    order: ["voice", "whatsapp", "sms", "email"],
    max_attempts: {
      voice: 1,
      whatsapp: 3,
      sms: 2,
      email: 3,
    },
    cooldown_minutes: {
      voice: 0,
      whatsapp: 720,
      sms: 720,
      email: 1440,
    },
  }

  return {
    campaign_id,
    message_class: "cold_outreach",
    primary_channel: "voice",
    fallback,
    template_key: "cold_dentist_v1_step1",
  }
}
