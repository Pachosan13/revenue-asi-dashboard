import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VERSION = "run-enrichment-v2_2025-11-27";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// 🔢 normalizar teléfono muy simple (sin locuras todavía)
function normalizePhone(raw: unknown): string | null {
  if (!raw) return null;
  const s = String(raw);
  const digits = s.replace(/\D/g, "");
  if (!digits) return null;
  return digits;
}

// 🌎 adivinar país muy básico usando phone + country actual
function guessCountryCode(phone: string | null, countryCol: string | null): string | null {
  if (countryCol) return countryCol;
  if (!phone) return null;
  if (phone.startsWith("507") || phone.length === 8) return "PA";
  return null;
}

serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const limit = typeof body.limit === "number" ? body.limit : 50;

    // 1️⃣ Traer leads que todavía NO están enriquecidos
    //    (enriched IS NULL) — NO tocamos el enum state todavía
    const { data: leads, error: selectError } = await supabase
      .from("leads")
      .select(
        `
        id,
        source,
        niche,
        company_name,
        contact_name,
        phone,
        email,
        website,
        city,
        country,
        score,
        status,
        notes,
        created_at,
        enriched
      `
      )
      .is("enriched", null)
      .limit(limit);

    if (selectError) {
      console.error("select leads error", selectError);
      return new Response(
        JSON.stringify({
          ok: false,
          version: VERSION,
          error: "select_leads_failed",
          details: selectError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    if (!leads || leads.length === 0) {
      return new Response(
        JSON.stringify({
          ok: true,
          version: VERSION,
          processed: 0,
          message: "no leads to enrich",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 2️⃣ Construir payload de enriched para cada lead
    const updates = leads.map((lead: any) => {
      const normalizedPhone = normalizePhone(lead.phone);
      const hasEmail =
        !!lead.email && String(lead.email).includes("@");
      const hasPhone = !!normalizedPhone;
      const countryCode = guessCountryCode(normalizedPhone, lead.country);

      const enrichedPayload = {
        version: "v1",
        has_email: hasEmail,
        has_phone: hasPhone,
        normalized_phone: normalizedPhone,
        country_code: countryCode,
        // contexto útil para scoring futuro
        source: lead.source ?? null,
        niche: lead.niche ?? null,
        company_name: lead.company_name ?? null,
        contact_name: lead.contact_name ?? null,
        website: lead.website ?? null,
        city: lead.city ?? null,
        score_snapshot: lead.score ?? 0,
        status_snapshot: lead.status ?? null,
        created_at_snapshot: lead.created_at ?? null,
      };

      return {
        id: lead.id,
        enriched: enrichedPayload,
      };
    });

    // 3️⃣ Hacer UPDATE en bloque en leads (id → enriched)
    const { error: updateError } = await supabase
  .from("leads")
  .upsert(
    updates.map((u: any) => ({
      id: u.id,
      enriched: u.enriched,
      state: "enriched",
      updated_at: new Date().toISOString(),
    })),
    {
      onConflict: "id",
    },
  );

    if (updateError) {
      console.error("update leads enriched error", updateError);
      return new Response(
        JSON.stringify({
          ok: false,
          version: VERSION,
          error: "update_leads_enriched_failed",
          details: updateError.message,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        version: VERSION,
        processed: leads.length,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("unexpected error in run-enrichment", e);
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
