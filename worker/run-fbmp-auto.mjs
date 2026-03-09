/**
 * FBMP Auto-Orchestrator
 *
 * Full cycle: Scrape → Outreach → Monitor → Sleep → Repeat
 *
 * Cycle:
 *   0. [Every N cycles] Scrape via Apify → import & qualify → enqueue
 *   1. Outreach single pass (sends messages to pending items)
 *   2. Monitor single pass  (checks replies on sent items)
 *   3. Sleep CYCLE_SLEEP_MS (default 5 min)
 *   4. Repeat
 *
 * Env:
 *   ACCOUNT_ID              – required
 *   CYCLE_SLEEP_MS          – sleep between cycles (default 300000 = 5min)
 *   SCRAPE_EVERY_N_CYCLES   – run scraper every N cycles (default 6 → ~30min)
 *   SCRAPE_TIMEOUT_MS       – max time for scraper child (default 600000 = 10min)
 *   OUTREACH_HEADLESS       – 0 | 1 (default 1)
 *   MONITOR_HEADLESS        – 0 | 1 (default 1)
 *   All env vars from apify-trigger, outreach, and monitor workers are passed through.
 */

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CYCLE_SLEEP_MS = Number(process.env.CYCLE_SLEEP_MS) || 300_000; // 5 min
const SCRAPE_EVERY_N_CYCLES = Number(process.env.SCRAPE_EVERY_N_CYCLES) || 6;
const SCRAPE_TIMEOUT_MS = Number(process.env.SCRAPE_TIMEOUT_MS) || 600_000; // 10 min
const ACCOUNT_ID = process.env.ACCOUNT_ID;

if (!ACCOUNT_ID) {
  console.error("Missing ACCOUNT_ID");
  process.exit(1);
}

function nowIso() { return new Date().toISOString(); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function runWorker(script, extraEnv = {}, timeoutMs = 0) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      LOOP: "0",              // single pass always
      EXIT_ON_EMPTY: "1",
      EMPTY_POLLS_TO_EXIT: "1",
      ...extraEnv,
    };

    const child = spawn("node", [path.join(__dirname, script)], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        console.error(`[${nowIso()}] timeout_kill ${script} after ${timeoutMs}ms`);
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 5000);
      }, timeoutMs);
    }

    child.stdout.on("data", (d) => process.stdout.write(d));
    child.stderr.on("data", (d) => process.stderr.write(d));

    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve(code);
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      console.error(`[${nowIso()}] spawn_error ${script}: ${err.message}`);
      resolve(1);
    });
  });
}

async function main() {
  console.log(`[${nowIso()}] fbmp-auto starting account=${ACCOUNT_ID} cycle_sleep=${CYCLE_SLEEP_MS / 1000}s scrape_every=${SCRAPE_EVERY_N_CYCLES} scrape_timeout=${SCRAPE_TIMEOUT_MS / 1000}s`);

  let cycle = 0;
  while (true) {
    cycle++;
    console.log(`\n[${nowIso()}] ═══ cycle ${cycle} ═══`);

    // 0. Scrape — every N cycles, fetch new listings via Apify
    if (cycle === 1 || cycle % SCRAPE_EVERY_N_CYCLES === 0) {
      console.log(`[${nowIso()}] → scrape pass (via Apify)`);
      const scrapeCode = await runWorker("run-fbmp-apify-trigger.mjs", {
        LOOP: "0",
      }, SCRAPE_TIMEOUT_MS);
      console.log(`[${nowIso()}] ← scrape done (exit=${scrapeCode})`);
      await sleep(2000);
    }

    // 1. Outreach — send messages to pending items
    console.log(`[${nowIso()}] → outreach pass`);
    const outreachCode = await runWorker("run-fbmp-outreach-assist.mjs", {
      OUTREACH_HEADLESS: process.env.OUTREACH_HEADLESS || "1",
    });
    console.log(`[${nowIso()}] ← outreach done (exit=${outreachCode})`);

    // Small gap to ensure browser lock is fully released
    await sleep(3000);

    // 2. Monitor — check replies on sent items
    console.log(`[${nowIso()}] → monitor pass`);
    const monitorCode = await runWorker("run-fbmp-reply-monitor.mjs", {
      MONITOR_HEADLESS: process.env.MONITOR_HEADLESS || "1",
      CHECK_INTERVAL_MINUTES: process.env.CHECK_INTERVAL_MINUTES || "30",
    });
    console.log(`[${nowIso()}] ← monitor done (exit=${monitorCode})`);

    // 3. Sleep before next cycle
    console.log(`[${nowIso()}] sleeping ${CYCLE_SLEEP_MS / 1000}s...`);
    await sleep(CYCLE_SLEEP_MS);
  }
}

main().catch((e) => {
  console.error(`[${nowIso()}] fatal`, e?.message || e);
  process.exit(1);
});
