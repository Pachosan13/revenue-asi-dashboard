// worker/lead-hunter.mjs
import "dotenv/config";
import * as cheerio from "cheerio";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const WORKER_ID = process.env.WORKER_ID || "local-macbook-hunter";

if (!SUPABASE_URL) throw new Error("Missing SUPABASE_URL");
if (!SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

const SOURCE = "encuentra24";
const NICHE = "autos";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function log(msg, obj) {
  const ts = new Date().toISOString();
  if (obj !== undefined) console.log(`[${ts}] ${msg}`, obj);
  else console.log(`[${ts}] ${msg}`);
}

// ---------- RPC helper (solo public.lh_*) ----------
async function rpc(fn, body) {
  const url = `${SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body ?? {}),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // si no es JSON, igual lo devolvemos en error
  }

  if (!res.ok) {
    throw new Error(`RPC ${fn} failed ${res.status}: ${text}`);
  }
  return json;
}

// ---------- Encuentra24 parsing ----------
function isLikelyBusinessName(s) {
  if (!s) return false;
  const x = s.toLowerCase().replace(/\s+/g, " ").trim();
  const bad = [
    "motors",
    "autos",
    "auto ",
    "carspot",
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
    "trade-in",
    "venta",
    "ventas",
    "financiamiento",
  ];
  return bad.some((k) => x.includes(k));
}

function parseEncuentra24Listings(html, country = "PA") {
  const $ = cheerio.load(html);
  const rows = [];

  $(".d3-ad-tile").each((_, el) => {
    const tile = $(el);
    const link = tile.find("a.d3-ad-tile__description").first();
    const href = link.attr("href");
    if (!href) return;

    const idMatch = href.match(/\/(\d{6,8})$/);
    if (!idMatch) return;

    const external_id = idMatch[1];

    const title =
      tile.find(".d3-ad-tile__title").text().trim() ||
      link.text().trim() ||
      null;

    const sellerRaw = tile.find(".d3-ad-tile__seller").text().trim() || null;
    if (sellerRaw && isLikelyBusinessName(sellerRaw)) return;

    const price = (tile.find("[data-price]").attr("data-price") || "")
      .replace(/[^\d]/g, "")
      .trim();

    rows.push({
      external_id,
      title,
      url: `https://www.encuentra24.com${href}`,
      price: price || null,
      city: null,
      country,
      raw: { seller: sellerRaw },
    });
  });

  // dedupe por external_id
  const map = new Map();
  for (const r of rows) map.set(r.external_id, r);
  return [...map.values()];
}

async function fetchListPage() {
  const url = "https://www.encuentra24.com/panama-es/autos-usados";
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
  });
  if (!res.ok) throw new Error(`List fetch failed status=${res.status}`);
  return await res.text();
}

// ---------- Core flow ----------
async function claimJob() {
  // NOTA: este es el ÚNICO claim permitido
  return await rpc("lh_claim_next_job", {
    p_worker_id: WORKER_ID,
    p_source: SOURCE,
    p_niche: NICHE,
  });
}

async function heartbeat(jobId, patchMeta, status = "running") {
  // Mantén el job actualizado (esto NO cambia cursor column; solo meta + status)
  return await rpc("lh_update_job", {
    p_job_id: jobId,
    p_status: status,
    p_meta: patchMeta ?? {},
  });
}

async function upsertLeads(job, listings) {
  if (!Array.isArray(listings) || listings.length === 0) {
    return { inserted: 0 };
  }

  // IMPORTANT: public.lh_upsert_leads ignora p_job_id y lee job_id dentro del json,
  // así que lo incluimos por lead. (sin inventar schema)
  const payload = listings.map((l) => ({
    job_id: job.id,
    account_id: job.account_id,
    source: job.source || SOURCE,
    niche: job.niche || NICHE,
    external_id: l.external_id,
    title: l.title,
    url: l.url,
    price: l.price,
    city: l.city,
    country: l.country,
    raw: l.raw,
  }));

  return await rpc("lh_upsert_leads", {
    p_job_id: job.id,
    p_leads: payload,
  });
}

async function main() {
  log(`🤖 lead-hunter worker starting`, { worker_id: WORKER_ID, SOURCE, NICHE });

  // 1) claim
  const job = await claimJob();
  log("RPC RESULT (claim):", job);

  if (!job || !job.id) {
    log("💤 no job");
    return;
  }

  // sanity checks
  if ((job.source || SOURCE) !== SOURCE || (job.niche || NICHE) !== NICHE) {
    log("⚠️ claimed job mismatch", { job_source: job.source, job_niche: job.niche });
  }

  // 2) heartbeat start
  await heartbeat(job.id, {
    worker_id: WORKER_ID,
    last_heartbeat_at: new Date().toISOString(),
    phase: "fetch_list",
  });

  // 3) fetch list (WAO = page 1)
  const html = await fetchListPage();

  await heartbeat(job.id, {
    worker_id: WORKER_ID,
    last_heartbeat_at: new Date().toISOString(),
    phase: "parse_list",
  });

  // 4) parse
  const listings = parseEncuentra24Listings(html, job.geo?.country || "PA");
  log(`🔎 listings parsed`, { found: listings.length });

  // 5) upsert
  await heartbeat(job.id, {
    worker_id: WORKER_ID,
    last_heartbeat_at: new Date().toISOString(),
    phase: "upsert",
    found: listings.length,
  });

  const up = await upsertLeads(job, listings);
  log("✅ upsert result", up);

  // 6) done
  await heartbeat(job.id, {
    worker_id: WORKER_ID,
    last_heartbeat_at: new Date().toISOString(),
    phase: "done",
    found: listings.length,
    upsert: up,
  }, "done");

  log("🏁 done", { job_id: job.id });
}

main().catch((e) => {
  log("❌ FATAL", { error: String(e?.message || e) });
  process.exit(1);
});
