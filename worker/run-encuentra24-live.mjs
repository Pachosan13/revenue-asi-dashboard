// worker/run-encuentra24-live.mjs
import * as cheerio from "cheerio";
import { resolveEncuentra24PhoneFromListing } from "./providers/phone-resolver/encuentra24_whatsapp_resolver.mjs";

/* =========================
   Utils
========================= */
function parseArg(name, def = null) {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return def;
  return a.split("=").slice(1).join("=");
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function extractYear(s = "") {
  const m = String(s).match(/\b(19\d{2}|20\d{2})\b/);
  return m ? Number(m[1]) : null;
}
function looksTaxi(s = "") {
  const t = String(s).toLowerCase();
  return /taxi|ex\s*taxi|fue\s*taxi|cup\s*taxi|placa\s*taxi/.test(t);
}

/* =========================
   Commercial score (SUAVE)
========================= */
function commercialScore(sellerName = "", listingText = "") {
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

/* =========================
   HTML helpers
========================= */
async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept-language": "es-PA,es;q=0.9,en;q=0.8",
    },
  });
  return { status: r.status, html: await r.text() };
}

function extractListingsFromSearch(html, baseHost) {
  const $ = cheerio.load(html);
  const links = new Map();

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

function extractNextPageUrl(html, baseHost) {
  const $ = cheerio.load(html);
  let nextHref = null;

  $("a").each((_, a) => {
    const t = ($(a).text() || "").trim().toLowerCase();
    if (t.includes("siguiente")) {
      const href = $(a).attr("href");
      if (href) nextHref = href;
    }
  });

  if (!nextHref) return null;
  return nextHref.startsWith("http") ? nextHref : `${baseHost}${nextHref}`;
}

/* =========================
   Supabase (lead_hunter schema via PostgREST)
========================= */
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SERVICE_ROLE_KEY ||
  "";

function lhHeaders() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    throw new Error(
      "Missing SUPABASE_URL or service role key (SUPABASE_SERVICE_ROLE_KEY | SUPABASE_SERVICE_ROLE | SERVICE_ROLE_KEY)"
    );
  }
  return {
    apikey: SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    "Content-Profile": "lead_hunter",
    "Accept-Profile": "lead_hunter",
  };
}

// Upsert by (source, listing_url) unique index exists: leads_source_listing_url_ux
async function upsertLeadRow(row) {
  const headers = lhHeaders();
  const url = `${SUPABASE_URL}/rest/v1/leads?on_conflict=source,listing_url`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headers,
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!res.ok) throw new Error(await res.text());
}

/* =========================
   Main config
========================= */
const args = process.argv.slice(2);
const headed = args.includes("--headed");

const limit = Number(parseArg("--limit", "30"));
const maxPages = Number(parseArg("--maxPages", "3"));
const minYear = Number(parseArg("--minYear", "2014"));
const saveShots = Number(parseArg("--saveShots", "0"));

const email = parseArg("--email", "pacho@pachosanchez.com");
const name = parseArg("--name", "pacho");
const phone8 = parseArg("--phone8", "67777777");
const message = parseArg("--message", "Hola, me interesa. ¿Sigue disponible?");

// 🔥 CLAVE ANTI-BOT
const MAX_REVEALS_PER_RUN = 5;
let revealsDone = 0;

const baseHost = "https://www.encuentra24.com";
let pageUrl = `${baseHost}/panama-es/autos-usados`;

/* =========================
   State
========================= */
let totalProcessed = 0, ok = 0, failed = 0;
let filteredTaxi = 0, filteredOld = 0, filteredCommercial = 0;

const results = [];
const seenListings = new Set();
const seenSellerProfiles = new Set();

/* =========================
   Loop
========================= */
for (let pageNum = 1; pageNum <= maxPages; pageNum++) {
  const { status, html } = await fetchHtml(pageUrl);
  if (status !== 200) break;

  const listings = extractListingsFromSearch(html, baseHost);

  for (const it of listings) {
    if (results.length >= limit) break;
    if (seenListings.has(it.url)) continue;
    seenListings.add(it.url);

    const year = extractYear(it.text);
    if (year && year < minYear) { filteredOld++; continue; }
    if (looksTaxi(it.text)) { filteredTaxi++; continue; }

    totalProcessed++;

    // 🚫 Reveal budget reached → defer (pero igual podemos guardar lead básico sin phone)
    if (revealsDone >= MAX_REVEALS_PER_RUN) {
      const row = {
        source: "encuentra24",
        niche: "autos",
        listing_url: it.url,
        title: null,
        year: year || null,
        seller_name: null,
        seller_profile_url: null,
        seller_address: null,
        phone_e164: null,
        wa_link: null,
        is_commercial: false,
        is_taxi: false,
        is_old: false,
        status: "new",
        raw: { deferred: true, reason: "Deferred to avoid anti-bot" },
        debug: { method: "pending_reveal" },
      };

      try { await upsertLeadRow(row); } catch (_) {}
      results.push({
        ok: false,
        method: "pending_reveal",
        listing_url: it.url,
        reason: "Deferred to avoid anti-bot",
      });
      continue;
    }

    const r = await resolveEncuentra24PhoneFromListing(it.url, {
      headless: !headed,
      saveShots,
      form: { email, name, phone8, message },
    });

    if (r?.seller_profile_url) {
      if (seenSellerProfiles.has(r.seller_profile_url)) continue;
      seenSellerProfiles.add(r.seller_profile_url);
    }

    const score = commercialScore(r?.seller_name || "", it.text || "");
    if (score >= 3) {
      filteredCommercial++;
      const row = {
        source: "encuentra24",
        niche: "autos",
        listing_url: it.url,
        title: null,
        year: year || r?.year || null,
        seller_name: r?.seller_name || null,
        seller_profile_url: r?.seller_profile_url || null,
        seller_address: r?.seller_address || null,
        phone_e164: null,
        wa_link: r?.wa_link || null,
        is_commercial: true,
        is_taxi: false,
        is_old: false,
        status: "new",
        raw: r || {},
        debug: { method: "filtered_commercial", score },
      };
      try { await upsertLeadRow(row); } catch (_) {}
      results.push({ ok:false, method:"filtered_commercial", listing_url: it.url });
      continue;
    }

    if (r?.ok) revealsDone++;

    const row = {
      source: "encuentra24",
      niche: "autos",
      listing_url: it.url,
      title: r?.title || null,
      year: year || r?.year || null,
      seller_name: r?.seller_name || null,
      seller_profile_url: r?.seller_profile_url || null,
      seller_address: r?.seller_address || null,
      phone_e164: r?.phone_e164 || null,
      wa_link: r?.wa_link || null,
      is_commercial: false,
      is_taxi: false,
      is_old: false,
      status: "new",
      raw: r || {},
      debug: { method: r?.method || "stage2" },
    };

    try {
      await upsertLeadRow(row);
    } catch (e) {
      r.ok = false;
      r.reason = `DB upsert failed: ${e.message}`;
    }

    results.push({ ...r, listing_url: it.url });
    r?.ok ? ok++ : failed++;

    await sleep(300); // humano
  }

  if (results.length >= limit) break;
  const next = extractNextPageUrl(html, baseHost);
  if (!next) break;
  pageUrl = next;
}

/* =========================
   Output
========================= */
console.log("\n[FINAL] ✅ DONE");
console.log(JSON.stringify({
  total_processed: totalProcessed,
  ok,
  pending: results.filter(r => r.method === "pending_reveal").length,
  filtered_commercial: filteredCommercial,
  filtered_taxi: filteredTaxi,
  filtered_old: filteredOld,
  failed,
}, null, 2));

console.log("\n[JSON]");
console.log(JSON.stringify(results, null, 2));
