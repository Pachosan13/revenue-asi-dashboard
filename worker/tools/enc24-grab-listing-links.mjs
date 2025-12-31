import { chromium } from "playwright";
import fs from "node:fs/promises";

const CATEGORY_URL =
  process.env.CATEGORY_URL ||
  "https://www.encuentra24.com/panama-es/autos-usados";

const OUT = process.env.OUT || "/tmp/enc24_links.txt";
const LIMIT = Number(process.env.LIMIT || "20");
const HEADLESS = String(process.env.HEADLESS || "0") === "1";

// Queremos: links de detalle, NO searchresult
function normalize(u) {
  if (!u) return null;
  try {
    const url = new URL(u, "https://www.encuentra24.com");
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return null;
  }
}

function isDetailListingUrl(u) {
  if (!u) return false;
  if (!u.startsWith("https://www.encuentra24.com/panama-es/")) return false;
  if (u.includes("/searchresult/")) return false;
  if (u.includes("/autos-usados")) return false;
  if (u.includes("/autos-nuevos")) return false;
  if (u.includes("/autos-motos")) return false;
  if (u.includes("/autos-camiones-y-buses")) return false;
  if (u.includes("/user/") || u.includes("/login") || u.includes("/signup")) return false;

  // Heurística: los detalles suelen tener al menos 3 segmentos después de panama-es
  // e.g. /panama-es/autos-usados/ciudad/....  (varía)
  const parts = u.replace("https://www.encuentra24.com/panama-es/", "").split("/").filter(Boolean);
  if (parts.length < 2) return false;

  return true;
}

// filtro “persona natural” (best-effort):
// - si el JSON trae seller_is_business / isBusiness / business => lo usamos
// - si no, heurística por campos típicos: company_name/store/dealer
function isNaturalPerson(obj) {
  if (!obj || typeof obj !== "object") return true;

  const keys = Object.keys(obj).map((k) => k.toLowerCase());
  const get = (k) => obj[k];

  // campos directos
  for (const k of keys) {
    if (k.includes("seller_is_business") || k === "isbusiness" || k.includes("is_business")) {
      return !Boolean(obj[k]);
    }
    if (k.includes("business") && typeof obj[k] === "boolean") {
      return !obj[k];
    }
  }

  // heurística por “dealer / store”
  const hay = JSON.stringify(obj).toLowerCase();
  if (hay.includes("dealer") || hay.includes("concesionario") || hay.includes("agencia")) return false;
  if (hay.includes("shop") || hay.includes("store") || hay.includes("empresa")) return false;

  // si trae algo tipo "companyName"
  if (keys.some((k) => k.includes("company") || k.includes("store") || k.includes("dealer"))) return false;

  return true;
}

// intenta encontrar urls de detalle dentro de un json cualquiera
function extractUrlsFromJson(anyJson) {
  const urls = [];

  const walk = (x) => {
    if (!x) return;
    if (typeof x === "string") {
      const n = normalize(x);
      if (n && isDetailListingUrl(n)) urls.push(n);
      return;
    }
    if (Array.isArray(x)) {
      for (const it of x) walk(it);
      return;
    }
    if (typeof x === "object") {
      // si tiene campos obvios
      for (const [k, v] of Object.entries(x)) {
        if (typeof v === "string") {
          const n = normalize(v);
          if (n && isDetailListingUrl(n)) urls.push(n);
        } else {
          walk(v);
        }
      }
      return;
    }
  };

  walk(anyJson);
  return urls;
}

// intenta extraer “items” del payload si existe
function extractListingObjects(anyJson) {
  const objs = [];
  const walk = (x) => {
    if (!x) return;
    if (Array.isArray(x)) {
      // arrays de objetos (candidatos)
      if (x.length && typeof x[0] === "object") {
        for (const it of x) objs.push(it);
      }
      for (const it of x) walk(it);
      return;
    }
    if (typeof x === "object") {
      for (const v of Object.values(x)) walk(v);
    }
  };
  walk(anyJson);
  return objs;
}

function uniq(arr) {
  return [...new Set(arr)];
}

const browser = await chromium.launch({ headless: HEADLESS });
const page = await browser.newPage({
  locale: "es-PA",
  timezoneId: "America/Panama",
  viewport: { width: 1280, height: 900 },
});

let captured = [];
let capturedObjs = [];

page.on("response", async (res) => {
  try {
    const url = res.url();
    const ct = (res.headers()["content-type"] || "").toLowerCase();

    // solo responses que podrían tener data
    const maybe =
      ct.includes("json") ||
      url.includes("graphql") ||
      url.includes("search") ||
      url.includes("list") ||
      url.includes("results");

    if (!maybe) return;

    const txt = await res.text().catch(() => "");
    if (!txt || txt.length < 50) return;

    let j = null;
    try {
      j = JSON.parse(txt);
    } catch {
      return;
    }

    // urls
    const urls = extractUrlsFromJson(j);
    if (urls.length) captured.push(...urls);

    // objetos (para filtro persona natural)
    const objs = extractListingObjects(j);
    if (objs.length) capturedObjs.push(...objs);
  } catch {}
});

await page.goto(CATEGORY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(1500);

// scroll para disparar fetches
for (let i = 0; i < 12; i++) {
  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(700);
}

// filtra urls por “persona natural” si podemos
captured = uniq(captured).filter(isDetailListingUrl);

// si logramos mapear objs->url, aplicamos filtro; si no, devolvemos urls igual
// intentamos asociar por presencia de url dentro del obj
const naturalUrls = new Set();
for (const obj of capturedObjs) {
  if (!isNaturalPerson(obj)) continue;
  const urls = extractUrlsFromJson(obj);
  for (const u of urls) if (isDetailListingUrl(u)) naturalUrls.add(u);
}

let finalLinks = captured;
if (naturalUrls.size) {
  finalLinks = finalLinks.filter((u) => naturalUrls.has(u));
}

finalLinks = finalLinks.slice(0, LIMIT);

await fs.writeFile(OUT, finalLinks.join("\n") + "\n", "utf8");

console.log(
  JSON.stringify(
    {
      ok: true,
      category: CATEGORY_URL,
      out: OUT,
      total_urls_found: captured.length,
      natural_urls_found: naturalUrls.size,
      n: finalLinks.length,
    },
    null,
    2
  )
);

if (finalLinks.length) console.log(finalLinks.slice(0, 8).join("\n"));

await browser.close();
