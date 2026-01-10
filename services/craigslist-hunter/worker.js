/* eslint-disable no-console */
// Local Craigslist V0 worker (Playwright).
//
// Env:
// - SUPABASE_URL
// - SUPABASE_SERVICE_ROLE_KEY
// - WORKER_ID (optional)
//
// V0 constraints:
// - Only city mapping supported: "miami" -> miami.craigslist.org
// - Jitter pacing 2–4s between pages
// - If 403/503: retry once, then mark failed
//
// Env (worker runtime knobs):
// - CL_HEADLESS (default "0")
// - CL_SLOWMO (default "150")
// - CL_HARD_TIMEOUT_MS (default "15000")
// - CL_WAIT_SELECTOR_MS (default "12000")
// - CL_JITTER_MIN_MS (default "2000")
// - CL_JITTER_MAX_MS (default "4000")
// - CL_SCREENSHOT_DIR (default "/tmp")
// - CL_MAX_DISCOVER (default "50")
// - CL_LOG_EVIDENCE (default "1")

const { chromium } = require("playwright");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const WORKER_ID = (process.env.WORKER_ID || `craigslist-hunter-${os.hostname()}`).trim();

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

function envInt(name, def, min, max) {
  const raw = String(process.env[name] ?? "").trim();
  const n = raw ? Number(raw) : def;
  const v = Number.isFinite(n) ? n : def;
  const lo = typeof min === "number" ? min : v;
  const hi = typeof max === "number" ? max : v;
  return Math.min(Math.max(v, lo), hi);
}

function envBool(name, defBool) {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return defBool;
  if (raw === "1" || raw === "true" || raw === "yes") return true;
  if (raw === "0" || raw === "false" || raw === "no") return false;
  return defBool;
}

const CL_HEADLESS = envBool("CL_HEADLESS", false);
const CL_SLOWMO = envInt("CL_SLOWMO", 150, 0, 2000);
const CL_HARD_TIMEOUT_MS = envInt("CL_HARD_TIMEOUT_MS", 15000, 1000, 120000);
const CL_WAIT_SELECTOR_MS = envInt("CL_WAIT_SELECTOR_MS", 12000, 500, 120000);
const CL_JITTER_MIN_MS = envInt("CL_JITTER_MIN_MS", 2000, 0, 60000);
const CL_JITTER_MAX_MS = envInt("CL_JITTER_MAX_MS", 4000, 0, 60000);
const CL_SCREENSHOT_DIR = String(process.env.CL_SCREENSHOT_DIR ?? "/tmp").trim() || "/tmp";
const CL_MAX_DISCOVER = envInt("CL_MAX_DISCOVER", 50, 1, 200);
const CL_LOG_EVIDENCE = envBool("CL_LOG_EVIDENCE", true);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitterMs(min = 2000, max = 4000) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.floor(lo + Math.random() * (hi - lo + 1));
}

function toLower(v) {
  return String(v || "").trim().toLowerCase();
}

function extractPostingId(url) {
  const m = String(url || "").match(/\/(\d{6,})\.html(?:$|\?)/);
  return m ? String(m[1]) : null;
}

function safeSlug(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "unknown";
}

function hasPersonalSellerSignals(description) {
  const d = toLower(description);
  const rejectTokens = ["dealer", "financing", "inventory", "we offer", "call our office"];
  return !rejectTokens.some((t) => d.includes(t));
}

function cityToSite(city) {
  const c = toLower(city);
  if (c.includes("miami")) return "miami";
  return null; // V0
}

function headersFor(schema) {
  const h = {
    apikey: SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
  };
  if (schema) {
    h["Content-Profile"] = schema;
    h["Accept-Profile"] = schema;
  }
  return h;
}

async function rpc(schema, fnName, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fnName}`, {
    method: "POST",
    headers: headersFor(schema),
    body: JSON.stringify(args || {}),
  });
  const text = await res.text().catch(() => "");
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    throw new Error(`rpc_${fnName}_failed:${res.status}:${text}`);
  }
  return json;
}

async function insertLeadHunterTasks(rows) {
  if (!rows.length) return 0;

  // Use ON CONFLICT (account_id, external_id) for detail tasks; works with partial unique index when task_type='detail'.
  const url = `${SUPABASE_URL}/rest/v1/craigslist_tasks_v1?on_conflict=account_id,external_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headersFor("lead_hunter"),
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    console.error("INSERT_TASKS_FAILED", { status: res.status, body_head: String(text || "").slice(0, 800) });
    throw new Error(`insert_tasks_failed:${res.status}:${text}`);
  }

  // When ignore-duplicates, returned rows may be subset.
  let json = [];
  try {
    json = text ? JSON.parse(text) : [];
  } catch {
    json = [];
  }
  const inserted = Array.isArray(json) ? json.length : 0;
  console.log("INSERT_TASKS_OK", { inserted });
  return inserted;
}

async function upsertPublicLead(row) {
  const url = `${SUPABASE_URL}/rest/v1/leads?on_conflict=account_id,source,external_id`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...headersFor(null),
      Prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify([row]),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    console.error("UPSERT_PUBLIC_LEAD_FAILED", { status: res.status, body_head: String(text || "").slice(0, 800) });
    throw new Error(`upsert_public_lead_failed:${res.status}:${text}`);
  }
}

async function gotoWithRetry(page, url) {
  const attempt = async () => page.goto(url, { waitUntil: "domcontentloaded", timeout: CL_HARD_TIMEOUT_MS });

  let res = await attempt();
  let status = res ? res.status() : 0;
  if (status === 403 || status === 503) {
    await sleep(jitterMs(CL_JITTER_MIN_MS, CL_JITTER_MAX_MS));
    res = await attempt();
    status = res ? res.status() : 0;
  }

  return { response: res, status };
}

async function run() {
  const userDataDir = path.join(__dirname, ".cl-user-data");
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(CL_SCREENSHOT_DIR, { recursive: true });

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: CL_HEADLESS,
    slowMo: CL_SLOWMO,
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
    locale: "en-US",
  });
  let page = context.pages()[0] ?? (await context.newPage());
  try {
    page.setDefaultTimeout(CL_WAIT_SELECTOR_MS);
    page.setDefaultNavigationTimeout(CL_HARD_TIMEOUT_MS);
  } catch {
    // ignore
  }

  async function resetPage(reason) {
    console.log("RESET_PAGE", { reason });
    try {
      if (page) await page.close({ runBeforeUnload: false });
    } catch {
      // ignore
    }
    page = await context.newPage();
    try {
      page.setDefaultTimeout(CL_WAIT_SELECTOR_MS);
      page.setDefaultNavigationTimeout(CL_HARD_TIMEOUT_MS);
    } catch {
      // ignore
    }
  }

  async function writeEvidence(taskType, city, reason) {
    if (!CL_LOG_EVIDENCE) return null;
    const ts = Date.now();
    const safeCity = safeSlug(city);
    const safeType = safeSlug(taskType);
    const base = `cl_fail_${safeType}_${safeCity}_${ts}`;
    const pngPath = path.join(CL_SCREENSHOT_DIR, `${base}.png`);
    const htmlPath = path.join(CL_SCREENSHOT_DIR, `${base}.html`);

    try {
      const html = await page.content().catch(() => "");
      fs.writeFileSync(htmlPath, html, "utf8");
    } catch {
      // ignore
    }

    try {
      await page.screenshot({ path: pngPath, fullPage: true }).catch(() => {});
    } catch {
      // ignore
    }

    console.log("EVIDENCE", { reason, screenshot: pngPath, html: htmlPath });
    return { screenshot: pngPath, html: htmlPath };
  }

  async function gotoWithRetryHard(url, meta) {
    const hardTimeoutMs = CL_HARD_TIMEOUT_MS;
    const pHandled = gotoWithRetry(page, url).catch((e) => ({ error: e }));
    const timeoutP = new Promise((resolve) => setTimeout(() => resolve({ __timeout: true }), hardTimeoutMs));

    const result = await Promise.race([pHandled, timeoutP]);
    if (result && result.__timeout) {
      console.log("FAIL", { taskType: meta?.taskType, city: meta?.city, url, reason: "goto_timeout" });
      await writeEvidence(meta?.taskType || "unknown", meta?.city || "unknown", "goto_timeout");
      try {
        await page.close({ runBeforeUnload: false });
      } catch {
        // ignore
      }
      // Ensure we don't leave a pending goto promise alive.
      await pHandled;
      await resetPage("goto_timeout");
      return { timed_out: true, status: 0 };
    }

    if (result && result.error) {
      throw result.error;
    }
    return { timed_out: false, status: result.status };
  }

  try {
    while (true) {
      const tasks = await rpc("lead_hunter", "claim_craigslist_tasks_v1", {
        p_worker_id: WORKER_ID,
        p_limit: 5,
      });

      if (!Array.isArray(tasks) || tasks.length === 0) {
        await sleep(3000);
        continue;
      }

      for (const t of tasks) {
        const id = t.id;
        const account_id = String(t.account_id || "").trim();
        const city = String(t.city || "").trim();
        const task_type = String(t.task_type || "").trim();

        if (!id || !account_id || !city || !task_type) {
          await rpc("lead_hunter", "finish_craigslist_task_v1", {
            p_id: id,
            p_ok: false,
            p_error: "invalid_task_row",
          });
          continue;
        }

        try {
          if (task_type === "discover") {
            const site = cityToSite(city);
            if (!site) {
              await rpc("lead_hunter", "finish_craigslist_task_v1", {
                p_id: id,
                p_ok: false,
                p_error: "unsupported_city_mapping_v0",
              });
              continue;
            }

            const searchUrl = `https://${site}.craigslist.org/search/cto?purveyor=owner&sort=date`;
            console.log("DISCOVER_NAV_BEGIN", { city, searchUrl });

            const nav = await gotoWithRetryHard(searchUrl, { taskType: "discover", city });
            if (nav.timed_out) {
              await rpc("lead_hunter", "finish_craigslist_task_v1", { p_id: id, p_ok: false, p_error: "goto_timeout" });
              continue;
            }

            console.log("DISCOVER_NAV_DONE", { city, searchUrl, status: nav.status, url: page.url() });

            const status = nav.status;
            if (status === 403 || status === 503) {
              console.log("DISCOVER_FAIL", { city, searchUrl, reason: `blocked_${status}` });
              await writeEvidence("discover", city, `blocked_${status}`);
              await rpc("lead_hunter", "finish_craigslist_task_v1", {
                p_id: id,
                p_ok: false,
                p_error: `blocked_${status}`,
              });
              await resetPage(`blocked_${status}`);
              continue;
            }

            await sleep(jitterMs(CL_JITTER_MIN_MS, CL_JITTER_MAX_MS));

            try {
              await page.waitForSelector(
                "a.titlestring[href], li.cl-static-search-result, a[href*='/cto/d/'][href$='.html']",
                { timeout: CL_WAIT_SELECTOR_MS },
              );
            } catch {
              // Continue; extraction below will determine if we got results.
            }

            try {
              const scrollWait = Math.round(CL_SLOWMO * (800 / 150));
              await page.evaluate(() => window.scrollTo(0, 0));
              await sleep(scrollWait);
              await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
              await sleep(scrollWait);
              await page.evaluate(() => window.scrollTo(0, 0));
              await sleep(scrollWait);
              await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            } catch {
              // ignore
            }
            await sleep(Math.round(CL_SLOWMO * (800 / 150)));

            const links = await page.evaluate(() => {
              const out = [];
              const push = (v) => {
                if (!v) return;
                const s = String(v).trim();
                if (s) out.push(s);
              };

              // 1) Newer layout
              document.querySelectorAll("a.titlestring[href]").forEach((a) => push(a.getAttribute("href")));
              // 2) Static layout fallback
              if (out.length === 0) {
                document.querySelectorAll("li.cl-static-search-result a[href]").forEach((a) => push(a.getAttribute("href")));
              }
              // 2.5) More robust list selector
              if (out.length === 0) {
                document
                  .querySelectorAll("li[class*='search'] a[href*='/cto/d/'][href$='.html']")
                  .forEach((a) => push(a.getAttribute("href")));
              }
              // 3) Broad fallback: any anchor with /cto/d/ and .html
              if (out.length === 0) {
                document.querySelectorAll("a[href]").forEach((a) => {
                  const href = (a.getAttribute("href") || "").trim();
                  if (href.includes("/cto/d/") && href.endsWith(".html")) push(href);
                });
              }
              return out;
            });

            const dedup = new Map();
            for (const href of links || []) {
              const h = String(href || "").trim();
              if (!h) continue;
              let normalized = h;
              try {
                normalized = new URL(h, searchUrl).toString();
              } catch {
                normalized = h;
              }
              const external_id = extractPostingId(normalized);
              if (!external_id) continue;
              if (!dedup.has(external_id)) dedup.set(external_id, normalized);
              if (dedup.size >= CL_MAX_DISCOVER) break; // cap per discover
            }

            console.log("DISCOVER_RESULTS", { city, searchUrl, count: dedup.size });

            if (dedup.size === 0) {
              const html = await page.content().catch(() => "");
              const title = await page.title().catch(() => "");
              const url = page.url();
              console.log("DISCOVER_ZERO_RESULTS", {
                city,
                searchUrl,
                title,
                url,
                htmlLength: html.length,
                head: html.slice(0, 400),
              });
              await writeEvidence("discover", city, "discover_zero_results");
              await rpc("lead_hunter", "finish_craigslist_task_v1", {
                p_id: id,
                p_ok: false,
                p_error: "discover_zero_results (selector mismatch or blocked)",
              });
              await resetPage("discover_zero_results");
              continue;
            }

            const detailTasks = Array.from(dedup.entries()).map(([external_id, listing_url]) => ({
              account_id,
              city,
              task_type: "detail",
              listing_url,
              external_id,
              status: "queued",
            }));

            const inserted = await insertLeadHunterTasks(detailTasks);
            console.log("DISCOVER_DETAIL_TASKS", { city, searchUrl, discovered: detailTasks.length, inserted });

            await rpc("lead_hunter", "finish_craigslist_task_v1", { p_id: id, p_ok: true, p_error: null });
            continue;
          }

          if (task_type === "detail") {
            const listing_url = String(t.listing_url || "").trim();
            const external_id = String(t.external_id || "").trim();

            if (!listing_url || !external_id) {
              await rpc("lead_hunter", "finish_craigslist_task_v1", {
                p_id: id,
                p_ok: false,
                p_error: "missing_listing_url_or_external_id",
              });
              continue;
            }

            console.log("DETAIL_NAV_BEGIN", { city, external_id, listing_url });
            const nav = await gotoWithRetryHard(listing_url, { taskType: "detail", city });
            if (nav.timed_out) {
              await rpc("lead_hunter", "finish_craigslist_task_v1", { p_id: id, p_ok: false, p_error: "goto_timeout" });
              continue;
            }
            console.log("DETAIL_NAV_DONE", { city, external_id, listing_url, status: nav.status, url: page.url() });
            const status = nav.status;
            if (status === 403 || status === 503) {
              console.log("DETAIL_FAIL", { city, external_id, listing_url, reason: `blocked_${status}` });
              await writeEvidence("detail", city, `blocked_${status}`);
              await rpc("lead_hunter", "finish_craigslist_task_v1", {
                p_id: id,
                p_ok: false,
                p_error: `blocked_${status}`,
              });
              await resetPage(`blocked_${status}`);
              continue;
            }

            await sleep(jitterMs(CL_JITTER_MIN_MS, CL_JITTER_MAX_MS));

            try {
              await page.waitForSelector("#postingbody, #titletextonly", { timeout: CL_WAIT_SELECTOR_MS });
            } catch {
              console.log("DETAIL_FAIL", { city, external_id, listing_url, reason: "detail_missing_dom" });
              await writeEvidence("detail", city, "detail_missing_dom");
              await rpc("lead_hunter", "finish_craigslist_task_v1", {
                p_id: id,
                p_ok: false,
                p_error: "detail_missing_dom",
              });
              await resetPage("detail_missing_dom");
              continue;
            }

            const data = await page.evaluate(() => {
              const q = (sel) => document.querySelector(sel);
              const title = (q("#titletextonly")?.textContent || "").trim() || null;
              const priceText = (q(".price")?.textContent || "").trim();
              const priceNum = priceText ? Number(priceText.replace(/[^\d.]/g, "")) : NaN;
              const price = Number.isFinite(priceNum) ? priceNum : null;

              const postingTitle = (q("span.postingtitletext")?.textContent || "").trim();
              const areaMatch = postingTitle.match(/\(([^)]+)\)\s*$/);
              const area = areaMatch ? String(areaMatch[1]).trim() : null;

              const posted_at = (q("time.date.timeago")?.getAttribute("datetime") || "").trim() || null;
              const description = (q("#postingbody")?.textContent || "")
                .replace(/^QR Code Link to This Post\s*/i, "")
                .trim() || null;

              const attrs = {};
              document.querySelectorAll(".attrgroup span").forEach((el) => {
                const t = (el.textContent || "").trim();
                const m = t.match(/^([^:]+):\s*(.+)$/);
                if (m) {
                  const k = String(m[1]).trim().toLowerCase();
                  const v = String(m[2]).trim();
                  if (k && v) attrs[k] = v;
                }
              });

              const images = [];
              document.querySelectorAll("img[src]").forEach((img) => {
                const src = (img.getAttribute("src") || "").trim();
                if (src && src.includes("images.craigslist.org")) images.push(src);
              });

              return { title, price, area, posted_at, description, attributes: attrs, image_urls: Array.from(new Set(images)).slice(0, 20) };
            });

            if (!data || !data.description || !hasPersonalSellerSignals(data.description)) {
              await rpc("lead_hunter", "finish_craigslist_task_v1", {
                p_id: id,
                p_ok: false,
                p_error: "rejected_commercial",
              });
              continue;
            }

            const leadRow = {
              account_id,
              source: "craigslist",
              external_id,
              niche: "autos",
              title: data.title,
              url: listing_url,
              price: data.price,
              city,
              country: "US",
              raw: {
                craigslist: {
                  external_id,
                  listing_url,
                  posted_at: data.posted_at,
                  area: data.area,
                  attributes: data.attributes,
                  image_urls: data.image_urls,
                  description: data.description,
                },
              },
              enriched: {
                source: "craigslist",
                craigslist: {
                  external_id,
                  listing_url,
                  posted_at: data.posted_at,
                  area: data.area,
                },
              },
              // phone/email not assumed
              phone: null,
              status: "new",
              lead_state: "new",
            };

            await upsertPublicLead(leadRow);
            await rpc("lead_hunter", "finish_craigslist_task_v1", { p_id: id, p_ok: true, p_error: null });
            continue;
          }

          await rpc("lead_hunter", "finish_craigslist_task_v1", {
            p_id: id,
            p_ok: false,
            p_error: "unknown_task_type",
          });
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const stack = e instanceof Error && e.stack ? String(e.stack).slice(0, 2000) : undefined;
          console.error("TASK_EXCEPTION", {
            task_type,
            city,
            id,
            external_id: t?.external_id ?? null,
            listing_url: t?.listing_url ?? null,
            msg,
            ...(stack ? { stack } : {}),
          });
          await rpc("lead_hunter", "finish_craigslist_task_v1", {
            p_id: id,
            p_ok: false,
            p_error: msg,
          });
          await resetPage("task_exception");
        }
      }
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

run().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});


