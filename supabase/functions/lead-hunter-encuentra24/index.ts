import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";

/* =========================
   ENV (Supabase required)
========================= */
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
}

/* =========================
   ENV (WhatsApp optional)
========================= */
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN") || "";
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID") || "";
const CLIENT_PHONE = Deno.env.get("CLIENT_PHONE") || "";

const WHATSAPP_ENABLED = Boolean(WHATSAPP_TOKEN && WHATSAPP_PHONE_ID && CLIENT_PHONE);

/* =========================
   CONFIG
========================= */
const SOURCE = "encuentra24";
const COUNTRY_DEFAULT = "PA";

function buildUrl(page: number) {
  const base = "https://www.encuentra24.com/panama-es/autos-usados";
  return page > 1 ? `${base}.${page}` : base;
}

/* =========================
   Helpers
========================= */
async function restJson(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("apikey", SERVICE_ROLE_KEY);
  headers.set("Authorization", `Bearer ${SERVICE_ROLE_KEY}`);

  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, { ...init, headers });
  const text = await res.text().catch(() => "");

  if (!res.ok) throw new Error(`${path} ${res.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

/* =========================
   PREQUALIFY (fixed)
   - NO filtrar por "autos" (eso mata todo)
   - year null NO bloquea (por ahora)
========================= */
function prequalify(lead: { year: number | null; text: string }) {
  // si no hay year, dejamos pasar (mejor capturar y filtrar después)
  if (lead.year && lead.year < 2012) return false;
  if (/taxi/i.test(lead.text)) return false;

  // más específico: señales de negocio / dealer
  if (/(concesionario|agencia|dealer|showroom|flota|s\.a\.|corp|empresa|importadora)/i.test(lead.text)) {
    return false;
  }

  return true;
}

/* =========================
   DEDUPE (by your unique index)
   UNIQUE(account_id, source, external_id)
========================= */
async function alreadySent(account_id: string, source: string, external_id: string): Promise<boolean> {
  const q =
    `?account_id=eq.${account_id}` +
    `&source=eq.${encodeURIComponent(source)}` +
    `&external_id=eq.${encodeURIComponent(external_id)}` +
    `&select=id&limit=1`;

  const data = await restJson(`/leads${q}`, { method: "GET" });
  return Array.isArray(data) && data.length > 0;
}

/* =========================
   INSERT Lead (public.leads columns only)
========================= */
async function insertLead(row: {
  job_id?: string | null;
  account_id: string;
  source: string;
  niche?: string | null;
  external_id: string;
  title?: string | null;
  url?: string | null;
  country?: string | null;
  raw?: unknown;
}) {
  const data = await restJson(`/leads?select=id&on_conflict=account_id,source,external_id`, {
    method: "POST",
    headers: { Prefer: "return=representation,resolution=merge-duplicates" },
    body: JSON.stringify([row]),
  });
  return Array.isArray(data) ? data[0] : data;
}

/* =========================
   WhatsApp (optional)
========================= */
async function sendWhatsApp(text: string) {
  if (!WHATSAPP_ENABLED) return false;

  const res = await fetch(`https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: CLIENT_PHONE,
      type: "text",
      text: { body: text },
    }),
  });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    console.error("WhatsApp send failed:", res.status, t);
    return false;
  }
  return true;
}

/* =========================
   Parse listings
========================= */
function parseListings(html: string) {
  const $ = cheerio.load(html);
  const out: Array<{
    external_id: string;
    title: string;
    url: string;
    text: string;
    year: number | null;
  }> = [];

  $(".d3-ad-tile").each((_, el) => {
    const link = $(el).find("a.d3-ad-tile__description").first();
    const href = link.attr("href");
    if (!href) return;

    const m = href.match(/\/(\d{6,8})$/);
    if (!m) return;

    const external_id = m[1];
    const title = link.text().trim();
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const yearMatch = text.match(/20\d{2}/);
    const year = yearMatch ? Number(yearMatch[0]) : null;

    out.push({
      external_id,
      title: title || `Encuentra24 ${external_id}`,
      url: `https://www.encuentra24.com${href}`,
      text,
      year,
    });
  });

  return out;
}

/* =========================
   EDGE FUNCTION
========================= */
serve(async (req) => {
  try {
    const body = await req.json().catch(() => ({}));
    const account_id = String(body.account_id || "").trim();
    const job_id = body.job_id ? String(body.job_id) : null;
    const niche = body.niche ? String(body.niche) : null;

    if (!account_id) {
      return new Response(
        JSON.stringify({ ok: false, error: "Missing account_id (public.leads.account_id is NOT NULL)" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const page = Number(body.page || 1);
    const url = buildUrl(page);

    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120",
      },
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      throw new Error(`Fetch failed ${res.status}: ${t}`);
    }

    const html = await res.text();
    const listings = parseListings(html);

    let inserted = 0;
    let skipped = 0;
    let sent_whatsapp = 0;

    const samples: any[] = [];
    const reasons: Record<string, number> = { dedupe: 0, prequal: 0, inserted: 0 };

    for (const l of listings) {
      // DEDUPE
      if (await alreadySent(account_id, SOURCE, l.external_id)) {
        skipped++;
        reasons.dedupe++;
        if (samples.length < 5) samples.push({ stage: "dedupe", external_id: l.external_id, title: l.title });
        continue;
      }

      // PREQUALIFY + reason sampling
      const text = l.text;
      const year = l.year;

      const reason =
        (year && year < 2012 ? "year_lt_2012" : "") ||
        (/taxi/i.test(text) ? "taxi" : "") ||
        (/(concesionario|agencia|dealer|showroom|flota|s\.a\.|corp|empresa|importadora)/i.test(text)
          ? "business_kw"
          : "");

      if (!prequalify({ year, text })) {
        skipped++;
        reasons.prequal++;
        if (samples.length < 5) samples.push({ stage: "prequal", reason, external_id: l.external_id, year, title: l.title, text: text.slice(0, 180) });
        continue;
      }

      const msg =
        `🚗 *Lead calificado – Encuentra24*\n\n` +
        `Año: ${l.year ?? "N/A"}\n` +
        `Título: ${l.title}\n\n` +
        `Link:\n${l.url}\n\n` +
        `⏱ Publicado recientemente\n📞 Llamar directo desde el anuncio`;

      await insertLead({
        job_id,
        account_id,
        source: SOURCE,
        niche,
        external_id: l.external_id,
        title: l.title,
        url: l.url,
        country: COUNTRY_DEFAULT,
        raw: { text: l.text, year: l.year },
      });

      inserted++;
      reasons.inserted++;

      if (WHATSAPP_ENABLED) {
        const ok = await sendWhatsApp(msg);
        if (ok) sent_whatsapp++;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        url,
        page,
        count_listings: listings.length,
        inserted,
        skipped,
        reasons,
        samples,
        whatsapp_enabled: WHATSAPP_ENABLED,
        sent_whatsapp,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
