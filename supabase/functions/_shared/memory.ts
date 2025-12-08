// supabase/functions/_shared/memory.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Tu tabla core_memory_events TIENE ÚNICAMENTE:
 *
 * id (uuid)
 * lead_id (uuid)        ← NOT NULL
 * event_type (text)     ← NOT NULL
 * event_source (text)   ← NOT NULL
 * channel (text)
 * direction (text)
 * payload (jsonb)
 * score_delta (int)
 * created_at (timestamptz)
 *
 * Esto es LO ÚNICO que se puede insertar.
 */

/** Entrada simple y robusta */
export interface MemoryEventInput {
  lead_id: string;           // obligatorio por schema
  event_type: string;        // ej: "evaluation", "reply_positive", "touch_sent"
  event_source: string;      // ej: "dispatcher", "orchestrator", "inbound_router"
  channel?: string | null;
  direction?: string | null;
  payload?: any;
  score_delta?: number | null;
}

/**
 * Inserta un evento de memoria EN FORMATO REAL.
 */
export async function logMemoryEvent(
  supabase: SupabaseClient,
  input: MemoryEventInput
) {
  const row = {
    id: crypto.randomUUID(),
    lead_id: input.lead_id,
    event_type: input.event_type,
    event_source: input.event_source,
    channel: input.channel ?? null,
    direction: input.direction ?? null,
    payload: input.payload ?? null,
    score_delta: input.score_delta ?? null,
  };

  const { error } = await supabase.from("core_memory_events").insert(row);

  if (error) {
    console.error("[logMemoryEvent] Insert error:", error);
  }
}

/**
 * Query para ver últimos eventos por lead.
 */
export async function getRecentMemory(
  supabase: SupabaseClient,
  lead_id: string,
  limit = 20
) {
  const { data, error } = await supabase
    .from("core_memory_events")
    .select("*")
    .eq("lead_id", lead_id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[getRecentMemory] error:", error);
    return [];
  }

  return data ?? [];
}
