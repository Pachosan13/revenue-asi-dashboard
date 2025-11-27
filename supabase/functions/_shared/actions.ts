// supabase/functions/_shared/actions.ts
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type ActionStatus = "pending" | "running" | "done" | "failed";
export type ActionScope = "system" | "account";

export interface QueueActionInput {
  scope: ActionScope;
  account_id?: string | null;
  action_type: string;
  payload: unknown;
  scheduled_at?: string; // ISO
}

/**
 * Encola una acción en core_actions.
 * Ej: launch_campaign, warmup_leads, sync_metrics, etc.
 */
export async function queueAction(
  supabase: SupabaseClient,
  input: QueueActionInput
) {
  const { data, error } = await supabase
    .from("core_actions")
    .insert({
      scope: input.scope,
      account_id: input.account_id ?? null,
      action_type: input.action_type,
      payload: input.payload as any,
      status: "pending",
      scheduled_at: input.scheduled_at ?? new Date().toISOString(),
    })
    .select("*")
    .single();

  if (error) {
    console.error("queueAction error", error);
    return null;
  }

  return data;
}

/**
 * Trae acciones pendientes cuyo scheduled_at <= ahora.
 */
export async function getDueActions(
  supabase: SupabaseClient,
  params: {
    limit?: number;
  } = {}
) {
  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("core_actions")
    .select("*")
    .eq("status", "pending")
    .lte("scheduled_at", now)
    .order("scheduled_at", { ascending: true })
    .limit(params.limit ?? 20);

  if (error) {
    console.error("getDueActions error", error);
    return [];
  }

  return data ?? [];
}

/**
 * Marca acción como running/done/failed.
 */
export async function updateActionStatus(
  supabase: SupabaseClient,
  params: {
    id: string;
    status: ActionStatus;
    result?: unknown;
    errorText?: string;
  }
) {
  const patch: any = {
    status: params.status,
  };

  if (params.status === "running") {
    patch.started_at = new Date().toISOString();
  }

  if (params.status === "done" || params.status === "failed") {
    patch.finished_at = new Date().toISOString();
  }

  if (params.result !== undefined) {
    patch.result = params.result as any;
  }

  if (params.errorText) {
    patch.error = params.errorText;
  }

  const { error } = await supabase
    .from("core_actions")
    .update(patch)
    .eq("id", params.id);

  if (error) {
    console.error("updateActionStatus error", error);
  }
}
