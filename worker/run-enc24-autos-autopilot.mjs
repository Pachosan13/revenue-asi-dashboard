import "dotenv/config";
import { Client } from "pg";
import { execFile } from "node:child_process";

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }

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

async function tickOnce(db, accountId, settings) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const limit = Math.max(1, Math.min(Number(settings.max_new_per_tick ?? 2), 5));
  const maxPages = 1;
  const minYear = 2014;

  // 1) Collect (soft)
  const collectRes = await fetch(`${SUPABASE_URL}/functions/v1/enc24-collect-stage1`, {
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
  });
  const collectText = await collectRes.text().catch(() => "");
  let collectJson = null;
  try { collectJson = collectText ? JSON.parse(collectText) : null; } catch { collectJson = { raw: collectText }; }

  // 2) Enqueue reveal tasks (soft)
  await db.query("select lead_hunter.enqueue_enc24_reveal_tasks($1::int)", [limit]).catch(() => {});

  // 3) Reveal worker (soft) — reuse existing robust worker via a child process (LOOP=0)
  const r = await execNode("worker/run-enc24-reveal-worker.mjs", {
    DATABASE_URL: process.env.DATABASE_URL,
    WORKER_ID: process.env.WORKER_ID || "enc24-autopilot",
    LIMIT: String(limit),
    LOOP: "0",
    // Default to headless so it doesn't interrupt local work; override with HEADLESS=0 if needed.
    HEADLESS: typeof process.env.HEADLESS === "string" ? process.env.HEADLESS : "1",
    SAVE_SHOTS: "0",
    ENC24_CDP: process.env.ENC24_CDP || "1",
    ENC24_CDP_URL: process.env.ENC24_CDP_URL || "http://127.0.0.1:9222",
    EXIT_ON_EMPTY: "1",
    EMPTY_POLLS_TO_EXIT: "1",
    EMPTY_SLEEP_MS: "5000",
  });

  // 4) Optional: dispatch revealed leads to GHL webhook (idempotent, separate queue)
  const GHL_URL = String(process.env.ENC24_GHL_WEBHOOK_URL || "").trim();
  const GHL_ENABLED = String(process.env.ENC24_GHL_ENABLED || "").trim() !== "0";
  let ghl = null;
  if (GHL_ENABLED && GHL_URL) {
    ghl = await execNode("worker/run-enc24-ghl-dispatch.mjs", {
      DATABASE_URL: process.env.DATABASE_URL,
      ACCOUNT_ID: String(accountId),
      ENC24_GHL_WEBHOOK_URL: GHL_URL,
      ENC24_GHL_ENABLED: process.env.ENC24_GHL_ENABLED || "1",
      LIMIT: String(limit),          // send up to N per tick
      ENQUEUE_LIMIT: String(limit),  // enqueue up to N per tick
      LOOP: "0",
      SLEEP_MS: "1000",
    });
  }

  return { collect: collectJson, reveal_ok: r.ok, reveal_err: r.err, ghl_ok: ghl?.ok ?? null, ghl_err: ghl?.err ?? null };
}

async function main() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error("Missing DATABASE_URL");

  const db = new Client({ connectionString: DATABASE_URL });
  await db.connect();

  console.log(`[${nowIso()}] enc24 autopilot starting`);

  while (true) {
    try {
      const { rows } = await db.query(
        "select * from lead_hunter.enc24_autopilot_settings where enabled=true order by updated_at desc limit 1"
      );
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
      const out = await tickOnce(db, accountId, s);
      console.log(`[${nowIso()}] tick done`, out);

      const intervalMs = Math.max(1, Number(s.interval_minutes ?? 5)) * 60_000;
      await sleep(intervalMs);
    } catch (e) {
      console.error(`[${nowIso()}] tick error`, String(e?.message || e));
      await sleep(30_000);
    }
  }
}

main().catch((e) => {
  console.error(`[${nowIso()}] fatal`, e);
  process.exit(1);
});


