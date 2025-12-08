// supabase/functions/reactivation-orchestrator-v2/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { logEvaluation } from "../_shared/eval.ts";

const VERSION = "reactivation-orchestrator-v2_2025-12-08";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });

  if (req.method !== "POST")
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });

  // ───────────────────────────────────────────
  // ENV + CLIENT
  // ───────────────────────────────────────────
  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SB_URL, SB_KEY);

  const body = await req.json().catch(() => ({}));
  const limit = Number(body.limit ?? 20);
  const dryRun = Boolean(body.dry_run ?? false);
  const now = new Date();

  // ───────────────────────────────────────────
  // 1) LEAD CANDIDATES
  // ───────────────────────────────────────────
  const { data: candidates, error: cErr } = await supabase
    .from("lead_next_action_view_v5")
    .select(
      "lead_id, lead_name, recommended_channel, recommended_action, recommended_delay_minutes, priority_score"
    )
    .eq("recommended_action", "reactivate")
    .gt("priority_score", 0)
    .order("priority_score", { ascending: false })
    .limit(limit);

  if (cErr) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "select_candidates",
        error: cErr.message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }

  if (!candidates?.length) {
    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        processed_leads: 0,
        inserted: 0,
        dry_run: dryRun,
        errors: [],
      }),
      { headers: corsHeaders }
    );
  }

  let inserted = 0;
  const errors: any[] = [];

  // ───────────────────────────────────────────
  // LOOP DE LEADS
  // ───────────────────────────────────────────
  for (const row of candidates) {
    const leadId = row.lead_id;
    if (!leadId) continue;

    // 2) SUPPRESSION CHECK
    const { data: suppression, error: sErr } = await supabase
      .from("lead_suppression_status_v1")
      .select("is_unsubscribed, in_negative_cooldown, reactivation_eligible_at")
      .eq("lead_id", leadId)
      .maybeSingle();

    if (sErr) {
      errors.push({
        lead_id: leadId,
        stage: "suppression_check",
        error: sErr.message,
      });
      continue;
    }

    if (suppression?.is_unsubscribed) continue;
    if (suppression?.in_negative_cooldown) continue;

    if (
      suppression?.reactivation_eligible_at &&
      new Date(suppression.reactivation_eligible_at) > now
    )
      continue;

    // 3) DEDUPE (evitar duplicados)
    const { count: existingCount, error: exErr } = await supabase
      .from("touch_runs")
      .select("id", { count: "exact", head: true })
      .eq("lead_id", leadId)
      .eq("status", "queued")
      .contains("meta", { source: "brain_full_auto_reactivation" });

    if (exErr) {
      errors.push({
        lead_id: leadId,
        stage: "dedupe_check",
        error: exErr.message,
      });
      continue;
    }

    if ((existingCount ?? 0) > 0) continue;

    // 4) CONSTRUIR TOUCH
    const channel = row.recommended_channel ?? "voice";
    const delayMinutes = Number(row.recommended_delay_minutes ?? 0);
    const scheduledAt = new Date(now.getTime() + delayMinutes * 60_000);

    const payload =
      channel === "voice"
        ? {
            body:
              "Hola, espero que estés bien. ¿Te interesa revisar cómo ayudarte a generar más clientes y citas de forma predecible esta semana?",
          }
        : {
            body:
              "Hola, hace un tiempo hablamos de cómo generar más clientes y citas. ¿Quieres revisar horarios para esta semana?",
          };

    if (!dryRun) {
      const { error: insertErr } = await supabase.from("touch_runs").insert({
        lead_id: leadId,
        campaign_id: null,
        step: 900,
        channel,
        status: "queued",
        scheduled_at: scheduledAt.toISOString(),
        payload,
        error: null,
        meta: {
          source: "brain_full_auto_reactivation",
          orchestrator: VERSION,
        },
      });

      if (insertErr) {
        errors.push({
          lead_id: leadId,
          stage: "insert_touch_run",
          error: insertErr.message,
        });
        continue;
      }
    }

    inserted++;

    // 5) LOG INDIVIDUAL
    await logEvaluation(supabase, {
      lead_id: leadId,
      event_source: "reactivation_orchestrator",
      label: "reactivation_created",
      kpis: { inserted: 1 },
      notes: `Created reactivation touch via ${channel}`,
    });
  }

  // 6) LOG RESUMEN
  await logEvaluation(supabase, {
    event_source: "reactivation_orchestrator",
    label: "reactivation_orchestrator_summary",
    kpis: {
      processed: candidates.length,
      inserted,
      failed: errors.length,
    },
    notes: errors.length
      ? `${errors.length} errors`
      : "All reactivations inserted successfully",
  });

  return new Response(
    JSON.stringify({
      ok: true,
      version: VERSION,
      processed_leads: candidates.length,
      inserted,
      dry_run: dryRun,
      errors,
    }),
    { headers: corsHeaders }
  );
});
