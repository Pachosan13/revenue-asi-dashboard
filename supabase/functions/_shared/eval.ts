// supabase/functions/_shared/eval.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logMemoryEvent } from "./memory.ts"

/**
 * Eval genérico que se adapta al schema REAL de core_memory_events:
 *
 * core_memory_events:
 *  - id (uuid)
 *  - lead_id (uuid)        NOT NULL
 *  - event_type (text)     NOT NULL
 *  - event_source (text)   NOT NULL
 *  - channel (text)
 *  - direction (text)
 *  - payload (jsonb)
 *  - score_delta (int)
 *  - created_at (timestamptz)
 *
 * 👉 Si NO hay lead_id, NO escribe nada (solo logea un warning).
 */

// Entrada flexible (soporta llamadas nuevas y viejas)
export interface EvaluationInput {
  // obligatorio para que se pueda insertar; si falta, se salta el insert
  lead_id?: string | null

  // quién genera el evento
  event_source?: string | null  // ej: "dispatcher", "reactivation_orchestrator", "touch_orchestrator"

  // meta de evaluación
  label?: string | null
  kpis?: Record<string, any> | null
  notes?: string | null

  // opcionales, por si quieres clasificar el evento
  channel?: string | null      // "email" | "whatsapp" | "voice" | ...
  direction?: string | null    // "inbound" | "outbound"
  score_delta?: number | null

  // por si quieres override explícito
  event_type?: string | null   // default "evaluation"

  // compat: campos viejos que ignoramos si llegan
  scope?: string | null
  actor?: string | null
  version?: string | null
  raw?: any
}

// Soporta dos firmas:
//
// 1) Nueva / recomendada:
//    logEvaluation(supabase, {
//      lead_id,
//      event_source: "dispatcher",
//      label: "dispatch_touch_email_sent",
//      kpis: { processed: 10, failed: 1 },
//      notes: "..." (opcional)
//    })
//
// 2) Antigua (wrapper):
//    logEvaluation({
//      supabase,
//      lead_id,
//      event_source: "dispatcher",
//      label: "...",
//      kpis: {...},
//    })
//
// En ambos casos, si no hay lead_id → no insert, NO revienta.

export async function logEvaluation(
  supabaseOrWrapper: SupabaseClient | { supabase: SupabaseClient } | any,
  maybeOptions?: EvaluationInput,
) {
  let supabase: SupabaseClient
  let opts: EvaluationInput

  // Caso 1: logEvaluation(supabase, { ... })
  if (supabaseOrWrapper && typeof supabaseOrWrapper.from === "function") {
    supabase = supabaseOrWrapper as SupabaseClient
    opts = (maybeOptions || {}) as EvaluationInput
  }
  // Caso 2: logEvaluation({ supabase, ... })
  else if (supabaseOrWrapper && supabaseOrWrapper.supabase) {
    supabase = supabaseOrWrapper.supabase as SupabaseClient
    const { supabase: _s, ...rest } = supabaseOrWrapper
    opts = rest as EvaluationInput
  } else {
    console.error("[logEvaluation] Invalid call signature")
    return
  }

  const leadId = opts.lead_id ?? null

  // 🔒 Schema real exige lead_id NOT NULL.
  // Sin lead_id preferimos NO insertar a romper todo.
  if (!leadId) {
    console.warn(
      "[logEvaluation] Missing lead_id, skipping insert. label=",
      opts.label || null,
      "event_source=",
      opts.event_source || null,
    )
    return
  }

  const eventType = opts.event_type || "evaluation"
  const eventSource = opts.event_source || "system"

  const payload = {
    label: opts.label ?? null,
    kpis: opts.kpis ?? null,
    notes: opts.notes ?? null,
    version: opts.version ?? null,
    raw: opts.raw ?? null,
  }

  await logMemoryEvent(supabase, {
    lead_id: leadId,
    event_type: eventType,
    event_source: eventSource,
    channel: opts.channel ?? null,
    direction: opts.direction ?? null,
    payload,
    score_delta: opts.score_delta ?? null,
  })
}
