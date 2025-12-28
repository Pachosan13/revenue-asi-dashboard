import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  job_id: string;
  batch_size?: number; // how many queries to run per call
  dry_run?: boolean; // optional override
};

function buildQueries(country: string, cities: string[], keywords: string[]) {
  const out: { keyword: string; city: string; query: string }[] = [];
  for (const kw of keywords) {
    for (const city of cities) {
      out.push({
        keyword: kw,
        city,
        query: `${kw} ${city}, ${country}`,
      });
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
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Outscraper ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function toHex(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += b.toString(16).padStart(2, "0");
  return s;
}

async function deterministicId(seed: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return `dry_${toHex(hash).slice(0, 48)}`; // short & stable
}

/**
 * ✅ DRY RUN FIX:
 * - each place MUST produce a unique domain, otherwise domains collapse to 1 row.
 * - we generate a deterministic place_id per query, then create:
 *   website = https://dry-<shortid>.example.com/<niche>/<city>
 *   domain = dry-<shortid>.example.com
 */
async function makeDryRunPlaces(query: string, niche: string, city: string, country: string) {
  const seed = `${niche}:${city}:${country}:${query}`;
  const place_id = await deterministicId(seed);

  const short = place_id.replace(/^dry_/, "").slice(0, 10); // stable short token
  const domain = `dry-${short}.example.com`;
  const website = `https://${domain}/${encodeURIComponent(niche)}/${encodeURIComponent(city)}`.toLowerCase();

  return [
    {
      place_id,
      name: `DRY RUN ${niche} ${city}`,
      phone: null,
      website,
      address: `Dry Address, ${city}, ${country}`,
      city,
      state: null,
      postal_code: null,
      lat: null,
      lng: null,
      rating: null,
      reviews_count: null,
      category: niche,
      maps_url: null,
      raw_payload: {
        __dry_run: true,
        __query: query,
        __niche: niche,
        __city: city,
        __country: country,
        __dry_domain: domain,
      },
    },
  ];
}

function parseGeo(geo: string) {
  // expected "USA|Miami,Orlando" or "USA|Miami"
  const raw = String(geo || "").trim();
  const [countryPart, citiesPart] = raw.includes("|") ? raw.split("|", 2) : [raw, ""];
  const country = (countryPart || "USA").trim() || "USA";
  const cities = (citiesPart || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return { country, cities };
}

// -------- RPC-only helpers (NO direct schema access) --------
async function rpcGetJob(supabase: any, job_id: string) {
  const { data, error } = await supabase.rpc("lh_get_job", { p_job_id: job_id });
  if (error) throw error;
  return data as any; // expected jsonb of lead_hunter.jobs row
}

async function rpcPatchJob(supabase: any, job_id: string, patch: { status?: string; meta?: any }) {
  const { data, error } = await supabase.rpc("lh_patch_job", {
    p_job_id: job_id,
    p_status: patch.status ?? null,
    p_meta: patch.meta ?? null,
  });
  if (error) throw error;
  return data as any; // returns jsonb
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

    const batchSize = Math.max(1, Math.min(body.batch_size ?? 3, 10));

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    const OUTSCRAPER_API_KEY = (Deno.env.get("OUTSCRAPER_API_KEY") || "").trim();

    console.log("ENV_CHECK", {
      SUPABASE_URL,
      hasServiceRole: Boolean(SERVICE_ROLE_KEY),
      serviceRolePrefix: SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY.slice(0, 12) : null,
      hasOutscraper: Boolean(OUTSCRAPER_API_KEY),
    });

    // service role key for RPC + upsert rpc
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch } });

    // --- job load via RPC ---
    const jobRow = await rpcGetJob(supabase, job_id);
    if (!jobRow) throw new Error("Job not found");

    const meta = (jobRow.meta ?? {}) as any;

    // Source of truth is columns, meta optional override
    const niche: string = String(meta.niche ?? jobRow.niche ?? "").trim();
    const geo: string = String(meta.geo ?? jobRow.geo ?? "").trim();
    const keywords: string[] = Array.isArray(meta.keywords)
      ? meta.keywords
      : Array.isArray(jobRow.keywords)
        ? jobRow.keywords
        : [];

    if (!niche) throw new Error("jobs.niche is required");
    if (!geo) throw new Error("jobs.geo is required (ex: 'USA|Miami')");
    if (!keywords.length) throw new Error("jobs.keywords is required (text[])");

    const { country, cities } = parseGeo(geo);
    if (!cities.length) throw new Error(`jobs.geo has no cities. Expected 'COUNTRY|City1,City2' got: ${geo}`);

    // limit per query
    const hardLimit = Number(meta.limit_per_query ?? 0);
    const targetLeads = Number(jobRow.target_leads ?? 2000);
    const limitPerQuery = hardLimit > 0 ? hardLimit : Math.max(10, Math.min(200, Math.floor(targetLeads / 5)));

    const plan = buildQueries(country, cities, keywords);
    const total = plan.length;

    // progress
    const progress = (meta.progress ?? {}) as any;
    let cursor = Number(progress.cursor ?? 0);

    const dryRun = Boolean(body.dry_run ?? false) || !OUTSCRAPER_API_KEY;

    // init job running state if missing
    if (!progress.total || Number.isNaN(Number(progress.total))) {
      const newMeta = {
        ...meta,
        niche,
        geo,
        keywords,
        limit_per_query: limitPerQuery,
        progress: {
          total,
          done: 0,
          cursor: 0,
          inserted_places: 0,
          inserted_domains: 0,
          errors: [],
          dry_run: dryRun,
        },
      };

      await rpcPatchJob(supabase, job_id, { status: "running", meta: newMeta });
      cursor = 0;
    }

    if (cursor >= total) {
      return new Response(JSON.stringify({ ok: true, status: "done", cursor, total, dry_run: dryRun }), {
        headers: { "content-type": "application/json" },
      });
    }

    let done = Number(progress.done ?? 0);
    let insertedPlaces = Number(progress.inserted_places ?? 0);
    let insertedDomains = Number(progress.inserted_domains ?? 0);
    const errors: any[] = Array.isArray(progress.errors) ? progress.errors : [];

    const slice = plan.slice(cursor, cursor + batchSize);

    for (const item of slice) {
      const { query, keyword, city } = item;

      let attempt = 0;
      let ok = false;

      while (attempt < 3 && !ok) {
        attempt++;
        try {
          let places: any[] = [];

          if (dryRun) {
            places = await makeDryRunPlaces(query, niche, city, country);
          } else {
            const json = await outscraperSearch(OUTSCRAPER_API_KEY, query, limitPerQuery);

            const rws: any[] =
              Array.isArray(json) ? json.flat()
                : Array.isArray(json?.data) ? json.data
                : Array.isArray(json?.results) ? json.results
                : [];

            places = rws
              .filter((r) => r?.place_id && r?.name)
              .map((r) => ({
                place_id: String(r.place_id),
                name: r.name ?? null,
                phone: r.phone ?? null,
                website: r.site ?? null,
                address: r.full_address ?? null,
                city,
                state: null,
                postal_code: null,
                lat: r.latitude ?? null,
                lng: r.longitude ?? null,
                rating: r.rating ?? null,
                reviews_count: r.reviews ?? null,
                category: r.category ?? niche,
                maps_url: r.google_maps_url ?? null,
                raw_payload: {
                  ...r,
                  __query: query,
                  __niche: niche,
                  __keyword: keyword,
                  __city: city,
                  __country: country,
                },
              }));
          }

          if (places.length) {
            const { data: upRes, error: upErr } = await supabase.rpc("lh_upsert_places_and_domains", {
              p_places: places,
            });
            if (upErr) throw upErr;

            insertedPlaces += Number((upRes as any)?.inserted_places ?? 0);
            insertedDomains += Number((upRes as any)?.inserted_domains ?? 0);
          }

          ok = true;
        } catch (e) {
          const msg = String((e as any)?.message ?? e);
          if (attempt >= 3) {
            errors.push({ query, niche, keyword, city, attempt, error: msg, dry_run: dryRun });
          } else {
            await sleep(400 * attempt);
          }
        }
      }

      done++;
      cursor++;
    }

    const isDone = cursor >= total;

    const newMeta = {
      ...meta,
      niche,
      geo,
      keywords,
      limit_per_query: limitPerQuery,
      progress: {
        total,
        done,
        cursor,
        inserted_places: insertedPlaces,
        inserted_domains: insertedDomains,
        errors,
        dry_run: dryRun,
      },
    };

    await rpcPatchJob(supabase, job_id, {
      status: isDone ? (errors.length ? "failed" : "done") : "running",
      meta: newMeta,
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
        dry_run: dryRun,
        next_call: isDone ? null : { job_id, batch_size: batchSize, dry_run: dryRun },
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
