import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  job_id: string;
  min_rating?: number;
  min_reviews?: number;
  min_score?: number;
  limit?: number;
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

// --- RPC job read (avoid schema perms issues in edge runtime) ---
async function rpcGetJob(supabase: any, job_id: string) {
  const { data, error } = await supabase.rpc("lh_get_job", { p_job_id: job_id });
  if (error) throw error;
  return data as any; // jsonb row
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const job_id = String(body.job_id || "").trim();
    if (!job_id) {
      return new Response(JSON.stringify({ ok: false, error: "Missing job_id" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch } });
    const lh = supabase.schema("lead_hunter");

    const jobRow = await rpcGetJob(supabase, job_id);
    if (!jobRow) throw new Error("Job not found");

    const meta = (jobRow.meta ?? {}) as any;

    const niche: string = String(meta.niche ?? jobRow.niche ?? "").trim();
    const geo: string = String(meta.geo ?? jobRow.geo ?? "").trim();
    if (!niche) throw new Error("jobs.niche is required");
    if (!geo) throw new Error("jobs.geo is required");

    const minRating = body.min_rating ?? 4.0;
    const minReviews = body.min_reviews ?? 10;
    const minScore = body.min_score ?? 70;
    const limit = body.limit ?? 20000;

    // Pull places for this job only (dry-run uses raw_payload tags)
    const { data: places, error } = await lh
      .from("places_raw")
      .select("*")
      .eq("raw_payload->>__niche", niche)
      .eq("raw_payload->>__country", geo.split("|")[0] || "USA")
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
        niche,
        geo,
        completeness_score: s,
        ready_for_outreach: ready && s >= minScore,
        source: {
          provider: "maps",
          website: p.website ?? null,
          maps_url: p.maps_url ?? null,
          rating: p.rating ?? null,
          reviews: p.reviews_count ?? null,
          job_id,
        },
      };
    });

    if (rows.length) {
      const { error: upErr } = await lh
        .from("leads_canonical")
        .upsert(rows, { onConflict: "place_id" });
      if (upErr) throw upErr;
    }

    return new Response(JSON.stringify({ ok: true, processed: rows.length, niche, geo }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as any)?.message ?? err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
