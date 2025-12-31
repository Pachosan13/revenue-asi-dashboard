import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
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

function extractListingId(listingUrl) {
  const m = String(listingUrl).match(/\/(\d{6,})\b/);
  return m ? m[1] : null;
}

function toPanamaE164(phoneLike) {
  if (!phoneLike) return null;
  const s = String(phoneLike).trim();

  if (/^\+\d{8,15}$/.test(s)) return s;

  const d = s.replace(/\D/g, "");
  if (d.length === 8) return `+507${d}`;
  if (d.length === 11 && d.startsWith("507")) return `+${d}`;

  if (s.startsWith("00")) {
    const d2 = s.replace(/\D/g, "");
    return d2.length >= 8 ? `+${d2.slice(2)}` : null;
  }

  return null;
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

  function considerPhone(phone, where, url) {
    const e164 = toPanamaE164(phone);
    if (!e164) return;
    if (isBannedE164(e164)) return;
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

        // Reduce garbage: only parse encuentra24 responses
        if (!/encuentra24\.com/i.test(url)) return;

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

    // ======== CONTACT PANEL SELECTORS (the real fix)
    // panel header is "Enviar mensaje al vendedor"
    step("locate_contact_panel");

    const panel = page.locator("text=Enviar mensaje al vendedor").first();
    await panel.waitFor({ timeout: delays.waitContactMs || 25000 }).catch(() => {});
    await sleep(250);

    // find inputs near the panel: we grab the closest container
    const container = page.locator("text=Enviar mensaje al vendedor").first().locator("xpath=ancestor::*[self::div or self::section][1]");
    // sometimes header is inside another wrapper; fallback: right card
    const containerCount = await container.count().catch(() => 0);
    const card = containerCount ? container : page.locator("[class*='contact' i], [class*='seller' i], form").first();

    // Email input (required) — Encuentra24 sometimes uses type=text; don't assume type=email.
    // We scope to the contact card to avoid grabbing search inputs elsewhere.
    const emailLoc = card.locator(
      [
        "input[type='email']",
        "input[placeholder*='mail' i]",
        "input[placeholder*='e-mail' i]",
        "input[name*='mail' i]",
        "input[id*='mail' i]",
        "input[autocomplete='email']",
        "input[inputmode='email']",
        // fallback: first input in the contact card (works when they omit types/attrs)
        "input",
      ].join(","),
    ).first();

    // The 2 side-by-side inputs: LEFT = name, RIGHT = phone.
    // We force by placeholder: name placeholder contains "Nombre" on empty; once filled it shows value.
    // Phone placeholder includes "Ej:" / "6123" / has country flag next to it; easiest is placeholder.
    const nameLoc =
      card.locator("input[placeholder*='Nombre' i]").first();

    const phoneLoc =
      card.locator("input[type='tel']").first()
        .or(card.locator("input[placeholder*='Ej' i], input[placeholder*='6123' i], input[placeholder*='4567' i]").first());

    const msgLoc = card.locator("textarea").first();

    step("wait_inputs");
    await emailLoc.waitFor({ timeout: delays.waitContactMs || 25000 });
    await nameLoc.waitFor({ timeout: delays.waitContactMs || 25000 }).catch(() => {});
    await phoneLoc.waitFor({ timeout: delays.waitContactMs || 25000 }).catch(() => {});
    await snap(page, "02_contact_visible");

    // ======== FILL (with verification)
    step("fill_form_start");

    // open network parsing window after we start filling (reduces false positives)
    revealWindowOpenAt = Date.now();

    const email = String(form.email || "pacho@pachosanchez.com");
    const name = String(form.name || "Pacho");
    const phone8 = String(form.phone8 || "67777777").replace(/\D/g, "");

    // Email
    await typeLikeHuman(emailLoc, email, delays.typingDelayMs || 90);
    await sleep(rand(80, 200));
    // Name (IMPORTANT: ensure it doesn't end up in phone)
    await typeLikeHuman(nameLoc, name, delays.typingDelayMs || 90);
    await sleep(rand(80, 200));
    // Phone
    await sleep(delays.beforePhoneTypeMs || 500);
    await typeLikeHuman(phoneLoc, phone8, delays.typingDelayMs || 90);

    // Message
    if (await msgLoc.count().catch(() => 0)) {
      await msgLoc.click({ timeout: 2000 }).catch(() => {});
      await msgLoc.fill("Me interesa el anuncio. Por favor contáctame.").catch(() => {});
    }

    await sleep(delays.afterFillMs || 900);

    // Verify values actually stuck (THIS is what you were missing)
    const filled = await page.evaluate(() => {
      const pick = (sels) => {
        for (const s of sels) {
          const el = document.querySelector(s);
          if (el && (el.value ?? "").toString().trim().length >= 0) return el;
        }
        return null;
      };
      const emailEl =
        pick([
          "input[type='email']",
          "input[placeholder*='mail' i]",
          "input[placeholder*='e-mail' i]",
          "input[name*='mail' i]",
          "input[id*='mail' i]",
          "input[autocomplete='email']",
          "input",
        ]) || null;

      const nameInput = document.querySelector("input[placeholder*='Nombre' i]") || document.querySelectorAll("input")[1];
      const phoneInput = document.querySelector("input[type='tel']") || document.querySelector("input[placeholder*='Ej' i]");
      return {
        email: emailEl?.value || "",
        name: nameInput?.value || "",
        phone: phoneInput?.value || "",
      };
    });

    debug.fill = filled;

    // If email didn’t stick, re-try once (common if overlay steals focus)
    if (!String(filled.email || "").includes("@")) {
      step("refill_email_retry", { filled });
      await closeOverlays();
      await typeLikeHuman(emailLoc, email, delays.typingDelayMs || 90);
      await sleep(400);
    }

    // If name contains digits (your exact bug), refix: clear and type again
    if (/\d/.test(String(filled.name || ""))) {
      step("refill_name_fix_digits", { filled });
      await nameLoc.fill("").catch(() => {});
      await sleep(150);
      await typeLikeHuman(nameLoc, name, delays.typingDelayMs || 90);
      await sleep(250);
    }

    await snap(page, "03_filled");

    // ========= OPTIONAL: submit "Contactar" to unlock phone/wa =========
    // Many listings keep "Llamar/WhatsApp" visually present but inert until a message is submitted.
    if (sendMessageBeforeReveal) {
      step("pre_contactar_unlock");
      await closeOverlays();
      const contactBtn = locateActionByText("Contactar");
      if (await contactBtn.count().catch(() => 0)) {
        // try once; if it fails silently, we still continue to call/wa
        await humanClick(contactBtn);
        await sleep(1400);
        didClickContactar = true;
        await tryCapturePopup("after_contactar");
        await scanDom("after_contactar");
        await scanVisiblePhoneText("after_contactar");
        await snap(page, "03b_after_contactar");
      } else {
        step("contactar_btn_not_found");
      }
    }

    // ======== DOM scan STRICT
    async function scanDom(where) {
      const data = await page.evaluate(() => {
        // Scope to the contact panel to avoid picking up footer/help numbers/ads.
        const header = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,section"))
          .find((el) => (el.textContent || "").includes("Enviar mensaje al vendedor"));
        const root = header ? (header.closest("section") || header.closest("div") || header) : document.body;

        const telLinks = Array.from(root.querySelectorAll("a[href^='tel:']"))
          .map((a) => a.getAttribute("href"))
          .filter(Boolean);

        const waLinks = Array.from(
          root.querySelectorAll("a[href*='wa.me'],a[href*='whatsapp.com/send'],a[href*='api.whatsapp.com/send']"),
        )
          .map((a) => a.getAttribute("href"))
          .filter(Boolean);

        return { telLinks, waLinks };
      });

      for (const href of data.telLinks || []) {
        const p = href.replace(/^tel:/i, "");
        considerPhone(p, `dom_tel_${where}`, "DOM");
      }
      for (const href of data.waLinks || []) {
        considerWa(href, `dom_wa_${where}`, "DOM");
      }

      debug.dom_hits.push({
        where,
        tel_n: (data.telLinks || []).length,
        wa_n: (data.waLinks || []).length,
      });
    }

    async function scanVisiblePhoneText(where) {
      const data = await page.evaluate(() => {
        const findFirstByText = (tag, needle) => {
          const n = String(needle || "").toLowerCase();
          const els = Array.from(document.querySelectorAll(tag));
          for (const el of els) {
            const t = (el.textContent || "").toLowerCase();
            if (t.includes(n)) return el;
          }
          return null;
        };

        // Scope to the contact panel; after reveal the "Llamar" button text becomes a phone number
        // and may no longer include the word "Llamar".
        const header = Array.from(document.querySelectorAll("h1,h2,h3,h4,div,section"))
          .find((el) => (el.textContent || "").includes("Enviar mensaje al vendedor"));
        const root = header ? (header.closest("section") || header.closest("div") || header) : null;

        const callEl =
          (root ? root.querySelector("button, a, [role='button']") : null) ||
          findFirstByText("button", "llamar") ||
          findFirstByText("a", "llamar");

        const call = callEl?.textContent || "";

        // Collect all action button/link texts inside the panel (best signal for revealed phone)
        const actionTexts = root
          ? Array.from(root.querySelectorAll("button, a, [role='button']")).map((el) => (el.textContent || "").trim())
          : [];
        const actionsText = actionTexts.join(" | ");

        // grab contact panel text (scoped), not whole page
        const panelText = root ? (root.textContent || "") : "";

        return { callText: call, actionsText, panelText };
      });

      for (const p of extractPhonesFromText(data.callText || "")) considerPhone(p, `visible_call_${where}`, "VISIBLE");
      for (const p of extractPhonesFromText(data.actionsText || "")) considerPhone(p, `visible_actions_${where}`, "VISIBLE");
      // panelText can be noisy; still useful if phone is shown as plain text. Seed phone is banned by isBannedE164.
      for (const p of extractPhonesFromText(data.panelText || "")) considerPhone(p, `visible_panel_${where}`, "VISIBLE");

      debug.dom_hits.push({
        where: `visible_${where}`,
        call_text_len: String(data.callText || "").length,
        actions_text_len: String(data.actionsText || "").length,
        panel_text_len: String(data.panelText || "").length,
      });
    }

    async function tryCapturePopup(where) {
      try {
        const pop = await page.waitForEvent("popup", { timeout: 1200 });
        const u = pop.url();
        // Sometimes it navigates to wa.me or similar
        for (const w of extractWaLinksFromText(u)) considerWa(w, `popup_${where}`, u);
        // Sometimes it navigates to tel: (rare in desktop, but possible)
        if (u && u.toLowerCase().startsWith("tel:")) {
          considerPhone(u.replace(/^tel:/i, ""), `popup_${where}`, u);
        }
        await pop.close().catch(() => {});
      } catch {
        // no popup
      }
    }

    // ======== CLICK CALL + WA (human)
    step("click_llamar");
    await closeOverlays();
    const callBtn = locateActionByText("Llamar");
    if (await callBtn.count().catch(() => 0)) {
      const disabled = await isDisabled(callBtn);

      // If disabled and we are allowed, try submitting "Contactar" first (often required to unlock call/wa).
      if (disabled && sendMessageBeforeReveal) {
        step("call_disabled_try_contactar");
        const contactBtn = locateActionByText("Contactar");
        if (await contactBtn.count().catch(() => 0)) {
          await humanClick(contactBtn);
          await sleep(1200);
          didClickContactar = true;
          await tryCapturePopup("after_contactar");
          await scanDom("after_contactar");
          await scanVisiblePhoneText("after_contactar");
          await snap(page, "03b_after_contactar");
        }
      }

      const beforeSnap = await getPanelSnapshot();
      const beforePhoneN = phoneCandidates.size;
      const beforeWaN = waCandidates.size;

      let callRevealed = false;
      for (let attempt = 1; attempt <= Math.max(1, maxCallClicks); attempt++) {
        step("call_click_attempt", { attempt });
        await closeOverlays();
        await callBtn.scrollIntoViewIfNeeded().catch(() => {});
        await sleep(rand(120, 260));
        await humanClick(callBtn);
        await sleep(delays.afterClickCallMs || 1800);
        didClickCall = true;

        await tryCapturePopup(`after_call_click_${attempt}`);
        await scanDom(`after_call_click_${attempt}`);
        await scanVisiblePhoneText(`after_call_click_${attempt}`);
        await snap(page, `04_after_call_${attempt}`);

        const afterSnap = await getPanelSnapshot();
        const afterPhoneN = phoneCandidates.size;
        const afterWaN = waCandidates.size;

        const callTextChanged = String(afterSnap.callText || "") !== String(beforeSnap.callText || "");
        const telIncreased = (afterSnap.telHrefs?.length || 0) > (beforeSnap.telHrefs?.length || 0);
        const candidatesIncreased = afterPhoneN > beforePhoneN || afterWaN > beforeWaN;

        if (callTextChanged || telIncreased || candidatesIncreased) {
          callRevealed = true;
          break;
        }

        debug.soft_block = debug.soft_block || {};
        debug.soft_block.inert_call_clicks = attempt;
        step("call_inert_no_reveal", {
          attempt,
          before_call_text: beforeSnap.callText || "",
          after_call_text: afterSnap.callText || "",
          before_tel_n: beforeSnap.telHrefs?.length || 0,
          after_tel_n: afterSnap.telHrefs?.length || 0,
          before_candidates: { phone: beforePhoneN, wa: beforeWaN },
          after_candidates: { phone: afterPhoneN, wa: afterWaN },
        });

        await sleep(rand(900, 1600));
      }

      if (!callRevealed) {
        debug.soft_block = debug.soft_block || {};
        debug.soft_block.suspected = true;
        debug.soft_block.kind = debug.soft_block.kind || "inert_call_reveal";
      }
    } else {
      step("call_btn_not_found");
    }

    step("click_whatsapp");
    await closeOverlays();
    const waBtn = locateActionByText("WhatsApp");
    if (await waBtn.count().catch(() => 0)) {
      await humanClick(waBtn);
      await sleep(1200);
      didClickWa = true;
      await tryCapturePopup("after_wa_click");
      await scanDom("after_wa_click");
      await scanVisiblePhoneText("after_wa_click");
      await snap(page, "05_after_wa");
    } else {
      step("wa_btn_not_found");
    }

    step("wait_late_xhr");
    await sleep(delays.waitTelMaxMs || 7000);
    await scanDom("final_scan");
    await scanVisiblePhoneText("final_scan");

    // ======== Pick best (prefer revealed-after-click; avoid "support"/noise)
    const phoneEntries = Array.from(phoneCandidates.entries()); // [e164, {where,url}]
    const waEntries = Array.from(waCandidates.entries()); // [url, {where,url}]

    const isTrustedPhoneWhere = (w) => {
      const s = String(w || "");
      // accept only after actual interactions; final_scan only if we clicked something
      if (s.includes("after_call_click")) return true;
      if (s.includes("after_contactar")) return true;
      if (s.includes("after_wa_click")) return true;
      if (s.includes("popup_after_call_click")) return true;
      if (s.includes("popup_after_contactar")) return true;
      if (s.includes("popup_after_wa_click")) return true;
      if (s.includes("final_scan")) return didClickCall || didClickWa || didClickContactar;
      return false;
    };

    const isTrustedWaWhere = (w) => {
      const s = String(w || "");
      if (s.includes("after_wa_click")) return true;
      if (s.includes("popup_after_wa_click")) return true;
      if (s.includes("after_contactar")) return true;
      if (s.includes("final_scan")) return didClickWa || didClickContactar;
      return false;
    };

    const pickPhone = () => {
      const trusted = phoneEntries.filter(([_, meta]) => isTrustedPhoneWhere(meta?.where));
      // Prefer DOM tel links specifically
      const prefer = (arr) =>
        arr.sort((a, b) => {
          const aw = String(a[1]?.where || "");
          const bw = String(b[1]?.where || "");
          const aTel = aw.includes("dom_tel") ? 1 : 0;
          const bTel = bw.includes("dom_tel") ? 1 : 0;
          if (aTel !== bTel) return bTel - aTel;
          const aAfter = aw.includes("after_call_click") ? 1 : 0;
          const bAfter = bw.includes("after_call_click") ? 1 : 0;
          if (aAfter !== bAfter) return bAfter - aAfter;
          return 0;
        });
      const best = prefer(trusted)[0];
      return best ? best[0] : null;
    };

    const pickWa = () => {
      const trusted = waEntries.filter(([_, meta]) => isTrustedWaWhere(meta?.where));
      return trusted[0]?.[0] ?? null;
    };

    const phone_e164 = pickPhone();
    const wa_link = pickWa();

    const ok = Boolean(phone_e164) || Boolean(wa_link);

    const method =
      phone_e164 ? "dom_tel_or_net" :
      wa_link ? "dom_wa_or_net" :
      "no_contact_revealed";

    let reason = "";
    if (!ok) {
      if (debug?.soft_block?.suspected) reason = "soft_block_inert_reveal";
      else reason = "no_phone_no_wa";
    }

    // dummy protection
    if (phone_e164 && FORM_PHONE_E164 && phone_e164 === FORM_PHONE_E164) {
      return {
        ok: false,
        stage: 2,
        method: "dummy_phone_detected",
        reason: "returned_phone_equals_form_phone",
        phone_e164,
        wa_link: null,
        debug,
      };
    }

    // listing id protection
    if (phone_e164 && listing_id && String(phone_e164).includes(String(listing_id))) {
      return {
        ok: false,
        stage: 2,
        method: "listing_id_phone_detected",
        reason: "returned_phone_contains_listing_id",
        phone_e164: null,
        wa_link,
        debug,
      };
    }

    return {
      ok,
      stage: 2,
      method,
      reason,
      phone_e164,
      wa_link,
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
