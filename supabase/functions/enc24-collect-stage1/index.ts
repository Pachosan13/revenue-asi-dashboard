import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Params = {
  account_id?: string;
  country?: string; // "PA"
  limit?: number; // listings per run
  maxPages?: number; // pages to scan (cron-safe)
  minYear?: number; // default 2014
  businessHoursOnly?: boolean; // default true
  startHour?: number; // default 8 (Panama time)
  endHour?: number; // default 19 (Panama time)
};

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function parseGa4Addata(html: string): Record<string, any> {
  // matches: ga4addata[31437579] = {...}</script>
  const re = /ga4addata\[(\d+)\]\s*=\s*(\{[\s\S]*?\})<\/script>/g;
  const out: Record<string, any> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = String(m[1]);
    const json = m[2];
    const parsed = safeJsonParse(json);
    if (parsed) out[id] = parsed;
  }
  return out;
}

function extractYear(s = ""): number | null {
  const m = String(s).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function looksTaxi(s = ""): boolean {
  const t = String(s).toLowerCase();
  return /taxi|ex\s*taxi|fue\s*taxi|cup\s*taxi|placa\s*taxi/.test(t);
}

function commercialScore(text = ""): number {
  const s = String(text || "").toLowerCase();
  let score = 0;
  const tokens = [
    "autos", "motors", "motor", "galería", "galeria", "dealer", "agencia",
    "financiamiento", "compramos", "vendemos",
    "s.a", "corp", "importadora", "showroom",
    "consignación", "consignacion", "ventas", "autolote",
    "rent a car", "rental", "flota", "stock",
  ];
  for (const t of tokens) if (s.includes(t)) score++;
  return score;
}

function buildUrl(page: number) {
  // Keep simple; Encuentra24 variations exist, but base page still yields many links.
  const base = "https://www.encuentra24.com/panama-es/autos-usados";
  if (!page || page <= 1) return base;
  return `${base}?page=${page}`;
}

function panamaHourNow(): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Panama",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const hh = parts.find((p) => p.type === "hour")?.value ?? "00";
  return Number(hh);
}

async function fetchHtml(url: string) {
  const res = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept-language": "es-PA,es;q=0.9,en;q=0.8",
    },
  });
  const html = await res.text();
  return { status: res.status, html };
}

function extractListingLinks(html: string) {
  const $ = cheerio.load(html);
  const links = new Map<string, string>();

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    if (!href.includes("/panama-es/autos-usados/")) return;
    if (!/\/\d{6,}$/.test(href)) return;

    const abs = href.startsWith("http") ? href : `https://www.encuentra24.com${href}`;
    const text = ($(a).text() || "").trim();
    if (!links.has(abs)) links.set(abs, text);
  });

  return [...links.entries()].map(([listing_url, listing_text]) => ({ listing_url, listing_text }));
}

function extractListingTileDetails(html: string): Record<string, any> {
  // Extract extra fields (best-effort) without making more HTTP requests.
  // We rely on:
  // - data-adid / data-price attributes on the tile
  // - ga4addata[...] blobs embedded in the HTML
  const $ = cheerio.load(html);
  const ga4 = parseGa4Addata(html);

  const out: Record<string, any> = {};

  $(".d3-ad-tile").each((_, el) => {
    const tile = $(el);
    const fav = tile.find("a.tool-favorite[data-adid]").first();
    const adid = String(fav.attr("data-adid") || "").trim();
    if (!adid) return;

    const priceStr = String(fav.attr("data-price") || "").replace(/[^\d]/g, "");
    const price = priceStr ? Number(priceStr) : null;

    const g = ga4[adid] || {};
    out[adid] = {
      // These keys are intentionally simple; the dispatcher maps them to the GHL payload.
      make: g?.f_make ?? null,
      model: g?.f_model ?? null,
      fuel: g?.f_fuel ?? null,
      trans: g?.f_trans ?? null,
      city: g?.location ?? null,
      feature: g?.feature ?? null,
      category: g?.category ?? null,
      price,
    };
  });

  return out;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ ok: false, error: "Use POST" }), {
        status: 405,
        headers: { "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as Params;
    const account_id = typeof body.account_id === "string" && body.account_id.trim() ? body.account_id.trim() : null;
    const country = String(body.country || "PA").toUpperCase();
    // Default to "soft" collection: 1–2 new listings per run.
    const limit = Math.max(1, Math.min(Number(body.limit ?? 2), 500));
    const maxPages = Math.max(1, Math.min(Number(body.maxPages ?? 1), 5));
    const minYear = Math.max(1990, Math.min(Number(body.minYear ?? 2014), 2035));
    const businessHoursOnly = body.businessHoursOnly !== false; // default true
    const startHour = Math.max(0, Math.min(Number(body.startHour ?? 8), 23));
    const endHour = Math.max(0, Math.min(Number(body.endHour ?? 19), 23));

    if (country !== "PA") {
      return new Response(JSON.stringify({ ok: false, error: "Only country=PA is supported in this function" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (businessHoursOnly) {
      const hh = panamaHourNow();
      // Run window: startHour <= hh < endHour
      if (!(hh >= startHour && hh < endHour)) {
        return new Response(
          JSON.stringify({
            ok: true,
            skipped: true,
            reason: "outside_business_hours",
            tz: "America/Panama",
            hour: hh,
            startHour,
            endHour,
            limit,
            maxPages,
            minYear,
          }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim() || Deno.env.get("PROJECT_URL")?.trim();
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() || Deno.env.get("SERVICE_ROLE_KEY")?.trim();

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Missing SUPABASE_URL/PROJECT_URL or SERVICE_ROLE_KEY" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    async function upsertStage1Safe(args: Record<string, unknown>) {
      // Backward compatible: if DB hasn't applied the new function signature yet,
      // retry without p_stage1_extra.
      const { error } = await supabase.schema("lead_hunter").rpc("upsert_enc24_listing_stage1", args as any);
      if (!error) return { ok: true as const };

      // Retry without extra (old signature)
      const retryArgs = { ...args } as Record<string, unknown>;
      delete retryArgs.p_stage1_extra;
      const { error: e2 } = await supabase.schema("lead_hunter").rpc("upsert_enc24_listing_stage1", retryArgs as any);
      if (!e2) return { ok: true as const, fallback: true as const };

      return { ok: false as const, error: error.message, error2: e2.message };
    }

    let total_seen = 0;
    let upserted = 0;
    let filtered_old = 0;
    let filtered_taxi = 0;
    let filtered_commercial = 0;

    const seen = new Set<string>();

    for (let p = 1; p <= maxPages; p++) {
      const url = buildUrl(p);
      const { status, html } = await fetchHtml(url);
      if (status !== 200) break;

      const tileDetailsById = extractListingTileDetails(html);
      const links = extractListingLinks(html);
      for (const it of links) {
        if (seen.size >= limit) break;
        if (seen.has(it.listing_url)) continue;
        seen.add(it.listing_url);

        total_seen++;

        const year = extractYear(it.listing_text);
        if (year && year < minYear) { filtered_old++; continue; }
        if (looksTaxi(it.listing_text)) { filtered_taxi++; continue; }
        if (commercialScore(it.listing_text) >= 3) { filtered_commercial++; continue; }

        const listingIdMatch = String(it.listing_url).match(/\/(\d{6,})\b/);
        const listingId = listingIdMatch ? String(listingIdMatch[1]) : null;
        const extra = listingId ? (tileDetailsById[listingId] ?? null) : null;
        const stage1_extra = {
          external_id: listingId,
          year,
          ...(extra ?? {}),
        };

        const seenAt = new Date().toISOString();
        const r = await upsertStage1Safe({
          p_account_id: account_id,
          p_listing_url: it.listing_url,
          p_listing_text: it.listing_text,
          p_page: p,
          p_seen_at: seenAt,
          p_stage1_extra: stage1_extra,
        });

        if (r.ok) upserted++;
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      country,
      limit,
      maxPages,
      minYear,
      total_seen,
      upserted,
      filtered_old,
      filtered_taxi,
      filtered_commercial,
    }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String((e as any)?.message ?? e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});


