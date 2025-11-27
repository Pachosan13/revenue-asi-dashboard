import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "run-enrichment-v2_2025-11-24_industry_C";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// --- Industry inference rules (heuristic, extendable) ---
function inferIndustry(payload: any): { industry: string; inferred: boolean; signals: string[] } {
  const signals: string[] = [];

  const name = String(payload?.name ?? "").toLowerCase();
  const email = String(payload?.email ?? "").toLowerCase();
  const website = String(payload?.website ?? "").toLowerCase();
  const gmbName = String(payload?.gmb?.name ?? "").toLowerCase();

  const haystack = [name, email, website, gmbName].join(" ");

  // If explicit industry already provided
  const explicit = payload?.industry ?? payload?.meta?.industry;
  if (explicit && typeof explicit === "string") {
    return { industry: explicit.toLowerCase(), inferred: false, signals: ["explicit_tag"] };
  }

  // Dentist
  if (/(dentist|dental|odontolog|orthodont|endodont|periodont|implants?)/.test(haystack)) {
    signals.push("keywords:dental");
    return { industry: "dentist", inferred: true, signals };
  }

  // Lawyers
  if (/(lawyer|attorney|law firm|abogado|legal|injury|immigration|divorce|criminal defense)/.test(haystack)) {
    signals.push("keywords:legal");
    return { industry: "lawyer", inferred: true, signals };
  }

  // Real estate
  if (/(realtor|real estate|brokerage|propiedad|inmobili|listing|homes for sale)/.test(haystack)) {
    signals.push("keywords:real_estate");
    return { industry: "real_estate", inferred: true, signals };
  }

  // Home services (plumbing, hvac, roofing, electrical, cleaning, handyman)
  if (/(plumb|plomer|hvac|air ?conditioning|ac repair|roof|techo|electric|electrical|cleaning|limpieza|handyman|remodel|construction|contractor|pest control)/.test(haystack)) {
    signals.push("keywords:home_services");
    return { industry: "home_services", inferred: true, signals };
  }

  // Restaurants / food
  if (/(restaurant|restaurante|cafe|coffee|bakery|panader|bar|grill|pizza|taquer|menu|reservation)/.test(haystack)) {
    signals.push("keywords:restaurant");
    return { industry: "restaurant", inferred: true, signals };
  }

  // fallback
  signals.push("fallback:generic");
  return { industry: "generic", inferred: true, signals };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ ok: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!SB_URL || !SB_KEY) {
    return new Response(
      JSON.stringify({
        ok: false,
        stage: "env",
        error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const supabase = createClient(SB_URL, SB_KEY);

  let body: any = {};
  try { body = await req.json(); } catch {}
  const limit = Number(body?.limit ?? 50);

  try {
    // 1) Fetch raw leads status=new
    const { data: raw, error: rawErr } = await supabase
      .from("lead_raw")
      .select("id, source, payload, status")
      .eq("status", "new")
      .limit(limit);

    if (rawErr) {
      return new Response(
        JSON.stringify({ ok: false, stage: "select_raw", error: rawErr.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!raw || raw.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, version: VERSION, processed: 0, message: "No raw leads new" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let processed = 0;
    const errors: any[] = [];

    for (const lead of raw) {
      const payload = lead.payload || {};

      const name = payload.name ?? null;
      const email = payload.email ?? null;
      const phone = payload.phone ?? null;
      const website = payload.website ?? null;

      if (!email && !phone) {
        errors.push({ id: lead.id, reason: "Missing email and phone" });
        continue;
      }

      // 2) Determine industry (Option C)
      const { industry, inferred, signals } = inferIndustry(payload);

      // 3) Check already enriched
      const { data: exists } = await supabase
        .from("lead_enriched")
        .select("id")
        .eq("id", lead.id)
        .maybeSingle();

      if (exists) {
        await supabase.from("lead_raw").update({ status: "processed" }).eq("id", lead.id);
        continue;
      }

      // 4) Insert into lead_enriched with meta.industry
      const meta = {
        source: lead.source ?? payload?.meta?.source ?? null,
        industry,
        industry_inferred: inferred,
        industry_signals: signals,
        v: VERSION,
      };

      const { error: insErr } = await supabase
        .from("lead_enriched")
        .insert({
          id: lead.id,
          name,
          phone,
          email,
          website,
          status: "new",
          meta,
        });

      if (insErr) {
        errors.push({ id: lead.id, stage: "insert_enriched", error: insErr.message });
        continue;
      }

      // 5) Mark raw processed
      await supabase.from("lead_raw").update({ status: "processed" }).eq("id", lead.id);

      processed++;
    }

    return new Response(
      JSON.stringify({ ok: true, version: VERSION, processed, errors }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e: any) {
    return new Response(
      JSON.stringify({ ok: false, stage: "fatal", error: e?.message ?? String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
