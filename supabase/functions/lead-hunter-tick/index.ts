import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type Job = {
  id: string;
  account_id: string;
  source: string;
  niche: string;
  status: string;
  cursor: number | null; // page
  geo: any;
  meta: any;
  progress: any;
};

const PROJECT_URL = Deno.env.get("PROJECT_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SERVICE_ROLE_KEY");

if (!PROJECT_URL) throw new Error("Missing PROJECT_URL secret");
if (!SERVICE_ROLE_KEY) throw new Error("Missing SERVICE_ROLE_KEY secret");

const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

function buildEncuentra24Url(page: number) {
  const base = "https://www.encuentra24.com/panama-es/autos-usados";
  return page > 1 ? `${base}.${page}` : base;
}

function text1(s: string) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function isLikelyBusinessName(s?: string | null) {
  if (!s) return false;
  const x = s.toLowerCase().replace(/\s+/g, " ").trim();
  const bad = [
    "motors", "autos", "auto ", "carspot", "galería", "galeria",
    "ventas", "venta", "dealer", "agencia", "showroom", "online",
    "s.a", "s.a.", " sa ", "inc", "ltd", "corp", "company",
    "comercial", "importadora", "multimarca", "sucursal",
    "financiamiento disponible", "aceptamos trade-in", "trade-in",
  ];
  return bad.some((k) => x.includes(k));
}

function parseGa4Addata(html: string) {
  const re = /ga4addata\[(\d+)\]\s*=\s*(\{.*?\});/gs;
  const out: Record<number, any> = {};
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const id = Number(m[1]);
    const json = m[2];
    try { out[id] = JSON.parse(json); } catch {}
  }
  return out;
}

function parseListings(html: string, country = "PA") {
  const $ = cheerio.load(html);
  const ga4 = parseGa4Addata(html);

  const rows: any[] = [];

  $(".d3-ad-tile").each((_, el) => {
    const tile = $(el);
    const link = tile.find("a.d3-ad-tile__description").first();
    const href = link.attr("href");
    if (!href) return;

    const idMatch = href.match(/\/(\d{6,8})$/);
    if (!idMatch) return;
    const external_id = idMatch[1];

    const seller = text1(tile.find(".d3-ad-tile__seller").first().text()) || null;
    if (seller && isLikelyBusinessName(seller)) return; // 👈 solo personas

    const title =
      text1(tile.find(".d3-ad-tile__title").first().text()) ||
      text1(link.text()) ||
      null;

    const priceStr =
      tile.find("a.tool-favorite[data-price]").first().attr("data-price") ||
      tile.find("[data-price]").first().attr("data-price") ||
      null;

    const price = priceStr ? String(priceStr).replace(/[^\d]/g, "") : null;

    const g = ga4[Number(external_id)] || {};
    const city = g.location ? String(g.location) : null;

    rows.push({
      external_id,
      title,
      url: `https://www.encuentra24.com${href}`,
      price,
      city,
      country,
      raw: { ga4: g, seller },
    });
  });

  // dedup
  const map = new Map<string, any>();
  for (const r of rows) map.set(r.external_id, r);
  return [...map.values()];
}

async function claimNextJob(workerId: string): Promise<Job | null> {
  // claim por RPC (asume que existe en schema lead_hunter)
  const { data, error } = await supabase
    .schema("lead_hunter")
    .rpc("claim_next_job", { p_worker_id: workerId, p_source: "encuentra24", p_niche: "autos" });

  if (error) {
    // si no existe el rpc, te lo digo claro
    throw new Error(`claim_next_job rpc error: ${error.message}`);
  }

  // supabase-js puede devolver array o objeto
  const job = Array.isArray(data) ? data[0] : data;
  return job?.id ? (job as Job) : null;
}

async function patchJob(jobId: string, patch: Record<string, any>) {
  const { data, error } = await supabase
    .schema("lead_hunter")
    .from("jobs")
    .update(patch)
    .eq("id", jobId)
    .select("*")
    .single();

  if (error) throw new Error(`patch job error: ${error.message}`);
  return data;
}

async function upsertLeads(job: Job, listings: any[]) {
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

  const { data, error } = await supabase
    .schema("lead_hunter")
    .from("leads")
    .upsert(payload, { onConflict: "account_id,source,external_id" })
    .select("id");

  if (error) throw new Error(`upsert leads error: ${error.message}`);
  return Array.isArray(data) ? data.length : 0;
}

async function processPages(job: Job, pagesPerRun = 1) {
  let page = Number(job.cursor) || 1;
  if (page < 1) page = 1;

  let found = 0;
  let inserted = 0;
  let hasMore = true;

  for (let i = 0; i < pagesPerRun; i++) {
    const url = buildEncuentra24Url(page);
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        Accept: "text/html",
      },
    });

    if (!res.ok) throw new Error(`fetch encuentra24 ${res.status} page=${page}`);

    const html = await res.text();
    const listings = parseListings(html, job.geo?.country || "PA");

    found += listings.length;
    inserted += await upsertLeads(job, listings);

    hasMore = listings.length > 0;
    page += 1;

    if (!hasMore) break;
  }

  return { nextPage: page, found, inserted, done: !hasMore };
}

serve(async (req) => {
  try {
    // Seguridad mínima: solo service role (cron lo usará con service role)
    const auth = req.headers.get("authorization") || "";
    if (!auth.toLowerCase().includes("bearer")) {
      return new Response(JSON.stringify({ ok: false, message: "Missing authorization" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const workerId = (await req.json().catch(() => ({})))?.worker_id || "edge-worker-1";

    const job = await claimNextJob(workerId);
    if (!job) {
      return new Response(JSON.stringify({ ok: true, message: "No queued job" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Procesa 1 página por minuto (subes luego)
    const run = await processPages(job, 1);

    await patchJob(job.id, {
      last_heartbeat_at: new Date().toISOString(),
      cursor: run.nextPage,
      progress: {
        cursor: run.nextPage,
        leads_found: (job.progress?.leads_found || 0) + run.found,
        leads_inserted: (job.progress?.leads_inserted || 0) + run.inserted,
        last_page_processed: run.nextPage - 1,
      },
      status: run.done ? "done" : "running",
      updated_at: new Date().toISOString(),
      error: null,
    });

    return new Response(JSON.stringify({
      ok: true,
      job_id: job.id,
      found: run.found,
      inserted: run.inserted,
      next_page: run.nextPage,
      done: run.done,
    }), { status: 200, headers: { "Content-Type": "application/json" } });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
