// supabase/functions/_shared/memory.ts
import { SupabaseClient } from "jsr:@supabase/supabase-js@2";

export type MemoryScope = "system" | "account" | "campaign" | "lead";
export type MemoryActor =
  | "director"
  | "cmo"
  | "cro"
  | "coo"
  | "cfo"
  | "agent"
  | "user";
export type MemoryEventType =
  | "decision"
  | "plan"
  | "action"
  | "result"
  | "metric"
  | "note"
  | "evaluation";

export interface LogMemoryInput {
  scope: MemoryScope;
  account_id?: string | null;
  entity_id?: string | null;
  actor: MemoryActor;
  event_type: MemoryEventType;
  payload: unknown;
  importance?: number;
}

/**
 * Registra un evento de memoria en core_memory_events.
 * No lanza error: loguea en consola si algo falla.
 */
export async function logMemoryEvent(
  supabase: SupabaseClient,
  input: LogMemoryInput
) {
  const { error } = await supabase.from("core_memory_events").insert({
    scope: input.scope,
    account_id: input.account_id ?? null,
    entity_id: input.entity_id ?? null,
    actor: input.actor,
    event_type: input.event_type,
    payload: input.payload as any,
    importance: input.importance ?? 1,
  });

  if (error) {
    console.error("logMemoryEvent error", error);
  }
}

/**
 * Devuelve los últimos N eventos de memoria para un scope.
 */
export async function getRecentMemory(
  supabase: SupabaseClient,
  params: {
    scope: MemoryScope;
    account_id?: string | null;
    entity_id?: string | null;
    limit?: number;
  }
) {
  let query = supabase
    .from("core_memory_events")
    .select("*")
    .eq("scope", params.scope)
    .order("created_at", { ascending: false });

  if (params.account_id) {
    query = query.eq("account_id", params.account_id);
  }

  if (params.entity_id) {
    query = query.eq("entity_id", params.entity_id);
  }

  const { data, error } = await query.limit(params.limit ?? 20);

  if (error) {
    console.error("getRecentMemory error", error);
    return [];
  }

  return data ?? [];
}
