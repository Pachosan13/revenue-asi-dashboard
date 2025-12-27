// worker/run-encuentra24-live.mjs
import * as cheerio from "cheerio";
import { resolveEncuentra24PhoneFromListing } from "./providers/phone-resolver/encuentra24_whatsapp_resolver.mjs";

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

// scoring simple (no lo hagas agresivo o te quedas sin volumen)
function commercialScore(sellerName = "", listingText = "") {
  const s = `${sellerName}\n${listingText}`.toLowerCase();
  let score = 0;

  const tokens = [
    "autos","motors","motor","galería","galeria","dealer","agencia",
    "financiamiento","financiación","compramos","vendemos",
    "s.a","s.a.","corp","importadora","showroom","garantía","garantia",
    "consignación","consignacion","ventas","autolote","verified","verificado",
    "rent a car","rental","flota","stock"
  ];
  for (const t of tokens) if (s.includes(t)) score++;
  if (sellerName.includes(",") || sellerName.toLowerCase().includes("s.a")) score++;

  return score;
}

async function fetchHtml(url) {
  const r = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      "accept-language": "es-PA,es;q=0.9,en;q=0.8",
    },
  });
  const html = await r.text();
  return { status: r.status, html };
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
    if (t === "siguiente" || t.includes("siguiente")) {
      const href = $(a).attr("href");
      if (href) nextHref = href;
    }
  });

  if (!nextHref) return null;
  if (nextHref.startsWith("http")) return nextHref;
  return `${baseHost}${nextHref}`;
}

// ---- Supabase RPC (Service Role) ----
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE || "";

async function supabaseUpsertLead(p) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE");
  }
  const url = `${SUPABASE_URL}/rest/v1/rpc/lh_upsert_lead`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "apikey": SUPABASE_SERVICE_ROLE,
      "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ p }),
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`RPC ${res.status}: ${txt}`);
  return txt ? JSON.parse(txt) : null;
}

// ---- main ----
const args = process.argv.slice(2);
const headed = args.includes("--headed");

const limit = Number(parseArg("--limit", "30"));
const maxPages = Number(parseArg("--maxPages", "3"));
const minYear = Number(parseArg("--minYear", "2014"));
const saveShots = Number(parseArg("--saveShots", "0"));

// form identity (para habilitar reveal)
const email = parseArg("--email", "pacho@pachosanchez.com");
const name = parseArg("--name", "lapsa");
const phone8 = parseArg("--phone8", "67777777");
const message = parseArg("--message", "Hola, me interesa. ¿Sigue disponible?");

// delays (NO toques el resolver, ajusta esto si hace falta)
const afterFillMs = Number(parseArg("--afterFillMs", "700"));
const afterClickCallMs = Number(parseArg("--afterClickCallMs", "900"));
const waitTelMaxMs = Number(parseArg("--waitTelMaxMs", "12000"));
const typingDelayMs = Number(parseArg("--typingDelayMs", "80"));
const waitPhoneInputMs = Number(parseArg("--waitPhoneInputMs", "6500"));

const baseHost = "https://www.encuentra24.com";
let pageUrl = "https://www.encuentra24.com/panama-es/autos-usados";

let totalProcessed = 0, ok = 0, failed = 0, filteredTaxi = 0, filteredOld = 0, filteredCommercial = 0;

const results = [];
const seenListings = new Set();
const seenSellerProfiles = new Set();

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

    const r = await resolveEncuentra24PhoneFromListing(it.url, {
      enable_stage2: true,
      headless: !headed,
      prefer: "call_first",
      saveShots,
      delays: { afterFillMs, afterClickCallMs, waitTelMaxMs, typingDelayMs, waitPhoneInputMs },
      form: { email, name, phone8, message },
    });

    // dedupe por seller_profile_url (reduce spam dealers)
    if (r?.seller_profile_url) {
      if (seenSellerProfiles.has(r.seller_profile_url)) continue;
      seenSellerProfiles.add(r.seller_profile_url);
    }

    const score = commercialScore(r?.seller_name || "", it.text || "");
    const isCommercial = score >= 3;

    if (isCommercial) {
      filteredCommercial++;
      // opcional: guarda también comerciales (si quieres auditoría). Yo por defecto NO.
      results.push({
        ok: false,
        stage: 2,
        method: "filtered_commercial",
        listing_url: it.url,
        seller_name: r?.seller_name || null,
        seller_profile_url: r?.seller_profile_url || null,
        seller_address: r?.seller_address || null,
        phone_e164: null,
        wa_link: "",
        reason: `Filtrado: comercial/dealer (score=${score})`,
        debug: r?.debug || {},
      });
      continue;
    }

    // payload DB
    const payload = {
      source: "encuentra24",
      niche: "autos",
      listing_url: it.url,
      title: it.text || null,
      year: year || null,
      seller_name: r?.seller_name || null,
      seller_profile_url: r?.seller_profile_url || null,
      seller_address: r?.seller_address || null,
      phone_e164: r?.phone_e164 || null,
      wa_link: r?.wa_link || (r?.phone_e164 ? `https://wa.me/${String(r.phone_e164).replace("+","")}` : null),
      is_commercial: false,
      is_taxi: false,
      is_old: false,
      status: "new",
      debug: r?.debug || {},
      raw: r || {},
    };

    try {
      await supabaseUpsertLead(payload);
    } catch (e) {
      // no mates el loop por DB
      r.ok = false;
      r.reason = `DB upsert failed: ${e.message}`;
    }

    results.push({ ...r, listing_url: it.url });

    if (r.ok) ok++;
    else failed++;

    await sleep(250);
  }

  if (results.length >= limit) break;

  const next = extractNextPageUrl(html, baseHost);
  if (!next) break;
  pageUrl = next;
}

console.log("\n[FINAL] ✅ DONE");
console.log(JSON.stringify({
  total_processed: totalProcessed,
  ok,
  filtered_commercial: filteredCommercial,
  filtered_taxi: filteredTaxi,
  filtered_old: filteredOld,
  failed,
  shots_dir: saveShots ? "check /tmp/enc24shots_*" : null,
}, null, 2));

console.log("\n[JSON]");
console.log(JSON.stringify(results, null, 2));
