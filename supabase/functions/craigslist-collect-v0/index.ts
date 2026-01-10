import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import * as cheerio from "npm:cheerio@1.0.0-rc.12";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type ReqBody = {
  account_id: string;
  city: string; // e.g. "Miami, FL" (used for SSV grouping)
  site?: string; // optional craigslist site slug, e.g. "miami"
  limit?: number; // 25-50
  dry_run?: boolean;
  debug?: boolean;
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function toLower(v: any) {
  return String(v ?? "").trim().toLowerCase();
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stackTrunc2000(e: unknown) {
  const s = e instanceof Error ? (e.stack ?? "") : "";
  if (!s) return null;
  return s.length > 2000 ? s.slice(0, 2000) : s;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  ms = 7000,
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

function slugifyCityToSite(city: string) {
  // Best-effort: craigslist site slugs are not always identical to city names.
  // If mapping fails, caller should pass body.site explicitly.
  // Examples that work: "Miami" -> "miami", "Los Angeles" -> "losangeles".
  const s = String(city ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/g)
    .slice(0, 2) // keep short; v0
    .join("");
  return s || null;
}

function extractPostingIdFromUrl(url: string): string | null {
  // Typical: https://miami.craigslist.org/mdc/cto/d/miami-.../7712345678.html
  const m = String(url).match(/\/(\d{6,})\.html(?:$|\?)/);
  return m ? String(m[1]) : null;
}

function buildSearchUrl(site: string) {
  // Cars & trucks by owner only (/cto/)
  // - purveyor=owner restricts to owner posts (lower dealer risk).
  return `https://${site}.craigslist.org/search/cto?purveyor=owner&sort=date`;
}

function hasPersonalSellerSignals(description: string) {
  const d = toLower(description);
  const rejectTokens = [
    "dealer",
    "financing",
    "inventory",
    "we offer",
    "call our office",
  ];
  return !rejectTokens.some((t) => d.includes(t));
}

function parseSearch(html: string, limit: number) {
  const $ = cheerio.load(html);
  const out: { url: string; posting_id: string }[] = [];

  $("a.result-title.hdrlnk[href]").each((_, a) => {
    if (out.length >= limit) return;
    const href = String($(a).attr("href") ?? "").trim();
    if (!href) return;
    const posting_id = extractPostingIdFromUrl(href);
    if (!posting_id) return;
    out.push({ url: href, posting_id });
  });

  // fallback selector
  if (!out.length) {
    $("li.result-row a[href]").each((_, a) => {
      if (out.length >= limit) return;
      const href = String($(a).attr("href") ?? "").trim();
      if (!href) return;
      const posting_id = extractPostingIdFromUrl(href);
      if (!posting_id) return;
      out.push({ url: href, posting_id });
    });
  }

  // de-dupe by posting_id
  const seen = new Set<string>();
  const deduped: { url: string; posting_id: string }[] = [];
  for (const r of out) {
    if (seen.has(r.posting_id)) continue;
    seen.add(r.posting_id);
    deduped.push(r);
  }
  return deduped;
}

function parseDetail(html: string) {
  const $ = cheerio.load(html);

  const title = String($("#titletextonly").text() || "").trim() || null;
  const priceText = String($(".price").first().text() || "").trim();
  const priceNum = priceText ? Number(priceText.replace(/[^\d.]/g, "")) : NaN;
  const price = Number.isFinite(priceNum) ? priceNum : null;

  const postingTitle = String($("span.postingtitletext").text() || "").trim();
  // area often appears as "(area)" in postingtitletext
  const areaMatch = postingTitle.match(/\(([^)]+)\)\s*$/);
  const area = areaMatch ? String(areaMatch[1]).trim() : null;

  const postedAt = String($("time.date.timeago").attr("datetime") ?? "").trim() || null;

  const body = String($("#postingbody").text() || "")
    .replace(/^QR Code Link to This Post\s*/i, "")
    .trim();

  const attrs: Record<string, string> = {};
  $(".attrgroup span").each((_, el) => {
    const t = String($(el).text() || "").trim();
    if (!t) return;
    // patterns: "odometer: 123456", "fuel: gas", "VIN: ..."
    const m = t.match(/^([^:]+):\s*(.+)$/);
    if (m) {
      const k = toLower(m[1]);
      const v = String(m[2]).trim();
      if (k && v) attrs[k] = v;
    }
  });

  const images: string[] = [];
  $("img[src]").each((_, img) => {
    const src = String($(img).attr("src") ?? "").trim();
    if (!src) return;
    if (src.includes("images.craigslist.org")) images.push(src);
  });

  // Contact availability (v0, low risk): detect presence of reply link/button; do not fetch reply page.
  const hasReply = $("a.replylink, button.reply_button, a[href*=\"reply\"]").length > 0;

  return {
    title,
    price,
    area,
    posted_at: postedAt,
    description: body || null,
    attributes: Object.keys(attrs).length ? attrs : {},
    image_urls: Array.from(new Set(images)).slice(0, 20),
    contact: {
      phone: null as string | null,
      email_relay: hasReply ? true : false,
    },
  };
}

Deno.serve(async (req) => {
  let stage:
    | "parse_body"
    | "discover_fetch"
    | "discover_parse"
    | "detail_fetch"
    | "detail_parse"
    | "db_insert" = "parse_body";
  let debug = false;
  const meta: Record<string, unknown> = {};

  try {
    if (req.method !== "POST") return json(405, { ok: false, error: "POST only" });

    const urlObj = new URL(req.url);
    const debugParam = (urlObj.searchParams.get("debug") ?? "").trim();
    debug = debugParam === "1" || debugParam.toLowerCase() === "true";

    const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const SERVICE_ROLE_KEY = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "").trim();
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json(500, { ok: false, stage: "parse_body", error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const body = (await req.json().catch(() => ({}))) as Partial<ReqBody>;
    debug = debug || Boolean(body.debug ?? false);
    const account_id = String(body.account_id ?? "").trim();
    const city = String(body.city ?? "").trim();
    const limit = Math.max(25, Math.min(Number(body.limit ?? 25), 50));
    const dryRun = Boolean(body.dry_run ?? false);

    meta.account_id_present = Boolean(account_id);
    meta.city = city || null;
    meta.limit = limit;
    meta.dry_run = dryRun;

    if (!account_id) return json(400, { ok: false, stage: "parse_body", error: "account_id required" });
    if (!city) return json(400, { ok: false, stage: "parse_body", error: "city required" });

    const site = (String(body.site ?? "").trim().toLowerCase() || slugifyCityToSite(city)) ?? null;
    meta.site = site;
    if (!site) {
      return json(400, {
        ok: false,
        stage: "parse_body",
        error: "Unable to derive craigslist site slug; pass body.site explicitly (e.g. 'miami')",
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const commonHeaders = {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
    };

    const searchUrl = buildSearchUrl(site);
    meta.search_url_host = (() => {
      try { return new URL(searchUrl).host; } catch { return null; }
    })();

    stage = "discover_fetch";
    const searchRes = await fetchWithTimeout(searchUrl, { headers: commonHeaders }, 7000);
    const searchHtml = await searchRes.text().catch(() => "");
    meta.discover_status = searchRes.status;
    if (!searchRes.ok) {
      return json(502, { ok: false, stage, error: "search_failed", status: searchRes.status });
    }

    stage = "discover_parse";
    const discovered = parseSearch(searchHtml, limit);
    const postingIds = discovered.map((d) => d.posting_id);
    meta.discovered = discovered.length;

    // Cache/dedupe: skip posting_ids already present in public.leads for this account/source
    const existing = new Set<string>();
    if (postingIds.length) {
      stage = "db_insert";
      const { data, error } = await supabase
        .from("leads")
        .select("external_id")
        .eq("account_id", account_id)
        .eq("source", "craigslist")
        .in("external_id", postingIds)
        .limit(5000);
      if (error) {
        return json(500, { ok: false, stage, error: error.message });
      }
      for (const r of data ?? []) {
        const id = String((r as any)?.external_id ?? "").trim();
        if (id) existing.add(id);
      }
    }

    const toFetch = discovered.filter((d) => !existing.has(d.posting_id));
    meta.to_fetch = toFetch.length;

    let inserted = 0;
    let rejected_commercial = 0;
    let fetched = 0;
    const errors: any[] = [];

    for (const it of toFetch) {
      // conservative rate limit: ~1 req/sec total
      await sleep(1100);

      fetched++;
      stage = "detail_fetch";
      const res = await fetchWithTimeout(it.url, { headers: commonHeaders }, 7000);
      const html = await res.text().catch(() => "");
      if (!res.ok || !html) {
        errors.push({ posting_id: it.posting_id, error: "detail_fetch_failed", status: res.status });
        continue;
      }

      stage = "detail_parse";
      const detail = parseDetail(html);

      // Heuristics: reject obvious dealer/commercial posts.
      if (!detail.description || !hasPersonalSellerSignals(detail.description)) {
        rejected_commercial++;
        continue;
      }

      const row = {
        account_id,
        source: "craigslist",
        external_id: it.posting_id,
        niche: "autos",
        title: detail.title,
        url: it.url,
        price: detail.price,
        city: detail.area ? `${city} (${detail.area})` : city,
        country: "US",
        first_seen_at: new Date().toISOString(),
        // Leads WITHOUT phone must still be stored.
        phone: null,
        status: "new",
        lead_state: "new",
        enriched: {
          source: "craigslist",
          craigslist: {
            posting_id: it.posting_id,
            listing_url: it.url,
            site,
            posted_at: detail.posted_at,
            area: detail.area,
            contact: detail.contact,
            attributes: detail.attributes,
            image_urls: detail.image_urls,
          },
        },
        raw: {
          craigslist: {
            posting_id: it.posting_id,
            listing_url: it.url,
            site,
            posted_at: detail.posted_at,
            city_input: city,
            area: detail.area,
            title: detail.title,
            price: detail.price,
            description: detail.description,
            attributes: detail.attributes,
            image_urls: detail.image_urls,
            contact: detail.contact,
          },
        },
      };

      if (dryRun) continue;

      stage = "db_insert";
      const { error } = await supabase
        .from("leads")
        .upsert([row] as any, { onConflict: "account_id,source,external_id" });
      if (error) {
        errors.push({ posting_id: it.posting_id, error: error.message });
        continue;
      }

      inserted++;
    }

    return json(200, {
      ok: true,
      source: "craigslist",
      country: "US",
      city,
      site,
      limit,
      discovered: discovered.length,
      already_seen: existing.size,
      fetched,
      inserted,
      rejected_commercial,
      dry_run: dryRun,
      errors,
    });
  } catch (e) {
    const message = e instanceof Error ? (e.message ?? String(e)) : String(e);
    const name = e instanceof Error ? (e.name ?? null) : null;
    const stack_trunc = stackTrunc2000(e);
    const payload = debug
      ? { ok: false, stage, message, name, stack_trunc, meta }
      : { ok: false, stage, error: "internal_error" };
    return json(502, payload);
  }
});


