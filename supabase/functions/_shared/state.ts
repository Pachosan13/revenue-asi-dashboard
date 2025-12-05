<<<<<<< HEAD
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
=======
// supabase/functions/_shared/state.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type StateScope = "system" | "account";

export interface SetStateInput {
  scope: StateScope;
  key: string;
  value: unknown;
  account_id?: string | null;
}

/**
 * setState: upsert clave–valor en core_state
 */
export async function setState(
  supabase: SupabaseClient,
  input: SetStateInput
) {
  const { error } = await supabase.from("core_state").upsert(
    {
      scope: input.scope,
      account_id: input.account_id ?? null,
      key: input.key,
      value: input.value as any,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "scope,account_id,key",
    }
  );

  if (error) {
    console.error("setState error", error);
  }
}

/**
 * getState: devuelve value o null si no existe
 */
export async function getState<T = unknown>(
  supabase: SupabaseClient,
  params: {
    scope: StateScope;
    key: string;
    account_id?: string | null;
  }
): Promise<T | null> {
  let query = supabase
    .from("core_state")
    .select("value")
    .eq("scope", params.scope)
    .eq("key", params.key)
    .limit(1);

  if (params.account_id) {
    query = query.eq("account_id", params.account_id);
  } else {
    query = query.is("account_id", null);
  }

  const { data, error } = await query.single();

  if (error) {
    if (error.code !== "PGRST116") {
      // no rows is ok
      console.error("getState error", error);
    }
    return null;
  }

  return (data?.value as T) ?? null;
}
>>>>>>> origin/plan-joe-dashboard-v1
