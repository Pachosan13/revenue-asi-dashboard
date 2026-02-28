import { serve } from "https://deno.land/std@0.224.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4"

type ImportRow = {
  dealerUrl: string
  inventoryUrl?: string | null
  listingUrl: string
  scrapedAt?: string | null
  status?: string | null
}

type ReqBody = {
  account_id: string
  rows: ImportRow[]
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  })
}

function normalizeText(v: unknown): string | null {
  if (typeof v !== "string") return null
  const x = v.trim()
  return x.length ? x : null
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders })
  if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" })
  if (!req.headers.get("authorization")) return json(401, { ok: false, error: "Missing authorization header" })

  const SB_URL = Deno.env.get("SUPABASE_URL")?.trim()
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim()
  if (!SB_URL || !SB_KEY) {
    return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" })
  }

  const body = (await req.json().catch(() => ({}))) as ReqBody
  const account_id = normalizeText(body?.account_id)
  const rows = Array.isArray(body?.rows) ? body.rows : []

  if (!account_id) return json(400, { ok: false, error: "account_id required" })
  if (!rows.length) return json(400, { ok: false, error: "rows required" })

  const supabase = createClient(SB_URL, SB_KEY, {
    global: { fetch },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const vdpRows = rows
    .map((r) => {
      const dealer_url = normalizeText(r.dealerUrl)
      const listing_url = normalizeText(r.listingUrl)
      if (!dealer_url || !listing_url) return null
      return {
        account_id,
        dealer_url,
        listing_url,
        inventory_url: normalizeText(r.inventoryUrl),
        scraped_at: normalizeText(r.scrapedAt),
        status: normalizeText(r.status),
      }
    })
    .filter((r): r is NonNullable<typeof r> => Boolean(r))

  if (!vdpRows.length) {
    return json(400, { ok: false, error: "rows must contain dealerUrl + listingUrl" })
  }

  const { error: upsertLinksErr } = await supabase
    .from("hq_dealer_vdp_links")
    .upsert(vdpRows, { onConflict: "account_id,dealer_url,listing_url" })
  if (upsertLinksErr) return json(400, { ok: false, stage: "upsert_vdp_links", error: upsertLinksErr.message })

  const dealerUrls = Array.from(new Set(vdpRows.map((r) => r.dealer_url)))
  const { data: links, error: rollupErr } = await supabase
    .from("hq_dealer_vdp_links")
    .select("dealer_url,scraped_at")
    .eq("account_id", account_id)
    .in("dealer_url", dealerUrls)
  if (rollupErr) return json(400, { ok: false, stage: "rollup_read", error: rollupErr.message })

  const rollup = new Map<string, { vdp_count: number; last_scraped_at: string | null }>()
  for (const row of links ?? []) {
    const dealer_url = String((row as any).dealer_url || "")
    if (!dealer_url) continue
    const curr = rollup.get(dealer_url) ?? { vdp_count: 0, last_scraped_at: null }
    curr.vdp_count += 1
    const scrapedAt = normalizeText((row as any).scraped_at)
    if (scrapedAt && (!curr.last_scraped_at || scrapedAt > curr.last_scraped_at)) curr.last_scraped_at = scrapedAt
    rollup.set(dealer_url, curr)
  }

  const prospectRows = Array.from(rollup.entries()).map(([dealer_url, agg]) => ({
    account_id,
    dealer_url,
    vdp_count: agg.vdp_count,
    last_scraped_at: agg.last_scraped_at,
    updated_at: new Date().toISOString(),
  }))

  if (prospectRows.length) {
    const { error: upsertProspectsErr } = await supabase
      .from("hq_dealer_prospects")
      .upsert(prospectRows, { onConflict: "account_id,dealer_url" })
    if (upsertProspectsErr) return json(400, { ok: false, stage: "upsert_prospects", error: upsertProspectsErr.message })
  }

  return json(200, {
    ok: true,
    account_id,
    received_rows: rows.length,
    imported_rows: vdpRows.length,
    rolled_up_dealers: prospectRows.length,
  })
})
