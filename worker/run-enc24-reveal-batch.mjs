// worker/run-enc24-reveal-batch.mjs (v3)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { resolveEncuentra24PhoneFromListing } from "./providers/phone-resolver/encuentra24_whatsapp_resolver.mjs";

function parseArg(name, def = null) {
  const a = process.argv.find((x) => x.startsWith(`${name}=`));
  if (!a) return def;
  return a.split("=").slice(1).join("=");
}
function hasFlag(flag) {
  return process.argv.includes(flag);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const SUPABASE_URL = process.env.SUPABASE_URL || "";
const KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SERVICE_ROLE_KEY ||
  "";

if (!SUPABASE_URL || !KEY) {
  throw new Error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SERVICE_ROLE / SERVICE_ROLE_KEY)");
}

const headed = hasFlag("--headed");
const limit = Number(parseArg("--limit", "5"));
const workerId = parseArg("--workerId", `local-${process.pid}`);

const saveShots = Number(parseArg("--saveShots", "0"));

const MIN_DELAY_MS = Number(parseArg("--minDelayMs", "15000")); // 15s
const MAX_DELAY_MS = Number(parseArg("--maxDelayMs", "30000")); // 30s

// default defer window
const DEFER_MIN = Number(parseArg("--deferMin", "120")); // 2h
const DEFER_MAX = Number(parseArg("--deferMax", "360")); // 6h

// if we detect hard not-revealed, defer longer
const HARD_DEFER_MIN = Number(parseArg("--hardDeferMin", "360")); // 6h
const HARD_DEFER_MAX = Number(parseArg("--hardDeferMax", "720")); // 12h

// optional: use ONE fixed profile for all tasks
const fixedProfile = parseArg("--profile", null);

// identity pool (rotate per task)
const emails = (parseArg("--emails", "pacho+e24_001@pachosanchez.com,pacho+e24_002@pachosanchez.com,pacho+e24_003@pachosanchez.com")).split(",").map(s => s.trim()).filter(Boolean);
const names  = (parseArg("--names", "Carlos,Luis,Ana")).split(",").map(s => s.trim()).filter(Boolean);
const phones = (parseArg("--phones", "67777777,67777778,67777779")).split(",").map(s => s.trim()).filter(Boolean);

const message = parseArg("--message", "Hola, me interesa. ¿Sigue disponible?");

const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
  "Content-Profile": "lead_hunter",
  "Accept-Profile": "lead_hunter",
};

function randBetween(a, b) {
  return Math.floor(a + Math.random() * (b - a + 1));
}

async function rpc(fn, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text);
  return text ? JSON.parse(text) : null;
}

async function claimTasks() {
  return await rpc("claim_enc24_reveal_tasks", { p_worker_id: workerId, p_limit: limit });
}

async function finishTask(taskId, ok, phone_e164, wa_link, raw, error) {
  return await rpc("finish_enc24_reveal_task", {
    p_task_id: taskId,
    p_ok: !!ok,
    p_phone_e164: phone_e164 || null,
    p_wa_link: wa_link || null,
    p_raw: raw || {},
    p_error: error || null,
  });
}

async function deferTask(taskId, minutes, error) {
  return await rpc("defer_enc24_reveal_task", {
    p_task_id: taskId,
    p_minutes: minutes,
    p_error: error || null,
  });
}

function ensureProfileDir(name) {
  const base = path.join(os.tmpdir(), "enc24_profiles");
  if (!fs.existsSync(base)) fs.mkdirSync(base, { recursive: true });
  const dir = path.join(base, name);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function isNotRevealed(reason = "", method = "") {
  const r = String(reason).toLowerCase();
  const m = String(method).toLowerCase();
  return (
    m.includes("not_revealed") ||
    r.includes("no apareció") ||
    r.includes("no aparecio") ||
    r.includes("no salió") ||
    r.includes("no salio") ||
    r.includes("no se mostró") ||
    r.includes("no se mostro") ||
    r.includes("no apareció número") ||
    r.includes("no aparecio numero") ||
    r.includes("click en llamar") ||
    r.includes("no apareció el número") ||
    r.includes("no aparecio el numero")
  );
}

function smellsSoftBlock(reason = "", method = "") {
  const r = String(reason).toLowerCase();
  const m = String(method).toLowerCase();
  return (
    isNotRevealed(reason, method) ||
    m.includes("not_revealed") ||
    r.includes("recaptcha") ||
    r.includes("captcha") ||
    r.includes("invalid") ||
    r.includes("blocked") ||
    r.includes("bot") ||
    r.includes("timeout") ||
    r.includes("demasiados") ||
    r.includes("intenta más tarde") ||
    r.includes("intenta mas tarde")
  );
}

function pick(arr, idx, fallback) {
  if (!arr || !arr.length) return fallback;
  return arr[idx % arr.length];
}

async function main() {
  console.log(`[enc24-reveal-batch:v3] worker=${workerId} headed=${headed} limit=${limit}`);
  if (fixedProfile) console.log(`[profile] fixed=${fixedProfile}`);

  const tasks = await claimTasks();
  if (!tasks?.length) {
    console.log("[enc24-reveal-batch] no tasks claimed");
    return;
  }

  let ok = 0, failed = 0, deferred = 0;

  for (let idx = 0; idx < tasks.length; idx++) {
    const t = tasks[idx];
    const url = t.listing_url;
    console.log(`\n[task] ${t.id} ${url}`);

    // Profile strategy:
    // - if --profile=... provided, use it for all tasks (best for session trust)
    // - else rotate 3 tmp profiles
    const profileDir = fixedProfile
      ? fixedProfile
      : ensureProfileDir(`p${(idx % 3) + 1}`);

    // rotate identity per task
    const email = pick(emails, idx, "pacho@pachosanchez.com");
    const name  = pick(names, idx, "pacho");
    const phone8 = pick(phones, idx, "67777777");

    console.log(`[id] email=${email} name=${name} phone8=${phone8}`);
    console.log(`[ctx] userDataDir=${profileDir}`);

    try {
      const r = await resolveEncuentra24PhoneFromListing(url, {
        headless: !headed,
        saveShots,
        userDataDir: profileDir,
        form: { email, name, phone8, message },
      });

      const success = !!r?.ok && !!r?.phone_e164;

      if (success) {
        await finishTask(t.id, true, r.phone_e164, r?.wa_link, r, null);
        ok++;
        console.log(`[ok] phone=${r.phone_e164}`);
      } else {
        const reason = r?.reason || "no phone revealed";
        const method = r?.method || "";

        // HARD RULE: not revealed -> defer longer + STOP RUN
        if (isNotRevealed(reason, method)) {
          const mins = randBetween(HARD_DEFER_MIN, HARD_DEFER_MAX);
          await deferTask(t.id, mins, reason);
          deferred++;
          console.log(`[defer-hard] ${mins}m reason=${reason}`);
          console.log(`[guard] not_revealed -> STOPPING run to avoid worsening trust-block`);
          break;
        }

        if (smellsSoftBlock(reason, method)) {
          const mins = randBetween(DEFER_MIN, DEFER_MAX);
          await deferTask(t.id, mins, reason);
          deferred++;
          console.log(`[defer] ${mins}m reason=${reason}`);
        } else {
          await finishTask(t.id, false, null, r?.wa_link, r, reason);
          failed++;
          console.log(`[fail] reason=${reason}`);
        }
      }
    } catch (e) {
      const msg = String(e?.message || e);
      const mins = randBetween(DEFER_MIN, DEFER_MAX);
      await deferTask(t.id, mins, msg);
      deferred++;
      console.log(`[defer-error] ${mins}m ${msg}`);
    }

    const d = randBetween(MIN_DELAY_MS, MAX_DELAY_MS);
    console.log(`[sleep] ${d}ms`);
    await sleep(d);
  }

  console.log(`\n[done] ok=${ok} failed=${failed} deferred=${deferred}`);
}

main().catch((e) => {
  console.error("[fatal]", e?.message || e);
  process.exit(1);
});
