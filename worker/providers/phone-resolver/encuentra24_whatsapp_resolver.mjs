import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

// =========================
// Helpers
// =========================
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function nowIso() { return new Date().toISOString(); }

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function rand(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

function normSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function isLikelyCommercialSellerName(name) {
  const n = normSpace(name).toLowerCase();
  if (!n) return false;

  // Strong legal/entity signals
  if (/\b(s\.a\.|sa\b|corp\b|inc\b|ltd\b|s\.r\.l\.|srl\b)\b/i.test(name)) return true;

  // Common dealership / business tokens (Spanish + English brandings)
  const tokens = [
    "autos", "auto", "motors", "motor", "dealer", "agencia", "autolote", "showroom",
    "financiamiento", "compramos", "vendemos", "ventas", "importadora", "consignación", "consignacion",
    "rent a car", "rental", "flota", "stock", "super autos",
    "cars", "car ", "gallery", "galería", "galeria", "group", "racing", "performance", "outlet", "premium",
    "full cars", "trade", "wholesale", "lote", "multimarca",
    "escudería", "escuderia", "grupo", "empresa", "compañía", "compania",
  ];
  for (const t of tokens) if (n.includes(t)) return true;

  // Patterns like "SUPER AUTOS / SAID ..."
  if (n.includes("/") && (n.includes("auto") || n.includes("autos") || n.includes("motor"))) return true;

  // Very shouty long uppercase names often are businesses
  const letters = String(name || "").replace(/[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g, "");
  if (letters.length >= 10) {
    const upper = letters.replace(/[^A-ZÁÉÍÓÚÜÑ]/g, "").length;
    if (upper / letters.length > 0.85 && normSpace(name).length >= 12) return true;
  }

  return false;
}

function extractListingId(listingUrl) {
  const m = String(listingUrl).match(/\/(\d{6,})\b/);
  return m ? m[1] : null;
}

function toPanamaE164(phoneLike) {
  if (!phoneLike) return null;
  const s = String(phoneLike).trim();
  const d = s.replace(/\D/g, "");

  // Exactly 8 digits → Panama local number
  if (d.length === 8 && /^[2-9]/.test(d)) return `+507${d}`;

  // 11 digits starting with 507 → Panama E.164 without +
  if (d.length === 11 && d.startsWith("507") && /^507[2-9]/.test(d)) return `+${d}`;

  // Already in +507XXXXXXXX format (exactly 12 chars, 8-digit local starting with 2-9)
  if (/^\+507[2-9]\d{7}$/.test(s)) return s;

  // 00507 prefix (international dialing)
  if (d.length === 13 && d.startsWith("00507") && /^00507[2-9]/.test(d)) return `+${d.slice(2)}`;

  return null;
}

function isSeedLikeValue(value) {
  const s = String(value || "");
  const d = s.replace(/\D/g, "");
  return s.includes("+50767777777") || s.includes("6777-7777") || d.endsWith("67777777");
}

function looksLikeWa(url) {
  const u = String(url || "");
  return /wa\.me\/|whatsapp\.com\/send|api\.whatsapp\.com\/send/i.test(u);
}

function extractPhonesFromText(text) {
  const t = String(text || "");
  const out = new Set();
  // Panama formats seen in the wild:
  // - +50762322069
  // - +507 6232-2069
  // - +507-6232-2069
  // - 6232-2069 / 6232 2069
  // - 50762322069 / 507 6232 2069
  const re = /(\+507[\s-]?\d{4}[\s-]?\d{4}|\b507[\s-]?\d{4}[\s-]?\d{4}\b|\b\d{4}[-\s]?\d{4}\b)/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const e164 = toPanamaE164(m[1]);
    if (e164) out.add(e164);
  }
  return Array.from(out);
}

function extractWaLinksFromText(text) {
  const t = String(text || "");
  const out = new Set();
  const re = /(https?:\/\/(?:wa\.me\/\d+|api\.whatsapp\.com\/send\?[^"' ]+|www\.whatsapp\.com\/send\?[^"' ]+))/gi;
  let m;
  while ((m = re.exec(t)) !== null) out.add(m[1]);
  return Array.from(out);
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// =========================
// Main resolver
// =========================
export async function resolveEncuentra24PhoneFromListing(listingUrl, opts = {}) {
  const t0 = Date.now();

  const headless = !!opts.headless;
  const saveShots = Number(opts.saveShots || 0);
  const userDataDir = opts.userDataDir;
  const form = opts.form || {};
  const delays = opts.delays || {};
  const sendMessageBeforeReveal = opts.sendMessageBeforeReveal !== false; // default true
  const chromeChannel = opts.chromeChannel || process.env.ENC24_CHROME_CHANNEL || null;
  const chromeExecutablePath = opts.chromeExecutablePath || process.env.ENC24_CHROME_EXECUTABLE_PATH || null;
  const ignoreAutomationArg = String(process.env.ENC24_IGNORE_ENABLE_AUTOMATION || "") === "1";
  const maxCallClicks = Number(opts.maxCallClicks ?? process.env.ENC24_MAX_CALL_CLICKS ?? 2);

  const SHOTS_DIR = process.env.ENC24_SHOTS_DIR || "/tmp/enc24_shots";
  if (saveShots) ensureDir(SHOTS_DIR);

  const listing_id = extractListingId(listingUrl);
  const debug = {
    ts: nowIso(),
    listingUrl,
    listing_id,
    steps: [],
    net_hits: [],
    dom_hits: [],
    shots: [],
    fill: {},
    seller: {},
  };

  const FORM_PHONE8 = String(form.phone8 || "67777777").replace(/\D/g, "");
  const FORM_PHONE_E164 = toPanamaE164(FORM_PHONE8);

  const listingIdE164 = listing_id ? `+507${String(listing_id).slice(0, 8)}` : null; // hard block anyway below

  function step(name, extra = {}) {
    debug.steps.push({ t: nowIso(), name, ...extra });
  }

  function runFolder() {
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const p = path.join(SHOTS_DIR, id);
    if (saveShots) ensureDir(p);
    return p;
  }

  const RUN_DIR = runFolder();

  async function snap(page, name) {
    if (!saveShots) return;
    const p = path.join(RUN_DIR, `${String(name).replace(/\s+/g, "_")}.png`);
    await page.screenshot({ path: p, fullPage: true }).catch(() => {});
    debug.shots.push(p);
  }

  let browser;
  let context;
  let page;
  let usedPersistentContext = false;

  // Seller meta (from the contact card header)
  let seller_name = null;
  let seller_is_business = false;

  // Candidates (strict)
  const phoneCandidates = new Map(); // e164 -> { where, url }
  const waCandidates = new Map(); // url -> { where, url }

  // Gate network parsing to reduce noise (ads, unrelated HTML, etc)
  let revealWindowOpenAt = null;
  let didClickCall = false;
  let didClickWa = false;
  let didClickContactar = false;

  function isBannedE164(e164) {
    if (!e164) return true;
    // ban seed
    if (FORM_PHONE_E164 && e164 === FORM_PHONE_E164) return true;
    // ban listing id abuse (+50731721812 etc)
    if (listing_id && e164 === `+507${String(listing_id)}`) return true;
    // ban any e164 that contains listing_id substring
    if (listing_id && String(e164).includes(String(listing_id))) return true;
    // ban obvious placeholders (rare)
    if (/\+5070{7,}/.test(e164)) return true;
    return false;
  }

  /**
   * Detect suspicious phone numbers.
   * In Panama, ALL mobile numbers start with 6 (+507 6xxx-xxxx).
   * Digits 2/3 are landlines, 4/5/7/8/9 don't exist.
   * For contacting car sellers we ONLY want mobile numbers (6xxx).
   *
   * @param {string} e164 - E.164 format like +50762322069
   * @param {string} where - extraction source (net_text, dom_tel, etc.)
   * @returns {boolean} true if the phone looks suspicious / not mobile
   */
  function isSuspiciousPhone(e164, where) {
    if (!e164) return true;
    const local = e164.replace(/^\+507/, "");
    if (local.length !== 8) return true;

    const firstDigit = local[0];

    // ALL sources: only accept mobile numbers starting with 6
    // Landlines (2xx, 3xx) are useless for contacting sellers via WhatsApp/call
    // Digits 4,5,7,8,9 are not valid Panama ranges at all
    if (firstDigit !== "6") return true;

    // Trailing zeros: 3+ trailing zeros is almost always garbage
    if (/0{3,}$/.test(local)) return true;

    // Highly repetitive: same digit 5+ times (e.g. 66666666)
    if (/(\d)\1{4,}/.test(local)) return true;

    // Sequential ascending/descending
    if (local === "12345678" || local === "87654321") return true;

    return false;
  }

  function considerPhone(phone, where, url) {
    const e164 = toPanamaE164(phone);
    if (!e164) return;
    if (isBannedE164(e164)) return;
    if (isSuspiciousPhone(e164, where)) return;
    const wherePriority = (w) => {
      const s = String(w || "");
      if (s.includes("dom_tel_after_call_click")) return 100;
      if (s.includes("dom_tel_final_scan")) return 95;
      if (s.includes("visible_call_after_call_click")) return 90;
      if (s.includes("visible_panel_after_call_click")) return 85;
      if (s.includes("popup_after_call_click")) return 80;
      if (s.includes("after_call_click")) return 75;
      if (s.includes("after_contactar")) return 60;
      if (s.includes("after_wa_click")) return 55;
      if (s.includes("net_key_")) return 40;
      if (s.includes("net_json")) return 30;
      if (s.includes("net_text")) return 10;
      return 0;
    };

    const prev = phoneCandidates.get(e164);
    if (!prev) {
      phoneCandidates.set(e164, { where, url: url || null });
    } else {
      const prevP = wherePriority(prev.where);
      const nextP = wherePriority(where);
      if (nextP > prevP) {
        phoneCandidates.set(e164, { where, url: url || null });
      }
    }
    debug.net_hits.push({ kind: "phone", where, url: url || null, value: e164 });
  }

  function considerWa(wa, where, url) {
    if (!wa || !looksLikeWa(wa)) return;
    const wherePriority = (w) => {
      const s = String(w || "");
      if (s.includes("popup_after_wa_click")) return 100;
      if (s.includes("dom_wa_after_wa_click")) return 90;
      if (s.includes("after_wa_click")) return 80;
      if (s.includes("after_contactar")) return 60;
      if (s.includes("dom_wa_final_scan")) return 40;
      if (s.includes("net_json")) return 30;
      if (s.includes("net_text")) return 10;
      return 0;
    };

    const prev = waCandidates.get(wa);
    if (!prev) {
      waCandidates.set(wa, { where, url: url || null });
    } else {
      const prevP = wherePriority(prev.where);
      const nextP = wherePriority(where);
      if (nextP > prevP) {
        waCandidates.set(wa, { where, url: url || null });
      }
    }
    debug.net_hits.push({ kind: "wa", where, url: url || null, value: wa });
  }

  // Human-like interactions
  async function humanClick(locator) {
    const box = await locator.boundingBox().catch(() => null);
    if (!box) {
      await locator.click({ timeout: 2000 }).catch(() => {});
      return;
    }
    const x = box.x + box.width * (0.35 + Math.random() * 0.3);
    const y = box.y + box.height * (0.35 + Math.random() * 0.3);
    await page.mouse.move(x, y, { steps: rand(8, 18) }).catch(() => {});
    await page.mouse.down().catch(() => {});
    await sleep(rand(45, 120));
    await page.mouse.up().catch(() => {});
  }

  async function typeLikeHuman(locator, text, delayMs = 80) {
    await locator.click({ timeout: 2000 }).catch(() => {});
    await sleep(rand(50, 120));
    // clear robust
    await locator.fill("").catch(() => {});
    await sleep(rand(50, 120));
    await locator.type(String(text), { delay: delayMs }).catch(() => {});
  }

  async function closeOverlays() {
    const selectors = [
      "button[aria-label='Close']",
      "button:has-text('Cerrar')",
      "button:has-text('ACEPTAR')",
      "button:has-text('Aceptar')",
      "button:has-text('Entendido')",
      "[data-testid='close']",
      ".modal button.close",
      ".close-button",
      ".close",
    ];
    for (const sel of selectors) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0)) {
        await loc.click({ timeout: 800 }).catch(() => {});
        await sleep(200);
      }
    }
  }

  async function isDisabled(locator) {
    try {
      const el = locator.first();
      if (!(await el.count().catch(() => 0))) return false;
      return await el.evaluate((n) => {
        const any = n;
        const aria = n.getAttribute?.("aria-disabled");
        const disabledAttr = (n instanceof HTMLButtonElement || n instanceof HTMLInputElement)
          ? (n.disabled === true)
          : (n.getAttribute?.("disabled") != null);
        const cls = String(n.getAttribute?.("class") || "").toLowerCase();
        return disabledAttr || aria === "true" || cls.includes("disabled");
      });
    } catch {
      return false;
    }
  }

  function locateActionByText(text) {
    // Encuentra24 cambia el tag: a veces es button, a veces <a>, a veces <div role=button>.
    // Usamos filter(hasText) para ser robustos.
    return page
      .locator("button, a, [role='button'], [class*='button' i], [class*='btn' i]")
      .filter({ hasText: new RegExp(String(text || "").trim() || ".*", "i") })
      .first();
  }

  async function getPanelSnapshot() {
    return await page.evaluate(() => {
      const header = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,section"))
        .find((el) => (el.textContent || "").includes("Enviar mensaje al vendedor"));
      const root = header ? (header.closest("section") || header.closest("div") || header) : null;
      if (!root) {
        return { ok: false, callText: "", actionTexts: [], telHrefs: [], waHrefs: [] };
      }
      const actions = Array.from(root.querySelectorAll("button, a, [role='button']")).map((el) => (el.textContent || "").trim()).filter(Boolean);
      const callEl = Array.from(root.querySelectorAll("button, a, [role='button']")).find((el) => /llamar/i.test(el.textContent || "")) || null;
      const callText = (callEl?.textContent || "").trim();
      const telHrefs = Array.from(root.querySelectorAll("a[href^='tel:']")).map((a) => a.getAttribute("href") || "").filter(Boolean);
      const waHrefs = Array.from(root.querySelectorAll("a[href*='wa.me'],a[href*='whatsapp.com/send'],a[href*='api.whatsapp.com/send']")).map((a) => a.getAttribute("href") || "").filter(Boolean);
      return { ok: true, callText, actionTexts: actions, telHrefs, waHrefs };
    }).catch(() => ({ ok: false, callText: "", actionTexts: [], telHrefs: [], waHrefs: [] }));
  }

  try {
    step("launch");

    // CDP (recommended)
    if (String(process.env.ENC24_CDP || "") === "1" && process.env.ENC24_CDP_URL) {
      browser = await chromium.connectOverCDP(process.env.ENC24_CDP_URL);
      context = browser.contexts()[0] || await browser.newContext();
    } else {
      const commonContext = {
        viewport: { width: 1280, height: 900 },
        userAgent:
          process.env.ENC24_UA ||
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
        locale: "es-PA",
        timezoneId: "America/Panama",
      };

      const launchBase = {
        headless,
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
        ...(chromeChannel ? { channel: chromeChannel } : {}),
        ...(chromeExecutablePath ? { executablePath: chromeExecutablePath } : {}),
        ...(ignoreAutomationArg ? { ignoreDefaultArgs: ["--enable-automation"] } : {}),
      };

      // If a persistent profile is provided, use a persistent context (closest to a "real" browser profile).
      if (userDataDir) {
        usedPersistentContext = true;
        context = await chromium.launchPersistentContext(userDataDir, {
          ...launchBase,
          ...commonContext,
        });
      } else {
        browser = await chromium.launch(launchBase);
        context = await browser.newContext(commonContext);
      }
    }

    page = await context.newPage();

    // NETWORK capture (but we will be strict about accepting it)
    page.on("response", async (res) => {
      try {
        const url = res.url();
        const st = res.status();
        if (st < 200 || st >= 400) return;

        // Reduce garbage: only parse actual encuentra24 responses.
        // Block ad networks whose URLs include "encuentra24.com" in query params.
        if (!/encuentra24\.com/i.test(url)) return;
        if (/doubleclick\.net|googlesyndication\.com|googleads\.g\.|adservice\.google|pagead|adsense|facebook\.com\/tr|analytics/i.test(url)) return;

        // Only parse after we start the "reveal window" (after form fill / clicks),
        // except for very specific hot endpoints that may appear slightly earlier.
        const isGateBypass = /\/cnmessage\/send\/|\/cnmessage\/|\/message\/send\//i.test(url);
        if (!revealWindowOpenAt && !isGateBypass) return;

        const lid = listing_id ? String(listing_id) : "";
        const hot =
          (lid && url.includes(lid)) ||
          /contact|phone|whatsapp|reveal|call|seller|lead|message|inquiry/i.test(url);

        if (!hot) return;

        const ct = (res.headers()["content-type"] || "").toLowerCase();
        let bodyText = null;

        if (ct.includes("application/json") || ct.includes("text/") || ct.includes("application/javascript")) {
          bodyText = await res.text().catch(() => null);
        } else {
          return;
        }
        if (!bodyText || bodyText.length > 2_000_000) return;

        const j = safeJsonParse(bodyText);
        if (j) {
          const flat = JSON.stringify(j);
          for (const p of extractPhonesFromText(flat)) considerPhone(p, "net_json", url);
          for (const w of extractWaLinksFromText(flat)) considerWa(w, "net_json", url);

          const commonKeys = ["phone", "phoneNumber", "telephone", "tel", "whatsapp", "wa", "contact"];
          for (const k of commonKeys) {
            const v = j?.[k];
            if (typeof v === "string") {
              for (const p of extractPhonesFromText(v)) considerPhone(p, `net_key_${k}`, url);
              for (const w of extractWaLinksFromText(v)) considerWa(w, `net_key_${k}`, url);
            }
          }
        } else {
          for (const p of extractPhonesFromText(bodyText)) considerPhone(p, "net_text", url);
          for (const w of extractWaLinksFromText(bodyText)) considerWa(w, "net_text", url);
        }
      } catch {
        // ignore
      }
    });

    step("goto");
    await page.goto(listingUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await sleep(rand(500, 900));
    await snap(page, "01_loaded");

    step("close_overlays");
    await closeOverlays();
    await snap(page, "01b_after_overlays");

    // Strict Stage-2 flow: contact box scoped only.
    step("locate_contact_box");
    const contactBoxTimeout = delays.waitContactMs || 25000;
    const contactBoxCandidates = [
      { selector: "form[id^='messageform_']", locator: page.locator("form[id^='messageform_']").first() },
      { selector: ".d3-property-contact__form", locator: page.locator(".d3-property-contact__form").first() },
      { selector: "[class*='contact' i]", locator: page.locator("[class*='contact' i]").first() },
    ];
    let contactBox = null;
    let matchedContactBoxSelector = null;

    // Race all selectors in parallel with a single shared timeout (not 25s × 3 serial).
    const raceResult = await Promise.race(
      contactBoxCandidates.map((candidate) =>
        candidate.locator
          .waitFor({ timeout: contactBoxTimeout })
          .then(() => candidate)
          .catch(() => null)
      )
    ).catch(() => null);

    if (raceResult) {
      contactBox = raceResult.locator;
      matchedContactBoxSelector = raceResult.selector;
    } else {
      // All timed out; fast isVisible sweep in priority order.
      for (const candidate of contactBoxCandidates) {
        const visible = await candidate.locator.isVisible().catch(() => false);
        if (visible) {
          contactBox = candidate.locator;
          matchedContactBoxSelector = candidate.selector;
          break;
        }
      }
    }

    // If the broad selector won, prefer a more specific one if also visible.
    if (matchedContactBoxSelector === "[class*='contact' i]") {
      for (const candidate of contactBoxCandidates.slice(0, 2)) {
        const visible = await candidate.locator.isVisible().catch(() => false);
        if (visible) {
          contactBox = candidate.locator;
          matchedContactBoxSelector = candidate.selector;
          break;
        }
      }
    }
    const contactBoxReady = Boolean(contactBox);
    if (!contactBoxReady) {
      step("contact_box_not_found");
      return {
        ok: false,
        stage: 2,
        method: "contact_box_not_found",
        reason: "contact_box_not_found",
        phone_e164: null,
        wa_link: null,
        seller_name,
        seller_is_business,
        debug,
        elapsed_ms: Date.now() - t0,
      };
    }

    debug.contact_box_selector = matchedContactBoxSelector;
    step("contact_box_found", { selector: matchedContactBoxSelector });

    // Seller name + "Tipo de vendedor" via page.evaluate for reliability.
    // The seller profile is in the sidebar near the contact form but often NOT inside it.
    const sellerInfo = await page.evaluate(() => {
      let name = null;
      let nameSource = "none";

      // Helper: get clean, short text from an element (only direct text, not deep descendants)
      function cleanText(el) {
        // Use innerText (visible text only) if short, or fall back to direct text nodes
        const inner = (el.innerText || "").trim();
        if (inner.length >= 3 && inner.length <= 80) return inner;
        // Try direct child text nodes only (avoids dropdown/script text)
        let direct = "";
        for (const n of el.childNodes) {
          if (n.nodeType === 3) direct += n.textContent;
        }
        direct = direct.trim();
        if (direct.length >= 3 && direct.length <= 80) return direct;
        return null;
      }

      // Strategy A: Look for a profile link near the contact panel
      const contactPanel = document.querySelector("[class*='contact' i]");
      if (contactPanel) {
        let container = contactPanel.parentElement;
        for (let i = 0; i < 3 && container; i++) {
          const links = container.querySelectorAll("a[href]");
          for (const link of links) {
            const href = link.getAttribute("href") || "";
            // Profile links on ENC24 are like /username or /moisesrnovoa
            if (/^\/[a-zA-Z0-9_-]+$/.test(href) && !href.startsWith("/panama") && !href.startsWith("/login")) {
              const text = cleanText(link);
              if (text && text.length >= 3 && text.length <= 60) {
                name = text;
                nameSource = "profile_link";
                break;
              }
            }
          }
          if (name) break;
          container = container.parentElement;
        }
      }

      // Strategy B: heading/strong near contact panel — only short text (skip garbage)
      if (!name) {
        const panels = document.querySelectorAll("[class*='contact' i]");
        for (const panel of panels) {
          const parent = panel.parentElement;
          if (!parent) continue;
          for (const el of parent.querySelectorAll("h1,h2,h3,h4,h5,strong,b")) {
            const t = cleanText(el);
            if (t && t.length >= 3 && t.length <= 60
              && !/Enviar mensaje|Contactar|Llamar|WhatsApp|recaptcha|function |Afghanistan|results found/i.test(t)) {
              name = t;
              nameSource = "parent_heading";
              break;
            }
          }
          if (name) break;
        }
      }

      // 2) "Tipo de vendedor" from listing details
      let sellerType = null;
      const allEls = document.querySelectorAll("dt, th, span, label, div, p");
      for (const el of allEls) {
        // Only check leaf-ish elements with short text
        const t = (el.childNodes.length <= 2 && el.textContent.trim().length < 40)
          ? el.textContent.trim() : null;
        if (t && /^Tipo de vendedor$/i.test(t)) {
          const next = el.nextElementSibling;
          if (next) {
            const nText = (next.innerText || next.textContent || "").trim();
            if (nText.length <= 100) { sellerType = nText; break; }
          }
          const parent = el.parentElement;
          if (parent) {
            const p = parent.querySelector("dd, p, span");
            if (p && p !== el) {
              const pText = (p.innerText || p.textContent || "").trim();
              if (pText.length <= 100) { sellerType = pText; break; }
            }
          }
        }
      }
      return { name, nameSource, sellerType };
    }).catch(() => ({ name: null, nameSource: "error", sellerType: null }));

    // Safety: reject garbage seller names (dropdown text, recaptcha, scripts, etc.)
    let rawSellerName = normSpace(sellerInfo.name || "") || null;
    if (rawSellerName && (rawSellerName.length > 80 || /Afghanistan|recaptcha|function\s*\(|results found|\+\d{2,}/i.test(rawSellerName))) {
      rawSellerName = null;
    }
    // Reject car-title-like names: contain a 4-digit year → not a real seller name
    if (rawSellerName && /\b(20[1-3]\d|19\d{2})\b/.test(rawSellerName)) {
      step("seller_name_looks_like_car_title", { rawSellerName });
      rawSellerName = null;
    }
    // Reject names that are car brand/model (not a person's name)
    if (rawSellerName && /\b(BMW|Toyota|Honda|Hyundai|Kia|Ford|Chevrolet|Nissan|Mazda|Mercedes|Audi|Volkswagen|VW|Lexus|Jeep|Suzuki|Mitsubishi|Subaru|Porsche|Volvo|Land Rover|Range Rover|Jaguar|Fiat|Peugeot|Renault|Chery|MG|BYD|Sportage|Tucson|Corolla|Civic|RAV4|CR-V|CRV|Hilux|Fortuner|Wrangler|Tacoma|Camry|Sentra|Versa)\b/i.test(rawSellerName) && !/\b[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,}\s+[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]{2,}\b/.test(rawSellerName)) {
      step("seller_name_looks_like_car_brand", { rawSellerName });
      rawSellerName = null;
    }
    // Reject "Se Vende" / "En Venta" prefixed names (listing titles)
    if (rawSellerName && /^(Se\s+Vende|En\s+Venta|Vendo|For\s+Sale)\b/i.test(rawSellerName)) {
      step("seller_name_looks_like_listing_title", { rawSellerName });
      rawSellerName = null;
    }
    // Reject "propietario propietario" (duplicated word)
    if (rawSellerName && /^(\w+)\s+\1$/i.test(rawSellerName)) {
      step("seller_name_duplicated_word", { rawSellerName });
      rawSellerName = null;
    }
    // Also reject generic UI labels captured by mistake
    if (rawSellerName && /^(Detalles|Descripci[oó]n|Contacto|Enviar|Publicado|Ubicaci[oó]n)$/i.test(rawSellerName)) {
      rawSellerName = null;
    }
    seller_name = rawSellerName;
    const sellerTypeIsDealer = /distribuidor|concesionario|profesional|agencia|dealer/i.test(sellerInfo.sellerType || "");
    seller_is_business = isLikelyCommercialSellerName(seller_name) || sellerTypeIsDealer;
    debug.seller = { seller_name, seller_is_business, source: sellerInfo.nameSource, seller_type: sellerInfo.sellerType || null };

    const emailLocators = [
      "input[type='email']",
      "input[placeholder*='mail' i]",
      "input[placeholder*='e-mail' i]",
      "input[name*='mail' i]",
      "input[id*='mail' i]",
    ];
    const nameLocators = [
      "input[placeholder*='Nombre' i]",
      "input[name*='name' i]",
      "input[name*='nombre' i]",
      "input[id*='name' i]",
      "input[id*='nombre' i]",
    ];
    const phoneLocators = [
      "input[placeholder*='Ej: 6123-4567' i]",
      "input[type='tel']",
    ];

    const pickScoped = async (scopedRoot, selectors) => {
      for (const selector of selectors) {
        const candidate = scopedRoot.locator(selector).first();
        const visible = await candidate.isVisible().catch(() => false);
        if (visible) return { locator: candidate, selector };
      }
      return { locator: null, selector: null };
    };

    const emailPicked = await pickScoped(contactBox, emailLocators);
    const namePicked = await pickScoped(contactBox, nameLocators);
    const phonePicked = await pickScoped(contactBox, phoneLocators);
    debug.matched_inputs = {
      email: emailPicked.selector,
      name: namePicked.selector,
      phone: phonePicked.selector,
    };
    step("inputs_picked", debug.matched_inputs);

    if (!emailPicked.locator || !namePicked.locator || !phonePicked.locator) {
      step("contact_inputs_not_found", debug.matched_inputs);
      return {
        ok: false,
        stage: 2,
        method: "contact_inputs_not_found",
        reason: "contact_inputs_not_found",
        phone_e164: null,
        wa_link: null,
        seller_name,
        seller_is_business,
        debug,
        elapsed_ms: Date.now() - t0,
      };
    }

    // Keep XHR payloads for strict fallback (only used if DOM has no tel/wa).
    const xhrPayloadTexts = [];
    page.on("response", async (res) => {
      try {
        const url = res.url();
        // Only capture XHR from encuentra24.com to avoid false positives from ad/tracking pixels
        if (!/encuentra24\.com/i.test(url)) return;

        const req = res.request();
        if (!req || req.resourceType() !== "xhr") return;
        const st = res.status();
        if (st < 200 || st >= 400) return;
        const ct = String(res.headers()["content-type"] || "").toLowerCase();
        if (!ct.includes("json") && !ct.includes("text")) return;
        const body = await res.text().catch(() => null);
        if (body) xhrPayloadTexts.push(body);
      } catch {}
    });

    step("fill_form_start");
    revealWindowOpenAt = Date.now();
    const email = String(form.email || "pacho@pachosanchez.com");
    const name = String(form.name || "Pacho");
    const phone8 = "67777777";

    await typeLikeHuman(emailPicked.locator, email, delays.typingDelayMs || 90);
    await sleep(120);
    await typeLikeHuman(namePicked.locator, name, delays.typingDelayMs || 90);
    await sleep(delays.beforePhoneTypeMs || 600);
    await typeLikeHuman(phonePicked.locator, phone8, delays.typingDelayMs || 90);
    debug.fill = { email, name, phone: phone8 };
    step("filled_form");

    await sleep(delays.afterFillMs || 2000);

    await closeOverlays();
    // Early check: some listings already show wa.me links before form submission.
    // IMPORTANT: only look INSIDE the contactBox — the site may have its own global WA button.
    step("early_wa_check");
    const earlyWaHref = await contactBox.locator("a[href*='wa.me'],a[href*='api.whatsapp.com/send']").first().getAttribute("href").catch(() => null);
    if (earlyWaHref) {
      debug.early_wa_href = earlyWaHref;
      step("early_wa_found", { earlyWaHref });
    }

    step("click_llamar_start");
    const callishSpecs = [
      { label: "Llamar", re: /llamar/i },
      { label: "Ver teléfono", re: /ver teléfono/i },
      { label: "Ver telefono", re: /ver telefono/i },
      { label: "Mostrar teléfono", re: /mostrar tel/i },
      { label: "WhatsApp", re: /whatsapp/i },
      { label: "Contactar", re: /contactar/i },
    ];
    const panelAncestor = contactBox.locator("xpath=ancestor::*[self::section or self::div or self::aside or self::article][1]").first();
    const searchRoots = [
      { name: "contactBox", root: contactBox },
      { name: "ancestor_panel", root: panelAncestor },
    ];
    let callishBtn = null;
    let callishLabel = null;
    for (const searchRoot of searchRoots) {
      for (const spec of callishSpecs) {
        const candidate = searchRoot.root
          .locator("button, a, span, div, [role='button']")
          .filter({ hasText: spec.re })
          .first();
        const visible = await candidate.isVisible().catch(() => false);
        if (visible) {
          callishBtn = candidate;
          callishLabel = spec.label;
          break;
        }
      }
      if (callishBtn) break;
    }
    const callishVisible = Boolean(callishBtn);
    if (!callishVisible) {
      debug.clicked_callish = false;
      debug.callish_label = "";
      step("llamar_not_found");
      // Even without a Llamar button, if we found a WA link earlier, return it.
      if (earlyWaHref && !isSeedLikeValue(earlyWaHref) && !(listing_id && String(earlyWaHref).includes(String(listing_id)))) {
        step("early_wa_fallback");
        return {
          ok: true,
          stage: 2,
          method: "early_wa_link",
          reason: "",
          phone_e164: null,
          wa_link: earlyWaHref,
          seller_name,
          seller_is_business,
          debug,
          elapsed_ms: Date.now() - t0,
        };
      }
      return {
        ok: false,
        stage: 2,
        method: "llamar_not_found",
        reason: "llamar_not_found",
        phone_e164: null,
        wa_link: null,
        seller_name,
        seller_is_business,
        debug,
        elapsed_ms: Date.now() - t0,
      };
    }

    await callishBtn.scrollIntoViewIfNeeded().catch(() => {});
    await callishBtn.hover({ timeout: 2000 }).catch(() => {});
    const callBox = await callishBtn.boundingBox().catch(() => null);
    if (callBox) {
      const x = callBox.x + callBox.width * 0.5;
      const y = callBox.y + callBox.height * 0.5;
      await page.mouse.move(x, y, { steps: rand(8, 16) }).catch(() => {});
      await page.mouse.down().catch(() => {});
      await sleep(100);
      await page.mouse.up().catch(() => {});
      debug.clicked_llamar = true;
      debug.clicked_callish = true;
      debug.callish_label = callishLabel || "";
      step("clicked_llamar");
    } else {
      debug.clicked_llamar = false;
      debug.clicked_callish = false;
      debug.callish_label = callishLabel || "";
      step("llamar_click_failed_no_bbox");
    }
    await sleep(delays.afterClickCallMs || 1800);

    // Poll for DOM tel/wa appearance up to waitTelMaxMs (default 7s).
    // afterClickCallMs is the minimum wait; poll for the remainder.
    const waitTelMaxMs = delays.waitTelMaxMs || 7000;
    const pollIntervalMs = 500;
    const pollDeadline = Date.now() + Math.max(0, waitTelMaxMs - (delays.afterClickCallMs || 1800));
    let polledTelHref = null;
    let polledWaHref = null;
    let polledTextPhone = null; // phone found as plain TEXT in span/button (not a tel: link)

    while (Date.now() < pollDeadline) {
      // 1) Check for tel: links
      polledTelHref = await contactBox.locator("a[href^='tel:']").first().getAttribute("href").catch(() => null);
      if (polledTelHref) break;

      // 2) Check for wa.me links
      polledWaHref = await contactBox
        .locator("a[href*='wa.me'],a[href*='api.whatsapp.com/send']")
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (polledWaHref) break;

      // 3) Check for phone appearing as TEXT in the callish button/span area.
      //    After clicking "Llamar", ENC24 replaces the button text with the actual
      //    phone number (e.g. "📞 +50765774854") — NOT as a tel: href link.
      if (callishBtn) {
        const btnText = await callishBtn.textContent().catch(() => null);
        if (btnText) {
          const textPhones = extractPhonesFromText(btnText);
          for (const tp of textPhones) {
            if (!isSeedLikeValue(tp) && !isBannedE164(tp)) {
              polledTextPhone = tp;
              break;
            }
          }
        }
        // Also check the parent element (the button area might wrap the span)
        if (!polledTextPhone) {
          const parentText = await callishBtn.locator("xpath=..").textContent().catch(() => null);
          if (parentText) {
            const parentPhones = extractPhonesFromText(parentText);
            for (const tp of parentPhones) {
              if (!isSeedLikeValue(tp) && !isBannedE164(tp)) {
                polledTextPhone = tp;
                break;
              }
            }
          }
        }
      }
      if (polledTextPhone) break;

      // 4) Broader scan: any span/button/div inside contactBox with phone-like text
      if (!polledTextPhone) {
        const allBtnTexts = await contactBox
          .locator("button, span, [role='button'], a, div.phone, div.tel")
          .allTextContents()
          .catch(() => []);
        for (const txt of allBtnTexts) {
          const phones = extractPhonesFromText(txt);
          for (const tp of phones) {
            if (!isSeedLikeValue(tp) && !isBannedE164(tp)) {
              polledTextPhone = tp;
              break;
            }
          }
          if (polledTextPhone) break;
        }
      }
      if (polledTextPhone) break;

      await sleep(pollIntervalMs);
    }
    step("poll_dom_complete", {
      polledTelHref: polledTelHref || null,
      polledWaHref: polledWaHref || null,
      polledTextPhone: polledTextPhone || null,
    });

    // Strict extraction order:
    // A) contactBox tel:
    const telHref = polledTelHref
      || await contactBox.locator("a[href^='tel:']").first().getAttribute("href").catch(() => null);
    if (telHref) {
      step("extract_tel_dom", { telHref });
      const e164 = toPanamaE164(String(telHref).replace(/^tel:/i, ""));
      const seedRejected = isSeedLikeValue(e164 || telHref);
      const banned = isBannedE164(e164);
      debug.seed_rejected = seedRejected;
      debug.banned_e164 = banned;
      if (seedRejected || banned) {
        step("extract_tel_dom_rejected", { seedRejected, banned, e164 });
        // Don't return failed here — continue to other extraction paths.
      } else if (e164) {
        return {
          ok: true,
          stage: 2,
          method: "dom_tel",
          reason: "",
          phone_e164: e164,
          wa_link: null,
          seller_name,
          seller_is_business,
          debug,
          elapsed_ms: Date.now() - t0,
        };
      }
    }

    // A2) Phone found as TEXT in span/button after Llamar click.
    //     ENC24 replaces "Llamar" text with the actual phone (e.g. "📞 +50765774854").
    if (polledTextPhone) {
      step("extract_text_phone", { polledTextPhone });
      // polledTextPhone is already validated E.164 from extractPhonesFromText + toPanamaE164
      // and was pre-filtered by isSeedLikeValue + isBannedE164 in the polling loop.
      return {
        ok: true,
        stage: 2,
        method: "dom_text_phone",
        reason: "",
        phone_e164: polledTextPhone,
        wa_link: null,
        seller_name,
        seller_is_business,
        debug,
        elapsed_ms: Date.now() - t0,
      };
    }

    // Also do a one-shot broader text scan of contactBox for phone numbers
    // (catches cases where phone appears in any element as text, not just callish area)
    if (!polledTextPhone && !telHref) {
      const contactBoxText = await contactBox.textContent().catch(() => null);
      if (contactBoxText) {
        const cbPhones = extractPhonesFromText(contactBoxText);
        for (const cbp of cbPhones) {
          if (isSeedLikeValue(cbp) || isBannedE164(cbp)) continue;
          step("extract_contactbox_text_phone", { phone: cbp });
          return {
            ok: true,
            stage: 2,
            method: "dom_text_phone",
            reason: "",
            phone_e164: cbp,
            wa_link: null,
            seller_name,
            seller_is_business,
            debug,
            elapsed_ms: Date.now() - t0,
          };
        }
      }
    }

    // B) contactBox wa:
    const waHref = polledWaHref
      || await contactBox
        .locator("a[href*='wa.me'],a[href*='api.whatsapp.com/send']")
        .first()
        .getAttribute("href")
        .catch(() => null);
    if (waHref) {
      step("extract_wa_dom", { waHref });
      const seedRejected = isSeedLikeValue(waHref);
      // Check if WA link contains listing ID (e.g. wa.me/50731854815 where 31854815 is listing ID)
      const waContainsListingId = listing_id && String(waHref).includes(String(listing_id));
      debug.seed_rejected = seedRejected;
      if (seedRejected || waContainsListingId) {
        step("extract_wa_dom_rejected", { seedRejected, waContainsListingId });
      } else {
        return {
          ok: true,
          stage: 2,
          method: "dom_wa",
          reason: "",
          phone_e164: null,
          wa_link: waHref,
          seller_name,
          seller_is_business,
          debug,
          elapsed_ms: Date.now() - t0,
        };
      }
    }

    // C) Panel snapshot fallback: broader DOM search via page.evaluate.
    step("extract_panel_snapshot_start");
    const panelSnap = await getPanelSnapshot();
    if (panelSnap.ok) {
      step("extract_panel_snapshot_result", {
        telHrefs: panelSnap.telHrefs.length,
        waHrefs: panelSnap.waHrefs.length,
      });

      for (const href of panelSnap.telHrefs) {
        const e164 = toPanamaE164(String(href).replace(/^tel:/i, ""));
        if (!e164) continue;
        if (isSeedLikeValue(e164 || href)) continue;
        if (isBannedE164(e164)) continue;
        step("extract_panel_tel", { href, e164 });
        return {
          ok: true,
          stage: 2,
          method: "panel_tel",
          reason: "",
          phone_e164: e164,
          wa_link: null,
          seller_name,
          seller_is_business,
          debug,
          elapsed_ms: Date.now() - t0,
        };
      }

      for (const href of panelSnap.waHrefs) {
        if (isSeedLikeValue(href)) continue;
        if (listing_id && String(href).includes(String(listing_id))) continue;
        step("extract_panel_wa", { href });
        return {
          ok: true,
          stage: 2,
          method: "panel_wa",
          reason: "",
          phone_e164: null,
          wa_link: href,
          seller_name,
          seller_is_business,
          debug,
          elapsed_ms: Date.now() - t0,
        };
      }
    } else {
      step("extract_panel_snapshot_no_root");
    }

    // C2) early_wa fallback: if we found a wa.me link inside the contactBox before
    //     Llamar click and all DOM paths failed, use it before falling to noisy net candidates.
    //     (earlyWaHref is now scoped to contactBox so it's the seller's WA, not the site's.)
    if (earlyWaHref && !isSeedLikeValue(earlyWaHref) && !(listing_id && String(earlyWaHref).includes(String(listing_id)))) {
      step("early_wa_fallback_before_net", { earlyWaHref });
      return {
        ok: true,
        stage: 2,
        method: "early_wa_link",
        reason: "",
        phone_e164: null,
        wa_link: earlyWaHref,
        seller_name,
        seller_is_business,
        debug,
        elapsed_ms: Date.now() - t0,
      };
    }

    // D) Candidate maps from network responses (first handler populates these).
    step("extract_candidate_maps_start", {
      phone_candidates: phoneCandidates.size,
      wa_candidates: waCandidates.size,
    });

    if (phoneCandidates.size > 0) {
      let bestPhone = null;
      let bestPhoneMeta = null;
      const phonePrio = (w) => {
        const s = String(w || "");
        if (s.includes("dom_tel_after_call_click")) return 100;
        if (s.includes("dom_tel_final_scan")) return 95;
        if (s.includes("visible_call_after_call_click")) return 90;
        if (s.includes("visible_panel_after_call_click")) return 85;
        if (s.includes("popup_after_call_click")) return 80;
        if (s.includes("after_call_click")) return 75;
        if (s.includes("after_contactar")) return 60;
        if (s.includes("after_wa_click")) return 55;
        if (s.includes("net_key_")) return 40;
        if (s.includes("net_json")) return 30;
        if (s.includes("net_text")) return 10;
        return 0;
      };
      for (const [e164, meta] of phoneCandidates.entries()) {
        if (isSeedLikeValue(e164)) continue;
        if (isBannedE164(e164)) continue;
        if (isSuspiciousPhone(e164, meta.where)) continue;
        if (!bestPhone || phonePrio(meta.where) > phonePrio(bestPhoneMeta.where)) {
          bestPhone = e164;
          bestPhoneMeta = meta;
        }
      }
      if (bestPhone) {
        step("extract_candidate_phone", { phone: bestPhone, where: bestPhoneMeta.where });
        return {
          ok: true,
          stage: 2,
          method: "net_candidate_phone",
          reason: "",
          phone_e164: bestPhone,
          wa_link: null,
          seller_name,
          seller_is_business,
          debug: { ...debug, candidate_where: bestPhoneMeta.where },
          elapsed_ms: Date.now() - t0,
        };
      }
    }

    if (waCandidates.size > 0) {
      const waPrio = (w) => {
        const s = String(w || "");
        if (s.includes("popup_after_wa_click")) return 100;
        if (s.includes("dom_wa_after_wa_click")) return 90;
        if (s.includes("after_wa_click")) return 80;
        if (s.includes("after_contactar")) return 60;
        if (s.includes("dom_wa_final_scan")) return 40;
        if (s.includes("net_json")) return 30;
        if (s.includes("net_text")) return 10;
        return 0;
      };
      let bestWa = null;
      let bestWaMeta = null;
      for (const [wa, meta] of waCandidates.entries()) {
        if (isSeedLikeValue(wa)) continue;
        if (listing_id && String(wa).includes(String(listing_id))) continue;
        if (!bestWa || waPrio(meta.where) > waPrio(bestWaMeta.where)) {
          bestWa = wa;
          bestWaMeta = meta;
        }
      }
      if (bestWa) {
        step("extract_candidate_wa", { wa: bestWa, where: bestWaMeta.where });
        return {
          ok: true,
          stage: 2,
          method: "net_candidate_wa",
          reason: "",
          phone_e164: null,
          wa_link: bestWa,
          seller_name,
          seller_is_business,
          debug: { ...debug, candidate_where: bestWaMeta.where },
          elapsed_ms: Date.now() - t0,
        };
      }
    }

    // E) fallback from XHR text payloads only if no DOM tel/wa found.
    step("extract_xhr_fallback_start", { xhr_payloads: xhrPayloadTexts.length });
    for (const body of xhrPayloadTexts) {
      const phones = extractPhonesFromText(body);
      for (const p of phones) {
        const e164 = toPanamaE164(p);
        if (!e164) continue;
        if (isSeedLikeValue(e164)) continue;
        if (isBannedE164(e164)) continue;
        return {
          ok: true,
          stage: 2,
          method: "xhr_phone",
          reason: "",
          phone_e164: e164,
          wa_link: null,
          seller_name,
          seller_is_business,
          debug: { ...debug, seed_rejected: false },
          elapsed_ms: Date.now() - t0,
        };
      }
      const waLinks = extractWaLinksFromText(body);
      for (const wa of waLinks) {
        if (isSeedLikeValue(wa)) continue;
        if (listing_id && String(wa).includes(String(listing_id))) continue;
        return {
          ok: true,
          stage: 2,
          method: "xhr_wa",
          reason: "",
          phone_e164: null,
          wa_link: wa,
          seller_name,
          seller_is_business,
          debug: { ...debug, seed_rejected: false },
          elapsed_ms: Date.now() - t0,
        };
      }
    }

    return {
      ok: false,
      stage: 2,
      method: "no_contact_revealed",
      reason: "no_phone_no_wa",
      phone_e164: null,
      wa_link: null,
      seller_name,
      seller_is_business,
      debug,
      elapsed_ms: Date.now() - t0,
    };

  } catch (e) {
    const msg = String(e?.message || e);
    return {
      ok: false,
      stage: 2,
      method: "exception",
      reason: msg,
      phone_e164: null,
      wa_link: null,
      seller_name,
      seller_is_business,
      debug,
      elapsed_ms: Date.now() - t0,
    };
  } finally {
    try {
      if (page) await page.close().catch(() => {});
      if (context && String(process.env.ENC24_CDP || "") !== "1") {
        await context.close().catch(() => {});
      }
      if (browser && String(process.env.ENC24_CDP || "") !== "1" && !usedPersistentContext) {
        await browser.close().catch(() => {});
      }
    } catch {}
  }
}

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const listingUrl = process.argv[2] || process.env.ENC24_DEBUG_URL || "";
  if (!listingUrl) {
    console.error("ENC24_DEBUG missing listing URL");
    process.exit(1);
  }

  const result = await resolveEncuentra24PhoneFromListing(listingUrl, {
    headless: String(process.env.HEADLESS || "1") !== "0",
    saveShots: Number(process.env.SAVE_SHOTS || 0),
    delays: {
      waitContactMs: Number(process.env.ENC24_WAIT_CONTACT_MS || 25000),
      afterClickCallMs: Number(process.env.ENC24_AFTER_CLICK_CALL_MS || 1800),
      typingDelayMs: Number(process.env.ENC24_TYPING_DELAY_MS || 90),
    },
    form: {
      email: process.env.ENC24_FORM_EMAIL || "pacho@pachosanchez.com",
      name: process.env.ENC24_FORM_NAME || "Pacho",
      phone8: "67777777",
    },
  });

  console.log("ENC24_DEBUG contactBox_selector=", result?.debug?.contact_box_selector || "");
  console.log("ENC24_DEBUG email_selector=", result?.debug?.matched_inputs?.email || "");
  console.log("ENC24_DEBUG name_selector=", result?.debug?.matched_inputs?.name || "");
  console.log("ENC24_DEBUG phone_selector=", result?.debug?.matched_inputs?.phone || "");
  console.log("ENC24_DEBUG clicked_llamar=", Boolean(result?.debug?.clicked_llamar));
  console.log("ENC24_DEBUG clicked_callish=", Boolean(result?.debug?.clicked_callish), "label=", result?.debug?.callish_label || "");
  console.log("ENC24_DEBUG tel_or_wa=", result?.phone_e164 || result?.wa_link || "");
  console.log("ENC24_DEBUG seed_rejected=", Boolean(result?.debug?.seed_rejected));
  console.log("ENC24_DEBUG final_ok=", Boolean(result?.ok), "method=", result?.method || "", "reason=", result?.reason || "");
  console.log("ENC24_DEBUG_RESULT_JSON", JSON.stringify(result));
}
