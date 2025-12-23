// worker/lead-hunter.mjs
// Run:
//   export SUPABASE_URL="https://cdrrlkxgurckuyceiguo.supabase.co"
//   export SUPABASE_SERVICE_ROLE_KEY="..."
//   export WORKER_ID="local-dev-1"
//   node worker/lead-hunter.mjs
//
// Debug (specific job):
//   export JOB_ID="uuid"
//   node worker/lead-hunter.mjs

import * as cheerio from "cheerio";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_ID = process.env.WORKER_ID || "local-dev-1";
const JOB_ID = process.env.JOB_ID || null;

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

// =====================
// Encuentra24 URL builder
// =====================
// Base:  https://www.encuentra24.com/panama-es/autos-usados
// Pages: /autos-usados.2, /autos-usados.3, ...
function buildEncuentra24Url({ page }) {
  const base = "https://www.encuentra24.com/panama-es/autos-usados";
  return page && page > 1 ? `${base}.${page}` : base;
}

// =====================
// Dealer filter (solo personas naturales)
// =====================
function isLikelyBusinessName(s) {
  if (!s) return false;
  const x = s.toLowerCase().replace(/\s+/g, " ").trim();
  const bad = [
    "motors",
    "autos",
    "auto ",
    "carspot",
    "galería",
    "galeria",
    "ventas",
    "venta",
    "dealer",
    "agencia",
    "showroom",
    "online",
    "s.a",
    "s.a.",
    " sa ",
    "inc",
    "ltd",
    "corp",
    "company",
    "comercial",
    "importadora",
    "multimarca",
    "sucursal",
    "financiamiento disponible",
    "aceptamos trade-in",
    "trade-in",
  ];
  return bad.some((k) => x.includes(k));
}

// =====================
// Parser helpers
// =====================
function parseGa4Addata(html) {
  // match: ga4addata[31437579] = {...};
  const re = /ga4addata\[(\d+)\]\s*=\s*(\{.*?\});/gs;
  const out = {};
  let m;
  while ((m = re.exec(html))) {
    const id = Number(m[1]);
    const json = m[2];
    try {
      out[id] = JSON.parse(json);
    } catch {}
  }
  return out;
}

function text1($node) {
  const t = $node.text();
  return t ? t.replace(/\s+/g, " ").trim() : "";
}

function parseEncuentra24Listings(html, country = "PA") {
  const $ = cheerio.load(html);
  const ga4 = parseGa4Addata(html);

  const rows = [];

  $(".d3-ad-tile").each((_, el) => {
    const tile = $(el);

    // link al detalle (contiene external_id al final)
    const link = tile.find("a.d3-ad-tile__description").first();
    const href = link.attr("href");
    if (!href) return;

    const idMatch = href.match(/\/(\d{6,8})$/);
    if (!idMatch) return;

    const external_id = idMatch[1];

    // seller / location (lo guardamos para filtro y raw)
    const sellerRaw = text1(tile.find(".d3-ad-tile__seller").first()) || null;

    // FILTRO: NO comercios
    if (sellerRaw && isLikelyBusinessName(sellerRaw)) return;

    // title limpio: primero el title node, luego fallback al link text
    const title =
      text1(tile.find(".d3-ad-tile__title").first()) ||
      text1(link) ||
      null;

    // price
    const priceStr =
      tile.find("a.tool-favorite[data-price]").first().attr("data-price") ||
      tile.find("[data-price]").first().attr("data-price") ||
      null;
    const price = priceStr ? String(priceStr).replace(/[^\d]/g, "") : null;

    const g = ga4[Number(external_id)] || {};

    // city: si GA4 trae location ok; si no, intenta inferir de sellerRaw (a veces incluye zona)
    const city =
      (g.location ? String(g.location) : null) ||
      null;

    rows.push({
      external_id,
      title,
      url: `https://www.encuentra24.com${href}`,
      price,
      city,
      country,
      raw: {
        ga4: g,
        seller: sellerRaw,
      },
    });
  });

  // dedup por external_id
  const map = new Map();
  for (const r of rows) map.set(r.external_id, r);
  return [...map.values()];
}

// =====================
// Supabase helpers
// =====================
async function postgrestRpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${fn} ${res.status}: ${txt}`);
  }

  const data = await res.json().catch(() => null);
  if (!data) return null;
  if (Array.isArray(data)) return data[0] ?? null;
  return data;
}

async function patchJob(jobId, patch) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/jobs?id=eq.${jobId}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "Accept-Profile": "lead_hunter",
      "Content-Profile": "lead_hunter",
    },
    body: JSON.stringify(patch),
  });

  if (!res.ok) throw new Error(`update job ${res.status}: ${await res.text()}`);
  const rows = await res.json();
  return rows?.[0] ?? null;
}

async function insertLeads(job, listings) {
  if (!listings.length) return 0;

  const payload = listings.map((l) => ({
    job_id: job.id,
    account_id: job.account_id,
    source: job.source,
    niche: job.niche,
    external_id: l.external_id,
    title: l.title,
    url: l.url,
    price: l.price,
    city: l.city,
    country: l.country,
    raw: l.raw,
  }));

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?on_conflict=account_id,source,external_id`,
    {
      method: "POST",
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
        "Accept-Profile": "lead_hunter",
        "Content-Profile": "lead_hunter",
      },
      body: JSON.stringify(payload),
    }
  );

  if (!res.ok) throw new Error(`insert leads ${res.status}: ${await res.text()}`);

  const data = await res.json().catch(() => []);
  return Array.isArray(data) ? data.length : 0;
}

// =====================
// Batch runner (cursor = page)
// =====================
async function runBatch(job, page, pagesPerBatch = 1) {
  let totalFound = 0;
  let totalInserted = 0;

  let currentPage = page;
  let hasMore = true;

  for (let i = 0; i < pagesPerBatch; i++) {
    const url = buildEncuentra24Url({ page: currentPage });

    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html",
      },
    });

    if (!res.ok) throw new Error(`fetch encuentra24 ${res.status} page=${currentPage}`);

    const html = await res.text();
    const listings = parseEncuentra24Listings(html, job.geo?.country || "PA");

    totalFound += listings.length;
    totalInserted += await insertLeads(job, listings);

    hasMore = listings.length > 0;
    currentPage += 1;

    if (!hasMore) break;
  }

  return {
    found: totalFound,
    inserted: totalInserted,
    nextCursor: currentPage,
    done: !hasMore,
  };
}

// =====================
// Main
// =====================
async function main() {
  let job = null;

  if (JOB_ID) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/jobs?select=*&id=eq.${JOB_ID}&limit=1`,
      {
        headers: {
          apikey: SERVICE_ROLE_KEY,
          Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
          "Accept-Profile": "lead_hunter",
        },
      }
    );
    if (!res.ok) throw new Error(`load job ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    job = rows?.[0] ?? null;

    if (!job) {
      console.log("JOB_ID provided but not found:", JOB_ID);
      return;
    }
  } else {
    job = await postgrestRpc("claim_next_job", {
      p_worker_id: WORKER_ID,
      p_source: "encuentra24",
      p_niche: "autos",
    });

    if (!job || !job.id) {
      console.log("No job claimed. Exiting clean.");
      return;
    }
  }

  console.log("START", job.id, "cursor(page)=", job.cursor);

  let cursor = Number(job.cursor) || 1;
  if (cursor < 1) cursor = 1;

  let totalFound = 0;
  let totalInserted = 0;

  try {
    // 1 página por batch x 3 iteraciones (ajusta luego)
    for (let i = 0; i < 3; i++) {
      const { found, inserted, nextCursor, done } = await runBatch(job, cursor, 1);

      totalFound += found;
      totalInserted += inserted;

      console.log(
        `batch ${i + 1}: page=${cursor} found=${found} inserted=${inserted} next=${nextCursor}`
      );

      await patchJob(job.id, {
        last_heartbeat_at: new Date().toISOString(),
        cursor: nextCursor,
        progress: {
          cursor: nextCursor,
          leads_found: totalFound,
          leads_inserted: totalInserted,
          last_page_processed: cursor,
        },
      });

      cursor = nextCursor;
      if (done) break;
    }

    const finished = await patchJob(job.id, {
      status: "done",
      error: null,
      updated_at: new Date().toISOString(),
      progress: {
        cursor,
        leads_found: totalFound,
        leads_inserted: totalInserted,
      },
    });

    console.log("FINISH", finished?.id || job.id, "done");
  } catch (err) {
    const msg = String(err?.message || err);
    console.error("WORKER ERROR:", msg);

    if (job?.id) {
      await patchJob(job.id, {
        status: "error",
        error: msg,
        updated_at: new Date().toISOString(),
      });
    }

    process.exit(1);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
