import "dotenv/config";
import { Client } from "pg";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }

function envBool(name, def = false) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return def;
  if (["1", "true", "yes", "y", "si", "sí", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return def;
}

function envNum(name, def) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) ? n : def;
}

function computeBackoffMs(attempts) {
  // 10m, 20m, 40m, 80m, ... capped at 6h
  const base = 10 * 60_000;
  const cap = 6 * 60 * 60_000;
  const exp = Math.max(0, Number(attempts) - 1);
  return Math.min(cap, base * Math.pow(2, exp));
}

function parseExternalId(listingUrl) {
  const m = String(listingUrl || "").match(/\/(\d{6,})\b/);
  return m ? String(m[1]) : null;
}

function pickFirst(...vals) {
  for (const v of vals) {
    const s = v === null || v === undefined ? "" : String(v).trim();
    if (s) return s;
  }
  return null;
}

function buildGhlPayload(listingRow) {
  const url = String(listingRow.listing_url || "");
  const external_id = pickFirst(listingRow.external_id, parseExternalId(url));
  const stage1 = listingRow.raw?.stage1 ?? {};

  const listing_text = pickFirst(stage1?.listing_text, listingRow.raw?.listing_text);
  const year = (() => {
    const y = Number(stage1?.year);
    if (Number.isFinite(y) && y >= 1900 && y <= 2050) return y;
    const m = String(listing_text || "").match(/\b(19\d{2}|20\d{2})\b/);
    return m ? Number(m[1]) : null;
  })();

  // Stage1 "structured" fields (best-effort)
  const make = pickFirst(stage1?.make);
  const model = pickFirst(stage1?.model);
  const fuel = pickFirst(stage1?.fuel);
  const trans = pickFirst(stage1?.trans);
  const city = pickFirst(stage1?.city);
  const price = (() => {
    const p = Number(stage1?.price);
    return Number.isFinite(p) && p > 0 ? p : null;
  })();

  return {
    phone: listingRow.phone_e164 ?? null, // main phone for the lead/contact in GHL
    source: "encuentra24",
    external_id,
    url,
    make,
    model,
    year,
    price,
    km: null,
    trans,
    fuel,
    city,
    seller_name: listingRow.seller_name ?? null,
    seller_phone: listingRow.phone_e164 ?? null,
  };
}

async function enqueueFromListings(db, accountId, limit) {
  // Insert only once per (account_id, listing_url_hash)
  const q = `
    insert into lead_hunter.enc24_ghl_deliveries (account_id, listing_url, external_id, phone_e164, status)
    select
      l.account_id,
      l.listing_url,
      substring(l.listing_url from '/(\\d{6,})\\b') as external_id,
      l.phone_e164,
      'queued'
    from lead_hunter.enc24_listings l
    where l.account_id = $1::uuid
      and l.ok = true
      and nullif(l.phone_e164,'') is not null
      and not exists (
        select 1
        from lead_hunter.enc24_ghl_deliveries d
        where d.account_id = l.account_id
          and d.listing_url_hash = l.listing_url_hash
      )
    order by l.updated_at desc nulls last
    limit $2::int
    returning id;
  `;
  const { rowCount } = await db.query(q, [accountId, limit]);
  return rowCount || 0;
}

async function claimDue(db, accountId, limit) {
  const q = `
    with cand as (
      select d.id
      from lead_hunter.enc24_ghl_deliveries d
      where d.account_id = $1::uuid
        and d.status in ('queued','failed')
        and (d.next_attempt_at is null or d.next_attempt_at <= now())
      order by d.created_at asc
      limit $2::int
      for update skip locked
    )
    update lead_hunter.enc24_ghl_deliveries d
      set status = 'sending',
          attempts = attempts + 1,
          last_attempt_at = now(),
          updated_at = now()
    where d.id in (select id from cand)
    returning d.id, d.account_id, d.listing_url, d.external_id, d.attempts;
  `;
  const { rows } = await db.query(q, [accountId, limit]);
  return rows || [];
}

async function loadListing(db, accountId, listingUrl) {
  const q = `
    select
      l.account_id,
      l.listing_url,
      l.listing_url_hash,
      substring(l.listing_url from '/(\\d{6,})\\b') as external_id,
      l.seller_name,
      l.phone_e164,
      l.raw
    from lead_hunter.enc24_listings l
    where l.account_id = $1::uuid
      and l.listing_url = $2::text
    limit 1;
  `;
  const { rows } = await db.query(q, [accountId, listingUrl]);
  return rows?.[0] ?? null;
}

async function markSent(db, deliveryId, payload, resStatus, resText) {
  const q = `
    update lead_hunter.enc24_ghl_deliveries
    set status='sent',
        sent_at=now(),
        payload=$2::jsonb,
        response_status=$3::int,
        response_text=$4::text,
        last_error=null,
        next_attempt_at=null,
        updated_at=now()
    where id=$1::uuid;
  `;
  await db.query(q, [deliveryId, JSON.stringify(payload ?? {}), resStatus ?? null, resText ?? null]);
}

async function markFailed(db, deliveryId, attempts, payload, errMsg, resStatus, resText) {
  const backoffMs = computeBackoffMs(attempts);
  const nextIso = new Date(Date.now() + backoffMs).toISOString();
  const q = `
    update lead_hunter.enc24_ghl_deliveries
    set status='failed',
        payload=$2::jsonb,
        response_status=$3::int,
        response_text=$4::text,
        last_error=$5::text,
        next_attempt_at=$6::timestamptz,
        updated_at=now()
    where id=$1::uuid;
  `;
  await db.query(q, [deliveryId, JSON.stringify(payload ?? {}), resStatus ?? null, resText ?? null, String(errMsg || "failed"), nextIso]);
}

async function postJson(url, payload, timeoutMs) {
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(to);
  }
}

async function runOnce(db, opts) {
  const { accountId, webhookUrl, enqueueLimit, sendLimit, timeoutMs } = opts;

  const enq = await enqueueFromListings(db, accountId, enqueueLimit).catch(() => 0);
  const claimed = await claimDue(db, accountId, sendLimit);
  if (!claimed.length) {
    return { enqueued: enq, sent: 0, failed: 0, claimed: 0 };
  }

  let sent = 0;
  let failed = 0;

  for (const d of claimed) {
    const deliveryId = d.id;
    const attempts = Number(d.attempts || 1);

    try {
      const listing = await loadListing(db, accountId, d.listing_url);
      if (!listing || !listing.phone_e164) {
        await markFailed(db, deliveryId, attempts, {}, "missing_listing_or_phone", null, null);
        failed++;
        continue;
      }

      const payload = buildGhlPayload(listing);
      const r = await postJson(webhookUrl, payload, timeoutMs);
      if (r.ok) {
        await markSent(db, deliveryId, payload, r.status, r.text);
        sent++;
      } else {
        await markFailed(db, deliveryId, attempts, payload, `http_${r.status}`, r.status, r.text);
        failed++;
      }
    } catch (e) {
      await markFailed(db, deliveryId, attempts, {}, String(e?.message || e), null, null);
      failed++;
    }
  }

  return { enqueued: enq, sent, failed, claimed: claimed.length };
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("Missing DATABASE_URL");

  const accountId = String(process.env.ACCOUNT_ID || "").trim();
  if (!accountId) throw new Error("Missing ACCOUNT_ID (required)");

  const webhookUrl = String(process.env.ENC24_GHL_WEBHOOK_URL || "").trim();
  const enabled = envBool("ENC24_GHL_ENABLED", Boolean(webhookUrl));
  if (!enabled) {
    console.log(`[${nowIso()}] enc24-ghl disabled (set ENC24_GHL_ENABLED=1 and ENC24_GHL_WEBHOOK_URL=...)`);
    return;
  }
  if (!webhookUrl) throw new Error("Missing ENC24_GHL_WEBHOOK_URL");

  const LOOP = envBool("LOOP", true);
  const intervalMs = envNum("SLEEP_MS", 15_000);
  const enqueueLimit = envNum("ENQUEUE_LIMIT", 10);
  const sendLimit = envNum("LIMIT", 5);
  const timeoutMs = envNum("ENC24_GHL_TIMEOUT_MS", 12_000);

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  console.log(`[${nowIso()}] enc24-ghl-dispatch starting account_id=${accountId} loop=${LOOP} limit=${sendLimit}`);

  do {
    const out = await runOnce(db, { accountId, webhookUrl, enqueueLimit, sendLimit, timeoutMs });
    console.log(`[${nowIso()}] enc24-ghl tick`, out);
    if (!LOOP) break;
    await sleep(intervalMs);
  } while (true);

  await db.end().catch(() => {});
}

main().catch((e) => {
  console.error(`[${nowIso()}] fatal`, String(e?.message || e));
  process.exit(1);
});


