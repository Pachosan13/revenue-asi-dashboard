import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "touch-orchestrator-fake-v2_2025-11-27";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limit =
      typeof body.limit === "number" && body.limit > 0 ? body.limit : 20;

    const campaignId = body.campaign_id as string | undefined;
    const campaignRunId = body.campaign_run_id as string | undefined;

    if (!campaignId) {
      return new Response(
        JSON.stringify({
          ok: false,
          version: VERSION,
          error: "missing_campaign_id",
          details: "You must pass campaign_id in the request body.",
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 1️⃣ Leer leads en attempting desde la VIEW
    const { data: queue, error: queueError } = await supabase
      .from("lead_attempt_queue")
      .select("*")
      .limit(limit);

    if (queueError) {
      console.error("select lead_attempt_queue error", queueError);
      return new Response(
        JSON.stringify({
          ok: false,
          version: VERSION,
          error: "queue_select_failed",
          details: queueError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!queue || queue.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          version: VERSION,
          processed: 0,
          message: "no leads in attempting state",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    const now = new Date().toISOString();

    // 2️⃣ Construir touch_runs según tu schema real
    const touches = queue.map((row: any) => {
      const nextStep =
        typeof row.last_step === "number" && row.last_step > 0
          ? row.last_step + 1
          : 1;

      const phone =
        row.enriched?.normalized_phone ?? row.phone ?? null;

      const payload = {
        script_version: "fake-v1",
        reason: "yc-demo",
        dial_target: phone,
        lead_snapshot: {
          id: row.lead_id,
          email: row.email,
          phone: row.phone,
          enriched: row.enriched ?? null,
        },
      };

      return {
        campaign_id: campaignId,
        campaign_run_id: campaignRunId ?? null,
        lead_id: row.lead_id,
        step: nextStep,
        channel: "voice",
        payload,
        scheduled_at: now, // requerido NOT NULL
        sent_at: now,      // fake: lo marcamos como enviado
        status: "sent",    // override de 'queued'
        error: null,
        type: "outbound",
      };
    });

    // 3️⃣ Insertar en touch_runs
    const { error: insertError } = await supabase
      .from("touch_runs")
      .insert(touches);

    if (insertError) {
      console.error("insert touch_runs error", insertError);
      return new Response(
        JSON.stringify({
          ok: false,
          version: VERSION,
          error: "insert_touch_runs_failed",
          details: insertError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 4️⃣ Actualizar last_touched_at / last_channel en leads (best-effort)
    const leadIds = queue.map((r: any) => r.lead_id);

    const { error: leadsUpdateError } = await supabase
      .from("leads")
      .update({
        last_touched_at: now,
        last_channel: "voice",
      })
      .in("id", leadIds);

    if (leadsUpdateError) {
      console.error("update leads last_touched error", leadsUpdateError);
      // no frenamos por esto
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        processed: touches.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("unexpected error in touch-orchestrator-fake", e);
    return new Response(
      JSON.stringify({
        ok: false,
        version: VERSION,
        error: "unexpected_error",
        details: String(e),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
