import "dotenv/config";
import pg from "pg";
import { resolveEncuentra24PhoneFromListing } from "./providers/phone-resolver/encuentra24_whatsapp_resolver.mjs";
import { getPgConfig, logPgConnect, logPgSslObject } from "./lib/pg-config.mjs";

const { Client } = pg;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }

function isValidEnc24ListingUrl(u) {
  try {
    const url = new URL(String(u));
    // allow both with/without www
    if (!/(\.|^)encuentra24\.com$/i.test(url.hostname)) return false;
    // must have a numeric listing id in path (what our resolver expects)
    if (!/\/\d{6,}\b/.test(url.pathname)) return false;
    // avoid obvious non-listing paths we’ve seen polluting tasks
    if (url.pathname.startsWith("/test/")) return false;
    // most of our pipeline is Panama autos; keep it permissive but block the known-bad
    return true;
  } catch {
    return false;
  }
}

const WORKER_ID = process.env.WORKER_ID || "local-macbook-hunter";
const ACCOUNT_ID = String(process.env.ACCOUNT_ID || "").trim();

const LIMIT = Number(process.env.LIMIT || "1");
const LOOP = String(process.env.LOOP || "1") === "1";
const SLEEP_MS = Number(process.env.SLEEP_MS || "2500");

// claim behavior
const STALE_SECONDS = Number(process.env.STALE_SECONDS || "600");
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS || "6");

// heartbeat
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || "20000");

// resolver opts
const RESOLVER_OPTS = {
  headless: String(process.env.HEADLESS || "1") === "1",
  saveShots: Number(process.env.SAVE_SHOTS || "0"),
  userDataDir: process.env.ENC24_USER_DATA_DIR || undefined,
  chromeChannel: process.env.ENC24_CHROME_CHANNEL || undefined,
  chromeExecutablePath: process.env.ENC24_CHROME_EXECUTABLE_PATH || undefined,
  maxCallClicks: Number(process.env.ENC24_MAX_CALL_CLICKS || "2"),
  form: {
    email: process.env.ENC24_FORM_EMAIL || "pacho@pachosanchez.com",
    name: process.env.ENC24_FORM_NAME || "Pacho",
    phone8: process.env.ENC24_FORM_PHONE8 || "67777777",
  },
  delays: {
    waitContactMs: Number(process.env.ENC24_WAIT_CONTACT_MS || 25000),
    beforePhoneTypeMs: Number(process.env.ENC24_BEFORE_PHONE_TYPE_MS || 600),
    typingDelayMs: Number(process.env.ENC24_TYPING_DELAY_MS || 90),
    afterFillMs: Number(process.env.ENC24_AFTER_FILL_MS || 900),
    afterClickCallMs: Number(process.env.ENC24_AFTER_CLICK_CALL_MS || 1800),
    waitTelMaxMs: Number(process.env.ENC24_WAIT_TEL_MAX_MS || 7000),
  },
};

// reliability controls (soft-block backoff)
let consecutiveSoftBlocks = 0;
const STOP_ON_SOFT_BLOCK = String(process.env.ENC24_STOP_ON_SOFT_BLOCK || "0") === "1";
const SOFT_BLOCK_STOP_THRESHOLD = Number(process.env.ENC24_SOFT_BLOCK_STOP_THRESHOLD || "2");
const SOFT_BLOCK_COOLDOWN_MS = Number(process.env.ENC24_SOFT_BLOCK_COOLDOWN_MS || "600000"); // 10 min

// empty-queue behavior (avoid noisy infinite polling when you run it manually)
const EXIT_ON_EMPTY = String(process.env.EXIT_ON_EMPTY || "0") === "1";
const EMPTY_POLLS_TO_EXIT = Number(process.env.EMPTY_POLLS_TO_EXIT || "3");
const EMPTY_SLEEP_MS = Number(process.env.EMPTY_SLEEP_MS || String(Math.max(SLEEP_MS, 15000)));
let emptyPolls = 0;

// ===============
// DB
// ===============
async function claimTasks(db) {
  if (!ACCOUNT_ID) return [];
  const q = `
    with picked as (
      select t.id
      from lead_hunter.enc24_reveal_tasks t
      join lead_hunter.enc24_listings l on l.listing_url = t.listing_url
      where l.account_id = $1::uuid
        and lead_hunter.is_valid_enc24_listing_url(t.listing_url)
        and (
          t.status = 'queued'
          or (
            t.status = 'claimed'
            and t.claimed_at is not null
            and t.claimed_at < now() - make_interval(secs => greatest($4::int, 30))
          )
        )
        and t.attempts < greatest($5::int, 1)
      order by t.priority desc, t.created_at
      limit greatest($3::int, 1)
      for update skip locked
    )
    update lead_hunter.enc24_reveal_tasks t
    set status = 'claimed',
        claimed_at = now(),
        claimed_by = $2::text,
        attempts = attempts + 1,
        updated_at = now()
    from picked
    where t.id = picked.id
    returning t.id, t.listing_url, t.attempts, t.priority;
  `;
  const { rows } = await db.query(q, [ACCOUNT_ID, WORKER_ID, LIMIT, STALE_SECONDS, MAX_ATTEMPTS]);
  return rows || [];
}

async function heartbeatTask(db, task_id) {
  // tolerante: si no existe la columna, no jodemos el worker
  try {
    const q = `
      update lead_hunter.enc24_reveal_tasks
      set last_heartbeat_at=now(), updated_at=now()
      where id=$1::uuid and claimed_by=$2::text;
    `;
    await db.query(q, [task_id, WORKER_ID]);
  } catch {
    // ignore (schema viejo)
  }
}

async function applyResultToListing(db, listing_url, res) {
  const q = `
    update lead_hunter.enc24_listings
    set
      ok = $2::boolean,
      stage = $3::text,
      method = nullif($4::text,''),
      reason = nullif($5::text,''),
      -- Never erase previously captured contact data on a failed re-run.
      phone_e164 = case
        when $4::text = 'filtered_commercial_seller' then null
        when nullif($6::text,'') is not null then nullif($6::text,'')
        else phone_e164
      end,
      wa_link = case
        when $4::text = 'filtered_commercial_seller' then null
        when nullif($7::text,'') is not null then nullif($7::text,'')
        else wa_link
      end,
      seller_name = nullif($9::text,''),
      raw = coalesce(raw,'{}'::jsonb) || $8::jsonb,
      updated_at = now(),
      last_seen_at = now()
    where listing_url = $1::text;
  `;
  await db.query(q, [
    listing_url,
    Boolean(res.ok),
    Boolean(res.ok) ? "reveal_ok" : "reveal_failed",
    String(res.method || ""),
    String(res.reason || ""),
    String(res.phone_e164 || ""),
    String(res.wa_link || ""),
    JSON.stringify(res.debug || res.raw || {}),
    String(res.seller_name || ""),
  ]);
}

async function finishTask(db, task_id, status, last_error = null) {
  const q = `
    update lead_hunter.enc24_reveal_tasks
    set status=$2::text,
        last_error=$3::text,
        updated_at=now()
    where id=$1::uuid;
  `;
  await db.query(q, [task_id, status, last_error]);
}

// ===============
// Work
// ===============
async function processOne(db, t) {
  const task_id = t.id;
  const listing_url = t.listing_url;

  console.log(`[${nowIso()}] start task=${task_id} url=${listing_url} attempts=${t.attempts} prio=${t.priority}`);

  // Fast reject: bad/non-listing URLs (e.g. /test/5) should not spend 25s waiting for selectors.
  if (!isValidEnc24ListingUrl(listing_url)) {
    const out = {
      ok: false,
      stage: 2,
      method: "invalid_listing_url",
      reason: "invalid_listing_url_format",
      phone_e164: null,
      wa_link: null,
      debug: { listing_url, note: "skipped_without_playwright" },
      soft_block: false,
    };
    try { await applyResultToListing(db, listing_url, out); } catch {}
    try { await finishTask(db, task_id, "failed", out.reason); } catch {}
    console.warn(`[${nowIso()}] skip task=${task_id} invalid listing_url=${listing_url}`);
    return { task_id, listing_url, status: "failed", phone_e164: null, wa_link: null, reason: out.reason, soft_block: false };
  }

  let stop = false;
  const hb = (async () => {
    while (!stop) {
      await heartbeatTask(db, task_id);
      await sleep(HEARTBEAT_MS);
    }
  })();

  try {
    const r = await resolveEncuentra24PhoneFromListing(listing_url, RESOLVER_OPTS);

    // dummy e164
    const formE164 = (() => {
      const d = String(RESOLVER_OPTS.form.phone8 || "").replace(/\D/g, "");
      return d.length === 8 ? `+507${d}` : null;
    })();

    const isDummy = formE164 && r?.phone_e164 && String(r.phone_e164) === String(formE164);

    // Duplicate phone detection: check both ok=true listings AND GHL deliveries history
    let isDuplicatePhone = false;
    if (r?.phone_e164 && !isDummy) {
      try {
        // Check 1: 2+ other ok=true listings with same phone
        const dupRes = await db.query(
          "SELECT count(*)::int as cnt FROM lead_hunter.enc24_listings WHERE phone_e164 = $1 AND ok = true AND listing_url != $2",
          [String(r.phone_e164), listing_url]
        );
        const existingOk = Number(dupRes.rows[0]?.cnt || 0);
        // Check 2: 3+ GHL deliveries already sent with same phone (across all time)
        const ghlRes = await db.query(
          "SELECT count(*)::int as cnt FROM lead_hunter.enc24_ghl_deliveries WHERE phone_e164 = $1 AND status = 'sent'",
          [String(r.phone_e164)]
        );
        const ghlSent = Number(ghlRes.rows[0]?.cnt || 0);
        if (existingOk >= 2 || ghlSent >= 3) {
          isDuplicatePhone = true;
          console.log(`[${nowIso()}] duplicate_phone_detected task=${task_id} phone=${r.phone_e164} existing_ok=${existingOk} ghl_sent=${ghlSent}`);
        }
      } catch (e) {
        console.warn(`[${nowIso()}] duplicate_phone_check_error task=${task_id}:`, e?.message);
      }
    }

    const isCommercial = Boolean(r?.seller_is_business) || isDuplicatePhone;
    console.log(`[${nowIso()}] seller_check task=${task_id} seller_name=${r?.seller_name || "-"} seller_is_business=${r?.seller_is_business} duplicate_phone=${isDuplicatePhone} seller_type=${r?.debug?.seller?.seller_type || "-"} method=${r?.method || "-"}`);
    const ok = Boolean(r?.ok) && !isCommercial && !isDummy && Boolean(r?.phone_e164 || r?.wa_link);
    const softBlocked = String(r?.reason || "").includes("soft_block");

    const out = {
      ok,
      stage: 2,
      method: isCommercial ? "filtered_commercial_seller" : (isDummy ? "dummy_phone_detected" : String(r?.method || "")),
      reason: isCommercial ? (isDuplicatePhone ? "duplicate_phone_dealer" : "seller_name_commercial") : (isDummy ? "returned_phone_equals_form_phone" : String(r?.reason || "")),
      phone_e164: ok ? (r?.phone_e164 || null) : null,
      wa_link: ok ? (r?.wa_link || null) : null,
      seller_name: r?.seller_name || null,
      debug: {
        ...(r?.debug || {}),
        seller_name: r?.seller_name || null,
        seller_is_business: Boolean(r?.seller_is_business),
        duplicate_phone: isDuplicatePhone,
        filtered_commercial: isCommercial,
        extracted_phone_e164: r?.phone_e164 || null,
        extracted_wa_link: r?.wa_link || null,
      },
      soft_block: softBlocked,
    };

    await applyResultToListing(db, listing_url, out);

    const status = ok ? "done" : "failed";
    const lastErr = ok ? null : (out.reason || out.method || "no_phone_no_wa");
    await finishTask(db, task_id, status, lastErr);

    console.log(
      `[${nowIso()}] done task=${task_id} status=${status} phone=${out.phone_e164 || "-"} wa=${out.wa_link ? "yes" : "no"} reason=${out.reason || "-"}`
    );

    return { task_id, listing_url, status, phone_e164: out.phone_e164, wa_link: out.wa_link, reason: out.reason, soft_block: softBlocked };

  } catch (e) {
    const msg = String(e?.message || e);
    console.error(`[${nowIso()}] FAIL task=${task_id}:`, msg);
    try { await finishTask(db, task_id, "failed", msg); } catch {}
    return { task_id, listing_url, status: "failed", error: msg };
  } finally {
    stop = true;
    await hb.catch(() => {});
  }
}

async function sweepExhausted(db) {
  if (!ACCOUNT_ID) return 0;
  try {
    const { rowCount } = await db.query(`
      update lead_hunter.enc24_reveal_tasks t
      set status = 'failed', last_error = 'max_attempts_exhausted', updated_at = now()
      from lead_hunter.enc24_listings l
      where l.listing_url = t.listing_url
        and l.account_id = $1::uuid
        and t.status in ('queued','claimed')
        and t.attempts >= $2::int
    `, [ACCOUNT_ID, MAX_ATTEMPTS]);
    if (rowCount) console.log(`[${nowIso()}] event=sweep_exhausted count=${rowCount}`);
    return rowCount || 0;
  } catch (e) {
    console.warn(`[${nowIso()}] sweep_exhausted_error:`, e?.message);
    return 0;
  }
}

async function mainOnce(db) {
  await sweepExhausted(db);
  const tasks = await claimTasks(db);
  console.log(`[${nowIso()}] event=reveal_worker_pick n=${tasks.length} status=queued`);
  if (!tasks.length) {
    console.log(`[${nowIso()}] event=reveal_worker_empty reason=no_tasks account_id=${ACCOUNT_ID}`);
    return { claimed: 0, done: 0, failed: 0 };
  }

  console.log(`[${nowIso()}] claimed ${tasks.length} tasks as ${WORKER_ID}`);

  let done = 0, failed = 0;
  for (const t of tasks) {
    const out = await processOne(db, t);
    if (out.status === "done") done++;
    else failed++;

    if (out.soft_block) {
      consecutiveSoftBlocks++;
      console.warn(`[${nowIso()}] soft-block signal detected (consecutive=${consecutiveSoftBlocks}) task=${out.task_id}`);
      if (STOP_ON_SOFT_BLOCK && consecutiveSoftBlocks >= SOFT_BLOCK_STOP_THRESHOLD) {
        console.warn(
          `[${nowIso()}] stopping worker due to consecutive soft-blocks threshold=${SOFT_BLOCK_STOP_THRESHOLD}; cooling down for ${SOFT_BLOCK_COOLDOWN_MS}ms`
        );
        await sleep(SOFT_BLOCK_COOLDOWN_MS);
        process.exit(0);
      }
    } else {
      consecutiveSoftBlocks = 0;
    }

    console.log(out);
    await sleep(600 + Math.floor(Math.random() * 800));
  }
  return { claimed: tasks.length, done, failed };
}

async function main() {
  const pgConfig = getPgConfig();
  logPgConnect(pgConfig.meta);
  logPgSslObject(pgConfig.ssl);
  const db = new Client(pgConfig);
  await db.connect();

  console.log(`[${nowIso()}] event=reveal_worker_start account_id=${ACCOUNT_ID} limit=${LIMIT}`);
  console.log(`[${nowIso()}] enc24 reveal worker starting`, {
    WORKER_ID, ACCOUNT_ID, LIMIT, LOOP, SLEEP_MS,
    STALE_SECONDS, MAX_ATTEMPTS, HEARTBEAT_MS,
    HEADLESS: RESOLVER_OPTS.headless,
    SAVE_SHOTS: RESOLVER_OPTS.saveShots,
    ENC24_USER_DATA_DIR: RESOLVER_OPTS.userDataDir || "",
    ENC24_CHROME_CHANNEL: RESOLVER_OPTS.chromeChannel || "",
    ENC24_CHROME_EXECUTABLE_PATH: RESOLVER_OPTS.chromeExecutablePath || "",
    ENC24_IGNORE_ENABLE_AUTOMATION: process.env.ENC24_IGNORE_ENABLE_AUTOMATION || "",
    ENC24_STOP_ON_SOFT_BLOCK: STOP_ON_SOFT_BLOCK,
    ENC24_SOFT_BLOCK_STOP_THRESHOLD: SOFT_BLOCK_STOP_THRESHOLD,
    ENC24_SOFT_BLOCK_COOLDOWN_MS: SOFT_BLOCK_COOLDOWN_MS,
    EXIT_ON_EMPTY,
    EMPTY_POLLS_TO_EXIT,
    EMPTY_SLEEP_MS,
    ENC24_CDP: process.env.ENC24_CDP || "",
    ENC24_CDP_URL: process.env.ENC24_CDP_URL || "",
    ENC24_SHOTS_DIR: process.env.ENC24_SHOTS_DIR || "",
  });

  try {
    let last = { claimed: 0, done: 0, failed: 0 };
    do {
      const r = await mainOnce(db);
      last = r;
      if (!LOOP) break;
      if (r.claimed === 0) {
        emptyPolls++;
        if (EXIT_ON_EMPTY && emptyPolls >= Math.max(1, EMPTY_POLLS_TO_EXIT)) {
          console.log(
            `[${nowIso()}] exiting after empty polls=${emptyPolls} (EXIT_ON_EMPTY=1)`
          );
          break;
        }
        await sleep(EMPTY_SLEEP_MS);
      } else {
        emptyPolls = 0;
      }
    } while (true);
    console.log(`[${nowIso()}] event=reveal_worker_done ok=true processed=${last.done + last.failed} failed=${last.failed}`);
  } finally {
    await db.end().catch(() => {});
  }
}

main().catch((e) => {
  console.error("worker fatal:", e);
  process.exit(1);
});
