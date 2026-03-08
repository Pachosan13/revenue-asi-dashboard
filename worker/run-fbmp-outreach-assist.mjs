/**
 * FB Marketplace Auto-Outreach Worker (Playwright)
 *
 * Persistent browser context keeps FB login alive across runs.
 * Claims pending items from lead_hunter.outreach_queue, opens
 * the listing in Marketplace, types a templated first message
 * via Messenger, and marks the item as sent.
 *
 * Rate-limited: max_per_hour with human-like jitter (30-90s).
 *
 * Env:
 *   DATABASE_URL        – PG connection string
 *   ACCOUNT_ID          – required
 *   WORKER_ID           – optional (defaults to hostname)
 *   OUTREACH_HEADLESS   – 0 (default, visible) | 1 (headless)
 *   OUTREACH_MAX_PER_HOUR – default 5
 *   FBMP_GHL_WEBHOOK_URL – GHL webhook for post-send dispatch
 *   FBMP_GHL_ENABLED     – 0 | 1
 *   LOOP                – 1 (default) | 0 (single pass)
 *   SLEEP_MS            – loop interval in ms (default 10000)
 */

import "dotenv/config";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Client } from "pg";
import { getPgConfig, logPgConnect, logPgSslObject } from "./lib/pg-config.mjs";
import { renderTemplate } from "./lib/message-templates.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Env ────────────────────────────────────────────────────

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

const ACCOUNT_ID = String(process.env.ACCOUNT_ID || "").trim();
const WORKER_ID = String(process.env.WORKER_ID || `fbmp-assist-${os.hostname()}`).trim();
const OUTREACH_HEADLESS = envBool("OUTREACH_HEADLESS", false);
const OUTREACH_MAX_PER_HOUR = envNum("OUTREACH_MAX_PER_HOUR", 5);
const FBMP_GHL_WEBHOOK_URL = String(process.env.FBMP_GHL_WEBHOOK_URL || "").trim();
const FBMP_GHL_ENABLED = envBool("FBMP_GHL_ENABLED", false);
const LOOP = envBool("LOOP", true);
const SLEEP_MS = envNum("SLEEP_MS", 10_000);
const JITTER_MIN_MS = 30_000;
const JITTER_MAX_MS = 90_000;
const USER_DATA_DIR = path.join(__dirname, ".fbmp-user-data");

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function jitterMs(min, max) { return min + Math.random() * (max - min); }
async function jitterSleep(min, max) { await sleep(jitterMs(min, max)); }

// ─── Rate limiter (sliding window) ─────────────────────────

let sentTimestamps = [];
function canSendNow(maxPerHour) {
  const oneHourAgo = Date.now() - 3600_000;
  sentTimestamps = sentTimestamps.filter((t) => t > oneHourAgo);
  return sentTimestamps.length < maxPerHour;
}

// ─── DB helpers ─────────────────────────────────────────────

async function loadSettings(db, accountId) {
  const q = `
    select * from lead_hunter.fbmp_outreach_settings
    where account_id = $1::uuid
    limit 1;
  `;
  const { rows } = await db.query(q, [accountId]);
  return rows?.[0] ?? {
    enabled: true,
    max_per_hour: OUTREACH_MAX_PER_HOUR,
    language: "es",
    message_template_es: "Hola — aun esta disponible este {{vehicle_title}} por {{price}}?",
    message_template_en: "Hi — is this {{vehicle_title}} still available for {{price}}?",
    ghl_webhook_url: FBMP_GHL_WEBHOOK_URL,
    ghl_enabled: FBMP_GHL_ENABLED,
  };
}

async function claimNext(db, accountId, workerId) {
  const q = `
    with cand as (
      select q.id
      from lead_hunter.outreach_queue q
      where q.account_id = $1::uuid
        and q.status = 'pending'
      order by q.created_at asc
      limit 1
      for update skip locked
    )
    update lead_hunter.outreach_queue q
    set status = 'pending',
        attempts = attempts + 1,
        claimed_by = $2::text,
        claimed_at = now(),
        updated_at = now()
    where q.id in (select id from cand)
    returning q.*;
  `;
  const { rows } = await db.query(q, [accountId, workerId]);
  return rows?.[0] ?? null;
}

async function updateStatus(db, id, status, extra = {}) {
  const tsCol = {
    opened: "opened_at",
    prepared: "prepared_at",
    sent: "sent_at",
  }[status];

  const sets = [`status = $2`, `updated_at = now()`];
  const vals = [id, status];
  let idx = 3;

  if (tsCol) {
    sets.push(`${tsCol} = now()`);
  }
  if (extra.message_rendered) {
    sets.push(`message_rendered = $${idx}`);
    vals.push(extra.message_rendered);
    idx++;
  }

  const q = `update lead_hunter.outreach_queue set ${sets.join(", ")} where id = $1::uuid;`;
  await db.query(q, vals);
}

async function markFailed(db, id, reason) {
  const q = `
    update lead_hunter.outreach_queue
    set status = 'failed',
        failed_reason = $2,
        updated_at = now()
    where id = $1::uuid;
  `;
  await db.query(q, [id, reason]);
}

async function markGhlDispatched(db, id) {
  const q = `
    update lead_hunter.outreach_queue
    set ghl_dispatched = true,
        ghl_dispatched_at = now(),
        updated_at = now()
    where id = $1::uuid;
  `;
  await db.query(q, [id]);
}

// ─── GHL dispatch ───────────────────────────────────────────

async function dispatchToGhl(webhookUrl, item, message) {
  const payload = {
    source: "facebook_marketplace",
    external_id: item.external_id,
    listing_url: item.listing_url,
    vehicle_title: item.vehicle_title,
    price: item.price,
    location: item.location,
    seller_name: item.seller_name,
    email: `fbmp-${item.external_id}@marketplace.lead`,
    message_sent: message,
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      console.log(`[${nowIso()}] ghl_dispatch_failed status=${res.status} body=${text.slice(0, 200)}`);
    }
    return res.ok;
  } catch (e) {
    console.log(`[${nowIso()}] ghl_dispatch_error ${e?.message || e}`);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── FB DOM interaction ─────────────────────────────────────

async function findMessageButton(page) {
  const selectors = [
    '[aria-label="Message"]',
    '[aria-label="Mensaje"]',
    '[aria-label="Message Seller"]',
    '[aria-label="Message seller"]',
    '[aria-label="Enviar mensaje"]',
    '[aria-label="Enviar mensaje al vendedor"]',
    '[aria-label="Send message"]',
    '[aria-label^="Send message to"]',
    '[aria-label^="Enviar mensaje a"]',
    'a[href*="messaging"][href*="marketplace"]',
  ];
  for (const sel of selectors) {
    const el = await page.$(sel);
    if (el && await el.isVisible().catch(() => false)) return el;
  }
  // Text-based fallback
  const loc = page.locator('[role="button"]:has-text("Message"), [role="button"]:has-text("Mensaje"), [role="button"]:has-text("Enviar mensaje")').first();
  if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) return loc;
  return null;
}

async function findMessageTextarea(page) {
  // Try role="textbox" first (classic FB)
  const tb = page.locator('[role="textbox"]').first();
  if (await tb.isVisible({ timeout: 3000 }).catch(() => false)) return tb;

  // Modern FB: visible textarea elements (no name attribute required)
  // Prefer the larger one (main page composer) over sidebar
  const textareas = await page.$$("textarea");
  let best = null;
  let bestArea = 0;
  for (const ta of textareas) {
    const box = await ta.boundingBox().catch(() => null);
    if (!box || box.width < 50 || box.height < 10) continue;
    const area = box.width * box.height;
    if (area > bestArea) {
      bestArea = area;
      best = ta;
    }
  }
  return best;
}

async function findSendButton(page) {
  const selectors = [
    '[aria-label="Send message"]',
    '[aria-label="Enviar mensaje"]',
    '[aria-label="Send"]',
    '[aria-label="Enviar"]',
    '[aria-label^="Send message to"]',
    '[aria-label^="Enviar mensaje a"]',
    '[role="button"]:has-text("Send message")',
    '[role="button"]:has-text("Enviar mensaje")',
  ];
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if (await loc.isVisible({ timeout: 3000 }).catch(() => false)) return loc;
  }
  return null;
}

// ─── Process single item ────────────────────────────────────

async function processItem(page, db, item, settings) {
  const { id, listing_url, vehicle_title, price, location, language_guess, seller_name } = item;

  console.log(`[${nowIso()}] processing id=${id} url=${listing_url}`);

  // 1. OPEN listing
  await updateStatus(db, id, "opened");
  let nav;
  try {
    nav = await page.goto(listing_url, { waitUntil: "domcontentloaded", timeout: 15_000 });
  } catch (e) {
    console.log(`[${nowIso()}] nav_error ${e?.message}`);
    await markFailed(db, id, "timeout");
    return false;
  }

  if (!nav || (nav.status && nav.status() >= 400)) {
    await markFailed(db, id, "blocked_login");
    return false;
  }

  // Check login wall
  const currentUrl = page.url();
  if (currentUrl.includes("/login") || currentUrl.includes("checkpoint")) {
    console.log(`[${nowIso()}] BLOCKED: login wall detected at ${currentUrl}`);
    await markFailed(db, id, "blocked_login");
    return false;
  }

  await jitterSleep(2000, 4000);

  // 2. FIND "Message Seller" button
  const msgButton = await findMessageButton(page);
  if (!msgButton) {
    console.log(`[${nowIso()}] no_button for ${listing_url}`);
    await markFailed(db, id, "no_button");
    return false;
  }

  // 3. CLICK message button
  try {
    await (msgButton.click ? msgButton.click() : msgButton.click());
  } catch (e) {
    console.log(`[${nowIso()}] click_error ${e?.message}`);
    await markFailed(db, id, "ui_changed");
    return false;
  }
  await jitterSleep(2000, 4000);

  // 4. FIND textarea and fill message
  const textarea = await findMessageTextarea(page);
  if (!textarea) {
    console.log(`[${nowIso()}] no_textarea for ${listing_url}`);
    await markFailed(db, id, "ui_changed");
    return false;
  }

  const template = (language_guess || "es") === "en"
    ? (settings.message_template_en || "Hi — is this {{vehicle_title}} still available for {{price}}?")
    : (settings.message_template_es || "Hola — aun esta disponible este {{vehicle_title}} por {{price}}?");
  const message = renderTemplate(template, { vehicle_title, price, seller_name, location });

  await textarea.fill(message);
  await updateStatus(db, id, "prepared", { message_rendered: message });
  await jitterSleep(1000, 2000);

  // 5. CLICK Send
  const sendButton = await findSendButton(page);
  if (!sendButton) {
    console.log(`[${nowIso()}] no_send_button for ${listing_url}`);
    await markFailed(db, id, "ui_changed");
    return false;
  }

  try {
    await sendButton.click();
  } catch (e) {
    console.log(`[${nowIso()}] send_click_error ${e?.message}`);
    await markFailed(db, id, "ui_changed");
    return false;
  }

  await jitterSleep(2000, 4000);
  await updateStatus(db, id, "sent");
  console.log(`[${nowIso()}] SENT id=${id} msg="${message.slice(0, 60)}..."`);

  // 6. GHL dispatch
  const ghlUrl = settings.ghl_webhook_url || FBMP_GHL_WEBHOOK_URL;
  const ghlEnabled = settings.ghl_enabled || FBMP_GHL_ENABLED;
  if (ghlEnabled && ghlUrl) {
    const ok = await dispatchToGhl(ghlUrl, item, message);
    if (ok) await markGhlDispatched(db, id);
  } else {
    console.warn(`[${nowIso()}] ghl_skip id=${id} ghl_enabled=${ghlEnabled} ghl_url=${ghlUrl ? "set" : "MISSING"}`);
  }

  return true;
}

// ─── Reset page after failure ───────────────────────────────

async function resetPage(context) {
  try {
    const pages = context.pages();
    if (pages.length) {
      await pages[0].goto("about:blank", { timeout: 5000 }).catch(() => {});
    }
  } catch {
    // ignore
  }
}

// ─── Main loop ──────────────────────────────────────────────

async function main() {
  if (!ACCOUNT_ID) throw new Error("Missing ACCOUNT_ID (required)");

  const pgConfig = getPgConfig();
  logPgConnect(pgConfig.meta);
  logPgSslObject(pgConfig.ssl);

  const db = new Client(pgConfig);
  await db.connect();

  console.log(`[${nowIso()}] fbmp-outreach starting account=${ACCOUNT_ID} worker=${WORKER_ID} headless=${OUTREACH_HEADLESS} max_per_hour=${OUTREACH_MAX_PER_HOUR}`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: OUTREACH_HEADLESS,
    slowMo: 200,
    locale: "en-US",
    viewport: { width: 1280, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  const page = context.pages()[0] ?? await context.newPage();

  let settings = await loadSettings(db, ACCOUNT_ID);
  let maxPerHour = settings.max_per_hour || OUTREACH_MAX_PER_HOUR;
  let settingsLoadedAt = Date.now();

  console.log(`[${nowIso()}] settings loaded max_per_hour=${maxPerHour} ghl_enabled=${settings.ghl_enabled}`);

  do {
    // Reload settings every 5 minutes
    if (Date.now() - settingsLoadedAt > 5 * 60_000) {
      settings = await loadSettings(db, ACCOUNT_ID);
      maxPerHour = settings.max_per_hour || OUTREACH_MAX_PER_HOUR;
      settingsLoadedAt = Date.now();
      console.log(`[${nowIso()}] settings reloaded max_per_hour=${maxPerHour} ghl_enabled=${settings.ghl_enabled}`);
    }

    if (!canSendNow(maxPerHour)) {
      console.log(`[${nowIso()}] RATE_LIMIT: ${sentTimestamps.length}/${maxPerHour} sent this hour, waiting...`);
      await sleep(60_000);
      continue;
    }

    const item = await claimNext(db, ACCOUNT_ID, WORKER_ID);
    if (!item) {
      await sleep(SLEEP_MS);
      continue;
    }

    try {
      const ok = await processItem(page, db, item, settings);
      if (ok) {
        sentTimestamps.push(Date.now());
      }
    } catch (e) {
      console.error(`[${nowIso()}] process_error id=${item.id} ${e?.message || e}`);
      await markFailed(db, item.id, "timeout").catch(() => {});
      await resetPage(context);
    }

    // Jitter between items
    await jitterSleep(JITTER_MIN_MS, JITTER_MAX_MS);
  } while (LOOP);

  console.log(`[${nowIso()}] fbmp-outreach done (single pass)`);
  await context.close().catch(() => {});
  await db.end().catch(() => {});
}

main().catch((e) => {
  console.error(`[${nowIso()}] fatal`, String(e?.message || e));
  process.exit(1);
});
