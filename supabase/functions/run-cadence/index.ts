import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { campaign_id } = await req.json().catch(() => ({}));

  // 1) campañas activas
  let campaignsQuery = supabase.from("campaigns").select("*").eq("status", "active");
  if (campaign_id) campaignsQuery = campaignsQuery.eq("id", campaign_id);
  const { data: campaigns, error: cErr } = await campaignsQuery;
  if (cErr) return new Response(JSON.stringify({ error: cErr.message }), { status: 500 });

  for (const c of campaigns ?? []) {
    // 2) crear run
    const { data: run } = await supabase
      .from("campaign_runs")
      .insert({ campaign_id: c.id })
      .select()
      .single();

    // 3) traer leads elegibles
    // Ejemplo simple: confidence >= c.min_confidence y status = 'new'
    const { data: leads } = await supabase
      .from("leads")
      .select("id, confidence, status")
      .gte("confidence", c.min_confidence ?? 0)
      .eq("status", "new")
      .limit(200);

    // 4) determinar proximo step por lead (por ahora step=1)
    const now = new Date().toISOString();
    const inserts = (leads ?? []).map((l) => ({
      campaign_id: c.id,
      campaign_run_id: run?.id,
      lead_id: l.id,
      step: 1,
      channel: c.default_channel ?? "whatsapp",
      payload: {
        message: c.first_message ?? "Hola! te escribo por...",
      },
      scheduled_at: now,
      status: "queued",
    }));

    if (inserts.length) {
      await supabase.from("touch_runs").insert(inserts);
    }
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
