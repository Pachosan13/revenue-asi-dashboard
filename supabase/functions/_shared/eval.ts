// supabase/functions/_shared/eval.ts
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  logMemoryEvent,
  MemoryScope,
  MemoryActor,
} from "./memory.ts";

export interface EvaluationInput {
  scope: MemoryScope;
  account_id?: string | null;
  entity_id?: string | null;
  actor?: MemoryActor;
  label: string;      // ej: "campaign_performance" | "script_test"
  kpis: Record<string, number>;
  notes?: string;
}

/**
 * Registra un evento de tipo 'evaluation' en core_memory_events con KPIs.
 */
export async function logEvaluation(
  supabase: SupabaseClient,
  input: EvaluationInput
) {
  await logMemoryEvent(supabase, {
    scope: input.scope,
    account_id: input.account_id ?? null,
    entity_id: input.entity_id ?? null,
    actor: input.actor ?? "director",
    event_type: "evaluation",
    payload: {
      label: input.label,
      kpis: input.kpis,
      notes: input.notes ?? null,
    },
    importance: 2,
  });
}
