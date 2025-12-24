// supabase/functions/lead-hunter-tick/index.ts
import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import * as cheerio from "npm:cheerio@1.0.0-rc.12"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

type Job = {
  id: string
  account_id: string
  directive_id: string | null
  niche: string
  geo: string // e.g. "PA"
  keywords: string[]
  target_leads: number
  status: string
  meta: any // jsonb
  created_at: string
  updated_at: string
}

type Listing = {
  external_id: string
  title: string | null
  url: string
  price: string | null
  city: string | null
  country: string
  seller: string | null
  raw: any
}

const PROJECT_URL = Deno.env.get("PROJECT_URL")
const SERVICE_ROLE_KEY = (Deno.env.get("SERVICE_ROLE_KEY") || "").trim()

if (!PROJECT_URL) throw new Error("Missing PROJECT_URL secret")
if (!SERVICE_ROLE_KEY) throw new Error("Missing SERVICE_ROLE_KEY secret")

const supabase = createClient(PROJECT_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

function json(status: number, body: any) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  })
}

function getBearer(req: Request) {
  const h = req.headers.get("authorization") || ""
  const m = h.match(/bearer\s+(.+)/i)
  return (m?.[1] || "").trim()
}

function assertInternalAuth(req: Request) {
  const bearer = getBearer(req)
  const apikey = (req.headers.get("apikey") || "").trim()

  // Local/internal cron/dev: accept exact match with SERVICE_ROLE_KEY
  if (bearer === SERVICE_ROLE_KEY) return
  if (apikey === SERVICE_ROLE_KEY) return

  throw new Error("Unauthorized")
}

function nowIso() {
  return new Date().toISOString()
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}

function buildEncuentra24Url(page: number) {
  const base = "https://www.encuentra24.com/panama-es/autos-usados"
  return page > 1 ? `${base}.${page}` : base
}

function text1(s: string) {
  return (s || "").replace(/\s+/g, " ").trim()
}

function isLikelyBusinessName(s?: string | null) {
  if (!s) return false
  const x = s.toLowerCase().replace(/\s+/g, " ").trim()
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
  ]
  return bad.some((k) => x.includes(k))
}

// Encuentra24 sometimes embeds ga4addata[...] = {...};
function parseGa4Addata(html: string) {
  const re = /ga4addata\[(\d+)\]\s*=\s*(\{.*?\});/gs
  const out: Record<number, any> = {}
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const id = Number(m[1])
    const jsonTxt = m[2]
    try {
      out[id] = JSON.parse(jsonTxt)
    } catch {
      // ignore invalid JSON fragments
    }
  }
  return out
}

function parseListings(html: string, country = "PA"): Listing[] {
  const $ = cheerio.load(html)
  const ga4 = parseGa4Addata(html)
  const rows: Listing[] = []

  $(".d3-ad-tile").each((_, el) => {
    const tile = $(el)
    const link = tile.find("a.d3-ad-tile__description").first()
    const href = link.attr("href")
    if (!href) return

    const idMatch = href.match(/\/(\d{6,10})$/)
    if (!idMatch) return
    const external_id = idMatch[1]

    const seller = text1(tile.find(".d3-ad-tile__seller").first().text()) || null
    if (seller && isLikelyBusinessName(seller)) return // solo personas

    const title =
      text1(tile.find(".d3-ad-tile__title").first().text()) ||
      text1(link.text()) ||
      null

    const priceStr =
      tile.find("a.tool-favorite[data-price]").first().attr("data-price") ||
      tile.find("[data-price]").first().attr("data-price") ||
      null
    const price = priceStr ? String(priceStr).replace(/[^\d]/g, "") : null

    const g = ga4[Number(external_id)] || {}
    const city = g.location ? String(g.location) : null

    rows.push({
      external_id,
      title,
      url: `https://www.encuentra24.com${href}`,
      price,
      city,
      country,
      seller,
      raw: { ga4: g },
    })
  })

  // dedup by external_id
  const map = new Map<string, Listing>()
  for (const r of rows) map.set(r.external_id, r)
  return [...map.values()]
}

function placeIdForEncuentra24(externalId: string) {
  return `encuentra24:${externalId}`
}

async function claimNextJob(workerId: string, source: string, niche: string): Promise<Job | null> {
  // Prefer wrapper public.lh_claim_next_job(text,text,text)
  const w = await supabase.rpc("lh_claim_next_job", {
    p_worker_id: workerId,
    p_source: source,
    p_niche: niche,
  })

  if (!w.error && w.data) {
    const job = (w.data as any)?.job ? (w.data as any).job : w.data
    if (job?.id) return job as Job
  }

  // Fallback: public.claim_next_job(jsonb) if you have it
  const fb = await supabase.rpc("claim_next_job", {
    p: { p_worker_id: workerId, p_source: source, p_niche: niche },
  })

  if (fb.error) throw new Error(`claim_next_job rpc error: ${fb.error.message}`)
  if (!fb.data) return null

  const job = (fb.data as any)?.job ? (fb.data as any).job : fb.data
  if (!job?.id) return null
  return job as Job
}

async function updateJobMetaViaRpc(jobId: string, patchMeta: Record<string, any>, status?: string) {
  // You MUST have public.lh_update_job(p_job_id uuid, p_status text, p_meta jsonb) SECURITY DEFINER
  const { data, error } = await supabase.rpc("lh_update_job", {
    p_job_id: jobId,
    p_status: status ?? null,
    p_meta: patchMeta,
  })
  if (error) throw new Error(`lh_update_job error: ${error.message}`)
  return data
}

async function upsertPlacesRawViaRpc(listings: Listing[]) {
  if (!listings.length) return 0

  const rows = listings.map((l) => ({
    place_id: placeIdForEncuentra24(l.external_id),
    name: l.title || null,
    phone: null,
    website: null,
    address: null,
    city: l.city || null,
    state: null,
    postal_code: null,
    lat: null,
    lng: null,
    rating: null,
    reviews_count: null,
    category: "autos",
    maps_url: l.url,
    collected_at: nowIso(),
    raw_payload: {
      source: "encuentra24",
      account_id: job.account_id,
      job_id: job.id,
      external_id: l.external_id,
      url: l.url,
      price: l.price,
      seller: l.seller,
      ...l.raw,
    },
  }))

  const { data, error } = await supabase.rpc("lh_upsert_places_raw", { p_rows: rows })
  if (error) throw new Error(`lh_upsert_places_raw error: ${error.message}`)
  return Number(data || 0)
}

async function upsertLeadsCanonicalViaRpc(job: Job, listings: Listing[]) {
  if (!listings.length) return 0

  const rows = listings.map((l) => ({
    place_id: placeIdForEncuentra24(l.external_id),
    domain: null,
    business_name: null,
    contact_name: l.seller || null,
    title: l.title || null,
    email: null,
    phone: null,
    niche: job.niche,
    geo: job.geo,
    completeness_score: 15,
    ready_for_outreach: false,
    source: {
      type: "encuentra24",
      account_id: job.account_id,
      job_id: job.id,
      url: l.url,
      external_id: l.external_id,
      price: l.price,
      city: l.city,
      collected_at: nowIso(),
    },
  }))

  const { data, error } = await supabase.rpc("lh_upsert_leads_canonical", { p_rows: rows })
  if (error) throw new Error(`lh_upsert_leads_canonical error: ${error.message}`)
  return Number(data || 0)
}

async function fetchAndParseEncuentra24(page: number, country: string) {
  const url = buildEncuentra24Url(page)
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html",
    },
  })
  if (!res.ok) throw new Error(`fetch encuentra24 ${res.status} page=${page}`)
  const html = await res.text()
  const listings = parseListings(html, country)
  return { url, listings }
}

serve(async (req) => {
  try {
    assertInternalAuth(req)

    const body = await req.json().catch(() => ({} as any))
    const workerId = String(body?.worker_id || "edge-worker-1")
    const source = String(body?.source || "encuentra24")
    const niche = String(body?.niche || "autos")
    const pagesPerRun = clamp(Number(body?.pages_per_run || 1), 1, 5)

    const job = await claimNextJob(workerId, source, niche)
    if (!job) return json(200, { ok: true, job: null })

    // Cursor lives in meta.cursor
    const cursor = Number(job?.meta?.cursor || 1)
    let page = cursor > 0 ? cursor : 1

    let found = 0
    let insertedPlaces = 0
    let insertedCanonical = 0
    let hasMore = true

    for (let i = 0; i < pagesPerRun; i++) {
      const { listings } = await fetchAndParseEncuentra24(page, job.geo || "PA")

      found += listings.length
      insertedPlaces += await upsertPlacesRawViaRpc(listings)
      insertedCanonical += await upsertLeadsCanonicalViaRpc(job, listings)

      hasMore = listings.length > 0
      page += 1
      if (!hasMore) break
    }

    const prevFound = Number(job?.meta?.leads_found || 0)
    const prevInserted = Number(job?.meta?.leads_inserted || 0)
    const nextFound = prevFound + found
    const nextInserted = prevInserted + insertedCanonical

    const doneByTarget = job.target_leads ? nextInserted >= Number(job.target_leads) : false
    const done = !hasMore || doneByTarget

    const nextMeta = {
      ...(job.meta || {}),
      worker_id: workerId,
      source,
      cursor: page,
      last_page_processed: page - 1,
      leads_found: nextFound,
      leads_inserted: nextInserted,
      last_run_at: nowIso(),
      last_run: {
        pages: pagesPerRun,
        found,
        inserted_places_raw: insertedPlaces,
        inserted_leads_canonical: insertedCanonical,
      },
    }

    await updateJobMetaViaRpc(job.id, nextMeta, done ? "done" : "running")

    return json(200, {
      ok: true,
      job: {
        id: job.id,
        status: done ? "done" : "running",
        cursor_from: cursor,
        cursor_next: page,
        found,
        inserted_places_raw: insertedPlaces,
        inserted_leads_canonical: insertedCanonical,
        totals: { leads_found: nextFound, leads_inserted: nextInserted, target_leads: job.target_leads },
      },
    })
  } catch (e: any) {
    const msg = String(e?.message || e)
    const status = msg === "Unauthorized" ? 401 : 500
    return json(status, { ok: false, error: msg })
  }
})
