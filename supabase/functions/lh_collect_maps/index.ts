import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  job_id: string;
  batch_size?: number; // how many queries to run per call
};

function buildQueries(country: string, cities: string[], niches: string[]) {
  const templates: Record<string, string[]> = {
    roofers: [
      "roofer {city}, {country}",
      "roofing company {city}, {country}",
      "roof repair {city}, {country}",
      "roof replacement {city}, {country}",
    ],
    medspa: [
      "med spa {city}, {country}",
      "medical spa {city}, {country}",
      "botox {city}, {country}",
      "laser hair removal {city}, {country}",
    ],
  };

  const out: { niche: string; city: string; query: string }[] = [];
  for (const niche of niches) {
    const ts = templates[niche] ?? [];
    for (const city of cities) {
      for (const t of ts) {
        out.push({
          niche,
          city,
          query: t.replace("{city}", city).replace("{country}", country),
        });
      }
    }
  }
  return out;
}

async function outscraperSearch(apiKey: string, query: string, limit: number) {
  const fields = [
    "place_id",
    "name",
    "full_address",
    "site",
    "phone",
    "category",
    "rating",
    "reviews",
    "latitude",
    "longitude",
    "google_maps_url",
  ].join(",");

  const url = new URL("https://api.app.outscraper.com/maps/search-v2");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("async", "false");
  url.searchParams.set("fields", fields);

  const res = await fetch(url.toString(), { headers: { "X-API-KEY": apiKey } });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Outscraper ${res.status}: ${t}`);
  }
  return await res.json();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });

    const body = (await req.json()) as ReqBody;
    const job_id = body.job_id;
    const batchSize = Math.max(1, Math.min(body.batch_size ?? 3, 10)); // 3 default, cap 10

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const OUTSCRAPER_API_KEY = Deno.env.get("OUTSCRAPER_API_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: jobJson, error: jobErr } = await supabase.rpc("lh_get_job", { p_job_id: job_id });
    if (jobErr) throw jobErr;
    if (!jobJson) throw new Error("Job not found");

    const meta = (jobJson.meta ?? {}) as any;
    const country = meta.country ?? "USA";
    const cities: string[] = meta.cities ?? [];
    const niches: string[] = meta.niches ?? ["roofers", "medspa"];
    const limitPerQuery = meta.limit_per_query ?? 200;

    if (!cities.length) throw new Error("job.meta.cities is required (array)");

    const plan = buildQueries(country, cities, niches);
    const total = plan.length;

    const progress = meta.progress ?? {};
    let cursor = Number(progress.cursor ?? 0);

    // init running state if first call
    if (!progress.total) {
      await supabase.rpc("lh_job_update", {
        p_job_id: job_id,
        p_status: "running",
        p_meta: {
          ...meta,
          progress: {
            total,
            done: 0,
            cursor: 0,
            inserted_places: 0,
            inserted_domains: 0,
            errors: [],
          },
        },
      });
      cursor = 0;
    }

    // If already finished
    if (cursor >= total) {
      return new Response(JSON.stringify({ ok: true, status: "done", cursor, total }), {
        headers: { "content-type": "application/json" },
      });
    }

    let done = Number(progress.done ?? 0);
    let insertedPlaces = Number(progress.inserted_places ?? 0);
    let insertedDomains = Number(progress.inserted_domains ?? 0);
    const errors: any[] = Array.isArray(progress.errors) ? progress.errors : [];

    const slice = plan.slice(cursor, cursor + batchSize);

    for (const item of slice) {
      const { query, niche, city } = item;

      let attempt = 0;
      let ok = false;
      while (attempt < 3 && !ok) {
        attempt++;
        try {
          const json = await outscraperSearch(OUTSCRAPER_API_KEY, query, limitPerQuery);

          const rows: any[] =
            Array.isArray(json) ? json.flat() :
            Array.isArray(json?.data) ? json.data :
            Array.isArray(json?.results) ? json.results :
            [];

          const places = rows
            .filter((r) => r?.place_id && r?.name)
            .map((r) => ({
              place_id: String(r.place_id),
              name: r.name ?? null,
              phone: r.phone ?? null,
              website: r.site ?? null,
              address: r.full_address ?? null,
              city: null,
              state: null,
              postal_code: null,
              lat: r.latitude ?? null,
              lng: r.longitude ?? null,
              rating: r.rating ?? null,
              reviews_count: r.reviews ?? null,
              category: r.category ?? null,
              maps_url: r.google_maps_url ?? null,
              raw_payload: { ...r, __query: query, __niche: niche, __city: city, __country: country },
            }));

          if (places.length) {
            const { data: upRes, error: upErr } = await supabase.rpc("lh_upsert_places_and_domains", {
              p_places: places,
            });
            if (upErr) throw upErr;

            insertedPlaces += Number(upRes?.inserted_places ?? 0);
            insertedDomains += Number(upRes?.inserted_domains ?? 0);
          }

          ok = true;
        } catch (e) {
          if (attempt >= 3) {
            errors.push({ query, niche, city, attempt, error: String((e as any)?.message ?? e) });
          } else {
            await sleep(400 * attempt);
          }
        }
      }

      done++;
      cursor++;
    }

    const isDone = cursor >= total;

    await supabase.rpc("lh_job_update", {
      p_job_id: job_id,
      p_status: isDone ? (errors.length ? "failed" : "done") : "running",
      p_meta: {
        ...meta,
        progress: {
          total,
          done,
          cursor,
          inserted_places: insertedPlaces,
          inserted_domains: insertedDomains,
          errors,
        },
      },
    });

    return new Response(
      JSON.stringify({
        ok: true,
        status: isDone ? "done" : "running",
        batchSize,
        cursor,
        total,
        done,
        insertedPlaces,
        insertedDomains,
        errorsCount: errors.length,
        next_call: isDone ? null : { job_id, batch_size: batchSize },
      }),
      { headers: { "content-type": "application/json" } },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String((err as any)?.message ?? err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});
