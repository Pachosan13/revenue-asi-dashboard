// worker/tools/enc24-discover-listings.mjs
// Discovery: category page -> real listing URLs -> output /tmp/enc24_links.txt + optional upsert into DB
//
// Usage:
//   CATEGORY_URL="https://www.encuentra24.com/panama-es/autos-usados" LIMIT="30" HEADLESS="0" FILTER_PERSONAS="1" node worker/tools/enc24-discover-listings.mjs
//
// DB upsert (recommended):
//   DATABASE_URL="postgresql://..." WRITE_DB="1" ACCOUNT_ID="..." node worker/tools/enc24-discover-listings.mjs
//
// Notes:
// - Upsert will use ON CONFLICT(listing_url) if a UNIQUE exists, else falls back to listing_url_hash.

import "dotenv/config";
import fs from "node:fs";
import crypto from "node:crypto";
import { chromium } from "playwright";
import pg from "pg";

const { Client } = pg;

function env(name, def = null) {
  const v = process.env[name];
  return v === undefined || v === null || v === "" ? def : v;
}
function num(name, def) {
  const v = Number(env(name, def));
  return Number.isFinite(v) ? v : def;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }
function sha1(s) {
  return crypto.createHash("sha1").update(String(s || ""), "utf8").digest("hex");
}

const CATEGORY_URL = env("CATEGORY_URL", "https://www.encuentra24.com/panama-es/autos-usados");
const LIMIT = num("LIMIT", 30);
const HEADLESS = String(env("HEADLESS", "1")) === "1";
const FILTER_PERSONAS = String(env("FILTER_PERSONAS", "1")) !== "0";
const OUT = env("OUT", "/tmp/enc24_links.txt");

// DB
const WRITE_DB = String(env("WRITE_DB", "0")) === "1";
const DATABASE_URL = env("DATABASE_URL", null);
const ACCOUNT_ID = env("ACCOUNT_ID", null); // nullable ok

function normalizeListingUrl(href) {
  try {
    const u = new URL(href, "https://www.encuentra24.com");

    // only listing details under autos-usados (not category root)
    if (!u.pathname.includes("/panama-es/autos-usados/")) return null;
    if (u.pathname.endsWith("/autos-usados")) return null;

    // filter obvious non-detail links
    if (u.pathname.includes("/searchresult")) return null;
    if (u.pathname.includes("/category")) return null;

    // remove fragments + normalize
    u.hash = "";
    return u.toString();
  } catch {
    return null;
  }
}

function looksPersonaSeller(_u) {
  // placeholder: keep it permissive.
  return true;
}

async function collectLinksFromPage(page) {
  const hrefs = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll("a[href]"));
    return a.map((x) => x.getAttribute("href")).filter(Boolean);
  });

  const urls = [];
  for (const href of hrefs) {
    const full = normalizeListingUrl(href);
    if (!full) continue;
    if (FILTER_PERSONAS && !looksPersonaSeller(full)) continue;
    urls.push(full);
  }
  return urls;
}

async function hasUniqueOn(db, schema, table, cols) {
  // cols: array of column names in order
  // checks UNIQUE indexes where indexed columns match exactly these cols
  const q = `
    select ix.indexrelid::regclass::text as index_name
    from pg_index ix
    join pg_class t on t.oid = ix.indrelid
    join pg_namespace ns on ns.oid = t.relnamespace
    join pg_class i on i.oid = ix.indexrelid
    where ns.nspname = $1
      and t.relname = $2
      and ix.indisunique = true
      and (select array_agg(a.attname order by k.ord)
           from unnest(ix.indkey) with ordinality as k(attnum, ord)
           join pg_attribute a on a.attrelid = t.oid and a.attnum = k.attnum
          ) = $3::text[]
    limit 1;
  `;
  const { rows } = await db.query(q, [schema, table, cols]);
  return rows?.length ? rows[0].index_name : null;
}

async function upsertListingsToDb(urls) {
  if (!WRITE_DB) return { inserted_or_updated: 0, skipped: urls.length };

  if (!DATABASE_URL) throw new Error("WRITE_DB=1 but DATABASE_URL is missing");

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  try {
    // decide conflict arbiter dynamically
    const uqListingUrl = await hasUniqueOn(db, "lead_hunter", "enc24_listings", ["listing_url"]);
    const uqHash = await hasUniqueOn(db, "lead_hunter", "enc24_listings", ["listing_url_hash"]);

    const arbiter = uqListingUrl ? "listing_url" : (uqHash ? "listing_url_hash" : null);
    if (!arbiter) {
      throw new Error("No UNIQUE index found on (listing_url) or (listing_url_hash). Create one to use ON CONFLICT.");
    }

    const rows = urls.map((u) => ({ url: u, hash: sha1(u) }));

    // Build SQL: we ALWAYS insert listing_url_hash too.
    // ON CONFLICT uses either listing_url or listing_url_hash depending on what's available.
    const q = `
      insert into lead_hunter.enc24_listings (
        id, account_id, source,
        listing_url, listing_url_hash,
        ok, stage, raw,
        first_seen_at, last_seen_at, updated_at
      )
      values ${rows.map((_, i) => `(
        gen_random_uuid(),
        $${i*3+1}::uuid,
        'encuentra24',
        $${i*3+2}::text,
        $${i*3+3}::text,
        true,
        0,
        $${rows.length*3 + 1}::jsonb,
        now(),
        now(),
        now()
      )`).join(",")}
      on conflict (${arbiter}) do update
      set
        listing_url = excluded.listing_url,
        listing_url_hash = excluded.listing_url_hash,
        ok = true,
        last_seen_at = now(),
        updated_at = now(),
        -- never lower stage
        stage = greatest(coalesce(lead_hunter.enc24_listings.stage,0), 0),
        raw = coalesce(lead_hunter.enc24_listings.raw, '{}'::jsonb)
              || jsonb_build_object(
                  'latest_discovery_at', now(),
                  'latest_category_url', $${rows.length*3 + 2}::text
                );
    `;

    const args = [];
    for (const r of rows) {
      args.push(ACCOUNT_ID); // can be null
      args.push(r.url);
      args.push(r.hash);
    }

    const rawPayload = {
      category_url: CATEGORY_URL,
      discovered_at: nowIso(),
      limit: LIMIT,
      headless: HEADLESS,
      filter_personas: FILTER_PERSONAS,
      count: urls.length,
      arbiter_used: arbiter,
    };
    args.push(JSON.stringify(rawPayload));
    args.push(CATEGORY_URL);

    await db.query("begin");
    await db.query(q, args);
    await db.query("commit");

    return { inserted_or_updated: rows.length, skipped: 0, arbiter_used: arbiter };
  } catch (e) {
    try { await db.query("rollback"); } catch {}
    throw e;
  } finally {
    await db.end().catch(() => {});
  }
}

async function main() {
  console.log(`[${nowIso()}] enc24 discover starting`, {
    CATEGORY_URL, LIMIT, HEADLESS, FILTER_PERSONAS, OUT, WRITE_DB
  });

  const browser = await chromium.launch({ headless: HEADLESS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  try {
    await page.goto(CATEGORY_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(900);

    // scroll to load more cards
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 1200).catch(() => {});
      await sleep(600);
    }

    const collected = await collectLinksFromPage(page);
    const uniq = Array.from(new Set(collected));
    const finalUrls = uniq.slice(0, LIMIT);

    fs.writeFileSync(OUT, finalUrls.join("\n") + "\n", "utf8");

    console.log(`[${nowIso()}] discovery done`, {
      collected_n: collected.length,
      unique_n: uniq.length,
      final_n: finalUrls.length,
      out_links: OUT,
    });

    const dbRes = await upsertListingsToDb(finalUrls);
    if (WRITE_DB) console.log(`[${nowIso()}] db upsert ok`, dbRes);

  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error("discover fatal:", e);
  process.exit(1);
});
