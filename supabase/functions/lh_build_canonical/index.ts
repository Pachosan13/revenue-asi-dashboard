import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  niche: "roofers" | "medspa";
  geo: string; // e.g. "USA"
  min_rating?: number; // 4.0
  min_reviews?: number; // 10
  min_score?: number; // 70
  limit?: number; // safety
};

function score(p: any, minRating: number, minReviews: number) {
  let s = 0;
  const hasWebsite = !!p.website;
  const hasPhone = !!p.phone;

  if (hasWebsite) s += 35;
  if (hasPhone) s += 35;

  const ratingOk = p.rating != null && Number(p.rating) >= minRating;
  const reviewsOk = p.reviews_count != null && Number(p.reviews_count) >= minReviews;

  if (ratingOk) s += 15;
  if (reviewsOk) s += 15;

  const ready = (hasPhone || hasWebsite) && ratingOk && reviewsOk;
  return { s, ready };
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });

    const body = (await req.json()) as ReqBody;

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const minRating = body.min_rating ?? 4.0;
    const minReviews = body.min_reviews ?? 10;
    const minScore = body.min_score ?? 70;
    const limit = body.limit ?? 20000;

    const { data: places, error } = await supabase
      .from("lead_hunter.places_raw")
      .select("*")
      .limit(limit);
    if (error) throw error;

    const rows = (places ?? []).map((p) => {
      const { s, ready } = score(p, minRating, minReviews);
      return {
        place_id: p.place_id,
        domain: null,
        business_name: p.name ?? null,
        contact_name: null,
        title: null,
        email: null,
        phone: p.phone ?? null,
        niche: body.niche,
        geo: body.geo,
        completeness_score: s,
        ready_for_outreach: ready && s >= minScore,
        source: {
          provider: "outscraper_maps",
          website: p.website ?? null,
          maps_url: p.maps_url ?? null,
          rating: p.rating ?? null,
          reviews: p.reviews_count ?? null,
        },
      };
    });

    if (rows.length) {
      const { error: upErr } = await supabase
        .from("lead_hunter.leads_canonical")
        .upsert(rows, { onConflict: "place_id" });
      if (upErr) throw upErr;
    }

    return new Response(JSON.stringify({ ok: true, processed: rows.length }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as any)?.message ?? err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
