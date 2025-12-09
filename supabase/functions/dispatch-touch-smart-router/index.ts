// supabase/functions/dispatch-touch-smart-router/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { logEvaluation } from "../_shared/eval.ts"

const VERSION = "dispatch-touch-smart-router-v1_2025-12-09"

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

type TouchRun = {
  id: string
  account_id: string | null
  lead_id: string | null
  channel: string | null
  status: string
  scheduled_at: string | null
  payload: Record<string, unknown> | null
}

type ChannelCaps = {
  enabled: Set<string>
  withProvider: Set<string>
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")

  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "env",
        error: "Missing Supabase env",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const supabase = createClient(SB_URL, SB_KEY)

  // -------- body: limit, fallback, account filter opcional --------
  let body: any = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const limit = Math.min(100, Number(body.limit ?? 50))

  const fallbackOrder: string[] =
    Array.isArray(body.fallback_order) && body.fallback_order.length > 0
      ? body.fallback_order
      : ["sms", "whatsapp", "email"]

  const filterAccount: string | null =
    typeof body.account_id === "string" ? body.account_id : null

  // -------- 1) Traer touch_runs "auto" / sin canal, en queued --------
  let query = supabase
    .from("touch_runs")
    .select(
      "id, account_id, lead_id, channel, status, scheduled_at, payload",
    )
    .eq("status", "queued")
    .or("channel.eq.auto,channel.is.null")

  if (filterAccount) {
    query = query.eq("account_id", filterAccount)
  }

  const { data: runs, error: rErr } = await query
    .order("scheduled_at", { ascending: true, nullsFirst: true })
    .limit(limit)

  if (rErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "select_runs",
        error: rErr.message,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    )
  }

  const typedRuns = (runs ?? []) as TouchRun[]

  if (!typedRuns.length) {
    // log best-effort
    try {
      await logEvaluation({
        supabase,
        event_type: "evaluation",
        actor: "router",
        label: "smart_router_empty",
        kpis: { processed: 0, failed: 0 },
        notes: "No auto/queued touch_runs to route",
      })
    } catch (e) {
      console.error("logEvaluation failed in smart router (empty)", e)
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        processed: 0,
        failed: 0,
        fallbackOrder,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    )
  }

  // -------- 2) Cache por account_id: capacidades + providers --------
  const accountCache = new Map<string, ChannelCaps>()
  const errors: any[] = []
  let processed = 0

  async function getAccountCaps(accountId: string): Promise<ChannelCaps> {
    const cached = accountCache.get(accountId)
    if (cached) return cached

    // canales habilitados
    const { data: capsRows, error: capsErr } = await supabase
      .from("account_channel_capabilities")
      .select("channel, is_enabled")
      .eq("account_id", accountId)

    if (capsErr) {
      throw new Error(`capabilities_lookup_failed:${capsErr.message}`)
    }

    const enabled = new Set<string>(
      (capsRows ?? [])
        .filter((r: any) => r.is_enabled)
        .map((r: any) => String(r.channel).toLowerCase()),
    )

    // canales con provider default
    const { data: provRows, error: provErr } = await supabase
      .from("account_provider_settings")
      .select("channel, provider, is_default")
      .eq("account_id", accountId)
      .eq("is_default", true)

    if (provErr) {
      throw new Error(`provider_settings_lookup_failed:${provErr.message}`)
    }

    const withProvider = new Set<string>(
      (provRows ?? []).map((r: any) =>
        String(r.channel).toLowerCase(),
      ),
    )

    const caps: ChannelCaps = { enabled, withProvider }
    accountCache.set(accountId, caps)
    return caps
  }

  // -------- 3) LOOP: decidir canal y actualizar touch_runs --------
  for (const tr of typedRuns) {
    try {
      if (!tr.account_id) {
        throw new Error("missing_account_id_on_touch_run")
      }

      const caps = await getAccountCaps(tr.account_id)

      const available = new Set(
        [...caps.enabled].filter((c) => caps.withProvider.has(c)),
      )

      if (!available.size) {
        throw new Error("no_available_channels_for_account")
      }

      // order from payload override, si existe
      const payload = (tr.payload ?? {}) as Record<string, unknown>
      const localFallback =
        Array.isArray(payload.fallback_order) &&
        (payload.fallback_order as string[]).length > 0
          ? (payload.fallback_order as string[])
          : fallbackOrder

      const chosen = localFallback.find((ch) =>
        available.has(String(ch).toLowerCase()),
      )

      if (!chosen) {
        throw new Error(
          `no_channel_match_fallback:${localFallback.join(",")}`,
        )
      }

      const chosenChannel = String(chosen).toLowerCase()

      const updatedPayload = {
        ...payload,
        routed_by: "smart-router-v1",
        routed_at: new Date().toISOString(),
        routed_channel: chosenChannel,
        fallback_order: localFallback,
      }

      const newScheduledAt =
        tr.scheduled_at ?? new Date().toISOString()

      const { error: uErr } = await supabase
        .from("touch_runs")
        .update({
          channel: chosenChannel,
          status: "scheduled",
          scheduled_at: newScheduledAt,
          error: null,
          payload: updatedPayload,
        })
        .eq("id", tr.id)

      if (uErr) {
        throw new Error(`update_touch_run_failed:${uErr.message}`)
      }

      processed++
    } catch (e: any) {
      const msg = e?.message ?? String(e)
      errors.push({
        touch_run_id: tr.id,
        account_id: tr.account_id,
        lead_id: tr.lead_id,
        error: msg,
      })

      await supabase
        .from("touch_runs")
        .update({
          status: "failed",
          error: msg,
        })
        .eq("id", tr.id)
    }
  }

  // -------- 4) Log resumen en core_memory_events --------
  try {
    await logEvaluation({
      supabase,
      event_type: "evaluation",
      actor: "router",
      label: "smart_router_dispatch_v1",
      kpis: {
        processed,
        failed: errors.length,
        total_candidates: typedRuns.length,
      },
      notes:
        errors.length === 0
          ? "Smart router dispatched all auto touch_runs successfully"
          : `Smart router completed with ${errors.length} errors`,
    })
  } catch (e) {
    console.error("logEvaluation failed in smart router", e)
  }

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      processed,
      failed: errors.length,
      total_candidates: typedRuns.length,
      fallbackOrder,
      errors,
    }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  )
})
