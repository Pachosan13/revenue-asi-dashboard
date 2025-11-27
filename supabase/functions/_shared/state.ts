import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export async function setLeadState(params: {
  supabase: SupabaseClient;
  leadId: string;
  newState: "new" | "enriched" | "attempting" | "engaged" | "qualified" | "booked" | "dead";
  reason?: string;
  actor?: string;
  source?: string;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const { supabase, leadId, newState, reason, actor, source, meta } = params;

  const { error } = await supabase.rpc("set_lead_state", {
    p_lead_id: leadId,
    p_new_state: newState,
    p_reason: reason ?? null,
    p_actor: actor ?? "system",
    p_source: source ?? null,
    p_meta: meta ?? {},
  });

  if (error) {
    console.error("Failed to set lead state", {
      leadId,
      newState,
      error: error.message,
    });
  }
}
