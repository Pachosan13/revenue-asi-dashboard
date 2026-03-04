import "dotenv/config";
import { Client } from "pg";
import { execFile } from "node:child_process";
import { getPgConfig, logPgConnect, logPgSslObject } from "./lib/pg-config.mjs";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }

const TICK_TIMEOUT_MS = Number(process.env.ENC24_TICK_TIMEOUT_MS || "60000");
const COLLECT_TIMEOUT_MS = Number(process.env.ENC24_COLLECT_TIMEOUT_MS || "25000");
const PG_QUERY_TIMEOUT_MS = Number(process.env.ENC24_PG_QUERY_TIMEOUT_MS || "20000");
const REVEAL_TIMEOUT_MS = Number(process.env.ENC24_REVEAL_TIMEOUT_MS || "30000");
const GHL_TIMEOUT_MS = Number(process.env.ENC24_GHL_TIMEOUT_MS || "15000");
const PROMOTE_TIMEOUT_MS = Number(process.env.ENC24_PROMOTE_TIMEOUT_MS || "20000");

function timeoutError(label, ms) {
  const e = new Error(label);
  e.code = label;
  e.timeout_ms = ms;
  return e;
}

async function withTimeout(promise, ms, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchWithTimeout(url, init, ms, timeoutLabel) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(timeoutError(timeoutLabel, ms)), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError" || String(e?.message || "").includes(timeoutLabel)) {
      throw timeoutError(timeoutLabel, ms);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function envBool(name, def = false) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return def;
  if (["1", "true", "yes", "y", "si", "sí", "on"].includes(v)) return true;
  if (["0", "false", "no", "n", "off"].includes(v)) return false;
  return def;
}

function panamaHourNow() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Panama",
    hour: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  return Number(parts.find((p) => p.type === "hour")?.value ?? "0");
}

function execNode(script, env) {
  return new Promise((resolve) => {
    execFile(process.execPath, [script], { env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      resolve({ ok: !err, err: err ? String(err.message || err) : null, stdout: String(stdout || ""), stderr: String(stderr || "") });
    });
  });
}

function setPhase(phaseRef, phase, accountId) {
  phaseRef.value = phase;
  console.log(`[${nowIso()}] phase=${phase} account_id=${accountId}`);
}

async function safeCloseDb(state) {
  const client = state.client;
  state.client = null;
  if (!client) return;
  await withTimeout(client.end().catch(() => {}), 5000, "pg_close_timeout_5s").catch(() => {});
}

async function getDbClient(state, pgConfig) {
  if (state.client) return state.client;
  logPgConnect(pgConfig.meta);
  logPgSslObject(pgConfig.ssl);
  const db = new Client(pgConfig);
  await withTimeout(db.connect(), PG_QUERY_TIMEOUT_MS, "pg_connect_timeout_20s");
  await withTimeout(db.query("SET statement_timeout = 20000"), PG_QUERY_TIMEOUT_MS, "pg_timeout_20s");
  await withTimeout(db.query("SET lock_timeout = 5000"), PG_QUERY_TIMEOUT_MS, "pg_timeout_20s");
  state.client = db;
  return db;
}

async function queryWithTimeout(state, phaseRef, accountId, text, values = []) {
  const db = state.client;
  if (!db) throw new Error("pg_not_connected");
  try {
    return await withTimeout(db.query(text, values), PG_QUERY_TIMEOUT_MS, "pg_timeout_20s");
  } catch (e) {
    const msg = String(e?.code || e?.message || e);
    if (msg.includes("pg_timeout_20s")) {
      console.error(`[${nowIso()}] pg_timeout_20s phase=${phaseRef.value} account_id=${accountId}`);
      await safeCloseDb(state);
    }
    throw e;
  }
}

async function promoteEnc24ToPublicLeads(state, phaseRef, accountId, limit) {
  // Idempotent upsert: public.leads has unique (account_id, phone)
  // We keep it minimal and store source-specific payload under enriched.enc24.
  const q = `
    insert into public.leads (account_id, phone, contact_name, status, enriched, updated_at)
    select
      l.account_id,
      l.phone_e164 as phone,
      nullif(l.seller_name,'') as contact_name,
      'new' as status,
      jsonb_build_object(
        'source', 'encuentra24',
        'enc24', jsonb_build_object(
          'listing_url', l.listing_url,
          'listing_url_hash', l.listing_url_hash,
          'stage', l.stage,
          'seller_name', l.seller_name,
          'wa_link', l.wa_link,
          'reason', l.reason,
          'raw', l.raw
        )
      ) as enriched,
      now() as updated_at
    from lead_hunter.enc24_listings l
    where l.account_id = $1::uuid
      and l.ok = true
      and nullif(l.phone_e164,'') is not null
    order by l.updated_at desc nulls last
    limit $2::int
    -- Match the partial unique index public.leads_account_phone_uq
    on conflict (account_id, phone) where phone is not null and length(phone) > 0
    do update set
      updated_at = now(),
      contact_name = coalesce(nullif(excluded.contact_name,''), public.leads.contact_name),
      status = coalesce(nullif(public.leads.status,''), excluded.status),
      enriched = coalesce(public.leads.enriched,'{}'::jsonb) || excluded.enriched
    returning id;
  `;
  const { rowCount } = await queryWithTimeout(
    state,
    phaseRef,
    accountId,
    q,
    [accountId, limit]
  );
  return Number(rowCount || 0);
}

async function tickOnce(state, phaseRef, accountId, settings) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const limit = Math.max(1, Math.min(Number(settings.max_new_per_tick ?? 2), 5));
  const maxPages = 1;
  const minYear = 2014;

  // 1) Collect (soft)
  setPhase(phaseRef, "collect_start", accountId);
  let collectJson = null;
  let collectErr = null;
  try {
    const collectRes = await fetchWithTimeout(
      `${SUPABASE_URL}/functions/v1/enc24-collect-stage1`,
      {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          account_id: accountId,
          country: settings.country ?? "PA",
          limit,
          maxPages,
          minYear,
          businessHoursOnly: false, // enforced here by the daemon window check
        }),
      },
      COLLECT_TIMEOUT_MS,
      "collect_timeout_25s",
    );
    const collectText = await withTimeout(
      collectRes.text().catch(() => ""),
      Math.max(1, COLLECT_TIMEOUT_MS - 1000),
      "collect_timeout_25s",
    );
    try { collectJson = collectText ? JSON.parse(collectText) : null; } catch { collectJson = { raw: collectText }; }
  } catch (e) {
    collectErr = String(e?.code || e?.message || e);
    console.error(`[${nowIso()}] collect_timeout_25s account_id=${accountId} err=${collectErr}`);
  }
  setPhase(phaseRef, "collect_done", accountId);

  // 2) Enqueue reveal tasks (soft).
  // New collector versions already enqueue, but we keep this fallback for compatibility.
  setPhase(phaseRef, "reveal_queue_start", accountId);
  let enqueueFallback = null;
  if (!collectJson || typeof collectJson !== "object" || !Object.prototype.hasOwnProperty.call(collectJson, "enqueued_reveal")) {
    try {
      const { rows } = await queryWithTimeout(
        state,
        phaseRef,
        accountId,
        "select lead_hunter.enqueue_enc24_reveal_tasks($1::int) as out",
        [limit]
      );
      enqueueFallback = rows?.[0]?.out ?? null;
    } catch (e) {
      console.error(`[${nowIso()}] reveal_queue_error account_id=${accountId} err=${String(e?.code || e?.message || e)}`);
      enqueueFallback = null;
    }
  }
  setPhase(phaseRef, "reveal_queue_done", accountId);

  // 3) Reveal worker (soft) — reuse existing robust worker via a child process (LOOP=0)
  setPhase(phaseRef, "reveal_run_start", accountId);
  let r = { ok: false, err: "reveal_not_run" };
  try {
    r = await withTimeout(
      execNode("worker/run-enc24-reveal-worker.mjs", {
        DATABASE_URL: process.env.DATABASE_URL,
        WORKER_ID: process.env.WORKER_ID || "enc24-autopilot",
        LIMIT: String(limit),
        LOOP: "0",
        // Default to headless so it doesn't interrupt local work; override with HEADLESS=0 if needed.
        HEADLESS: typeof process.env.HEADLESS === "string" ? process.env.HEADLESS : "1",
        SAVE_SHOTS: "0",
        ENC24_CDP: process.env.ENC24_CDP || "0",
        ENC24_CDP_URL: process.env.ENC24_CDP_URL || "",
        EXIT_ON_EMPTY: "1",
        EMPTY_POLLS_TO_EXIT: "1",
        EMPTY_SLEEP_MS: "5000",
      }),
      REVEAL_TIMEOUT_MS,
      "reveal_timeout_30s",
    );
  } catch (e) {
    r = { ok: false, err: String(e?.code || e?.message || e), stdout: "", stderr: "" };
    console.error(`[${nowIso()}] reveal_timeout_30s account_id=${accountId} err=${r.err}`);
  }
  setPhase(phaseRef, "reveal_run_done", accountId);

  // 4) Optional: dispatch revealed leads to GHL webhook (idempotent, separate queue)
  const GHL_URL = String(process.env.ENC24_GHL_WEBHOOK_URL || "").trim();
  const GHL_ENABLED = String(process.env.ENC24_GHL_ENABLED || "").trim() !== "0";
  const GHL_ACTIVE = GHL_ENABLED && Boolean(GHL_URL);
  let ghl = null;
  setPhase(phaseRef, "ghl_dispatch_start", accountId);
  if (GHL_ACTIVE) {
    try {
      ghl = await withTimeout(
        execNode("worker/run-enc24-ghl-dispatch.mjs", {
          DATABASE_URL: process.env.DATABASE_URL,
          ACCOUNT_ID: String(accountId),
          ENC24_GHL_WEBHOOK_URL: GHL_URL,
          ENC24_GHL_ENABLED: process.env.ENC24_GHL_ENABLED || "1",
          LIMIT: String(limit),          // send up to N per tick
          ENQUEUE_LIMIT: String(limit),  // enqueue up to N per tick
          LOOP: "0",
          SLEEP_MS: "1000",
        }),
        GHL_TIMEOUT_MS,
        "ghl_timeout_15s",
      );
    } catch (e) {
      ghl = { ok: false, err: String(e?.code || e?.message || e), stdout: "", stderr: "" };
      console.error(`[${nowIso()}] ghl_timeout_15s account_id=${accountId} err=${ghl.err}`);
    }
    if (/\S/.test(String(ghl?.stdout || ""))) {
      console.log(`[${nowIso()}] ghl_child_stdout account_id=${accountId}\n${ghl.stdout}`);
    }
    if (/\S/.test(String(ghl?.stderr || ""))) {
      console.error(`[${nowIso()}] ghl_child_stderr account_id=${accountId}\n${ghl.stderr}`);
    }
    console.log(
      `[${nowIso()}] ghl_child_exit account_id=${accountId} ok=${Boolean(ghl?.ok)} err=${String(ghl?.err ?? "")}`
    );
  }
  setPhase(phaseRef, "ghl_dispatch_done", accountId);

  // 5) Promote to public.leads so Command OS / UI can "see" leads (optional but defaults ON).
  const PROMOTE_ENABLED = envBool("ENC24_PROMOTE_PUBLIC_LEADS", true);
  let promoted = null;
  let promote_err = null;
  if (PROMOTE_ENABLED) {
    try {
      await withTimeout(
        promoteEnc24ToPublicLeads(state, phaseRef, accountId, limit),
        PROMOTE_TIMEOUT_MS,
        "promote_timeout_20s",
      ).then((n) => { promoted = n; });
    } catch (e) {
      promoted = 0;
      promote_err = String(e?.code || e?.message || e);
      console.error(`[${nowIso()}] promote_timeout_20s account_id=${accountId} err=${promote_err}`);
    }
  }

  return {
    collect: collectJson,
    collected_total: Number(collectJson?.collected_total ?? collectJson?.total_seen ?? 0),
    inserted: Number(collectJson?.inserted ?? collectJson?.upserted ?? 0),
    ok_true: Number(collectJson?.ok_true ?? 0),
    ok_false_by_reason: collectJson?.ok_false_by_reason ?? null,
    enqueued_reveal: Number(
      collectJson?.enqueued_reveal ??
      enqueueFallback?.inserted ??
      0
    ),
    enqueued_reveal_requeued: Number(
      collectJson?.enqueued_reveal_requeued ??
      enqueueFallback?.requeued ??
      0
    ),
    reveal_ok: r.ok,
    reveal_err: r.err,
    ghl_ok: ghl?.ok ?? null,
    ghl_err: ghl?.err ?? null,
    promoted_public_leads: promoted,
    promoted_public_leads_err: promote_err,
  };
}

async function runTick(state, phaseRef, accountId, settings) {
  setPhase(phaseRef, "tick_begin", accountId);
  const out = await tickOnce(state, phaseRef, accountId, settings);
  setPhase(phaseRef, "tick_done", accountId);
  return out;
}

async function main() {
  const pgConfig = getPgConfig();
  const RUN_ONCE = envBool("RUN_ONCE", false);
  const state = { client: null };

  await getDbClient(state, pgConfig);

  console.log(`[${nowIso()}] enc24 autopilot starting`);

  if (RUN_ONCE) {
    const phaseRef = { value: "settings_load_start" };
    const { rows } = await queryWithTimeout(
      state,
      phaseRef,
      "run_once",
      "select * from lead_hunter.enc24_autopilot_settings where enabled=true order by updated_at desc limit 1",
      []
    );
    console.log(`[${nowIso()}] RUN_ONCE ok settings_found=${Boolean(rows?.[0])}`);
    await safeCloseDb(state);
    return;
  }

  while (true) {
    try {
      await getDbClient(state, pgConfig);
      const phaseRef = { value: "settings_load_start" };
      console.log(`[${nowIso()}] phase=settings_load_start`);
      const { rows } = await queryWithTimeout(
        state,
        phaseRef,
        "settings",
        "select * from lead_hunter.enc24_autopilot_settings where enabled=true order by updated_at desc limit 1",
        []
      );
      console.log(`[${nowIso()}] phase=settings_load_done`);
      const s = rows?.[0] ?? null;
      if (!s) {
        await sleep(10_000);
        continue;
      }

      const hh = panamaHourNow();
      if (!(hh >= Number(s.start_hour) && hh < Number(s.end_hour))) {
        await sleep(60_000);
        continue;
      }

      const accountId = String(s.account_id);
      console.log(`[${nowIso()}] tick account_id=${accountId} max_new=${s.max_new_per_tick} window=${s.start_hour}-${s.end_hour} PTY`);
      try {
        await withTimeout(runTick(state, phaseRef, accountId, s), TICK_TIMEOUT_MS, "tick_timeout_60s");
      } catch (e) {
        const msg = String(e?.code || e?.message || e);
        if (msg.includes("tick_timeout_60s")) {
          console.error(`[${nowIso()}] tick_timeout_60s phase=${phaseRef.value} account_id=${accountId}`);
        } else {
          console.error(`[${nowIso()}] tick_error phase=${phaseRef.value} account_id=${accountId} err=${msg}`);
        }
      }

      const intervalMs = Math.max(1, Number(s.interval_minutes ?? 5)) * 60_000;
      await sleep(intervalMs);
    } catch (e) {
      console.error(`[${nowIso()}] tick_loop_error err=${String(e?.message || e)}`);
      await safeCloseDb(state);
      await sleep(30_000);
    }
  }
}

main().catch((e) => {
  console.error(`[${nowIso()}] fatal`, e);
  process.exit(1);
});


