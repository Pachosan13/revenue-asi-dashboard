// supabase/functions/lh_collect_encuentra24_listings/index.ts
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Params = {
  page?: number;
  country?: string; // "PA"
  limit?: number;   // how many listings to process from the page(s)
  minYear?: number; // default 2014
  maxPages?: number; // default 1 (cron-safe)
};

function extractYear(s = ""): number | null {
  const m = String(s).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}

function looksTaxi(s = ""): boolean {
  const t = String(s).toLowerCase();
  return /taxi|ex\s*taxi|fue\s*taxi|cup\s*taxi|placa\s*taxi/.test(t);
}

function commercialScore(sellerName = "", listingText = ""): number {
  const s = `${sellerName}\n${listingText}`.toLowerCase();
  let score = 0;
  const tokens = [
    "autos","motors","motor","galería","galeria","dealer","agencia",
    "financiamiento","compramos","vendemos",
    "s.a","corp","importadora","showroom",
    "consignación","ventas","autolote",
    "rent a car","rental","flota","stock"
  ];
  for (const t of tokens) if (s.includes(t)) score++;
  if ((sellerName || "").toLowerCase().includes("s.a")) score++;
  return score;
}

function buildEncuentra24Url(page: number) {
  // Encuentra24 usa paginación por query o rutas; este collector es robusto:
  // Si page=1 usamos base. Si >1 intentamos agregar "?page=X" (si no funciona, igual parsea links de la página base).
  const base = "https://www.encuentra24.com/panama-es/autos-usados";
  if (!page || page <= 1) return base;
  return `${base}?page=${page}`;
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

function extractListingsFromSearch(html: string, baseHost: string) {
  const $ = cheerio.load(html);
  const links = new Map<string, string>();

  $("a[href]").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    if (!href.includes("/panama-es/autos-usados/")) return;
    if (!/\/\d{6,}$/.test(href)) return;

    const abs = href.startsWith("http") ? href : `${baseHost}${href}`;
    const text = ($(a).text() || "").trim();
    if (!links.has(abs)) links.set(abs, text);
  });

  return [...links.entries()].map(([url, text]) => ({ url, text }));
}

Deno.serve(async (req) => {
  try {
    const body = (req.method === "POST" ? await req.json().catch(() => ({})) : {}) as Params;

    const page = Number(body.page ?? 1);
    const limit = Number(body.limit ?? 30);
    const minYear = Number(body.minYear ?? 2014);
    const maxPages = Number(body.maxPages ?? 1);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("PROJECT_URL");
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SERVICE_ROLE_KEY");

    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing SUPABASE_URL/PROJECT_URL or SERVICE_ROLE_KEY in function env" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    const baseHost = "https://www.encuentra24.com";

    let inserted = 0;
    let upserted = 0;
    let filtered_taxi = 0;
    let filtered_old = 0;
    let filtered_commercial = 0;
    let total_seen = 0;

    const seen = new Set<string>();

    for (let p = page; p < page + maxPages; p++) {
      const url = buildEncuentra24Url(p);
      const { status, html } = await fetchHtml(url);
      if (status !== 200) break;

      const listings = extractListingsFromSearch(html, baseHost);
      for (const it of listings) {
        if (seen.size >= limit) break;
        if (seen.has(it.url)) continue;
        seen.add(it.url);

        total_seen++;

        const year = extractYear(it.text);
        if (year && year < minYear) { filtered_old++; continue; }
        if (looksTaxi(it.text)) { filtered_taxi++; continue; }

        // sellerName unknown at Stage1; score only by listing text for now (suave)
        const score = commercialScore("", it.text);
        const is_commercial = score >= 3;
        if (is_commercial) { filtered_commercial++; continue; }

        const row = {
          source: "encuentra24",
          niche: "autos",
          listing_url: it.url,
          title: null,
          year: year ?? null,
          seller_name: null,
          seller_profile_url: null,
          seller_address: null,
          phone_e164: null,
          wa_link: null,
          is_commercial: false,
          is_taxi: false,
          is_old: false,
          status: "new",
          raw: { stage: "stage1", listing_text: it.text, page: p, url },
          debug: { stage: "stage1" },
          last_seen_at: new Date().toISOString(),
        };

        // Upsert into lead_hunter.leads via Supabase client
        const { error } = await supabase
          .schema("lead_hunter")
          .from("leads")
          .upsert(row, { onConflict: "source,listing_url" });

        if (error) {
          // don't fail the whole batch for one bad row
          continue;
        }
        upserted++;
      }
    }

    // We can’t easily differentiate insert vs update without extra select; keep it simple:
    inserted = upserted;

    return new Response(
      JSON.stringify({
        ok: true,
        source: "encuentra24",
        niche: "autos",
        page,
        maxPages,
        limit,
        total_seen,
        inserted,
        upserted,
        filtered_old,
        filtered_taxi,
        filtered_commercial,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
