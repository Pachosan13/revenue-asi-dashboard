// worker/providers/phone-resolver/encuentra24_whatsapp_resolver.mjs
import { chromium } from "playwright";
import fs from "node:fs";

globalThis.__enc24_keep = globalThis.__enc24_keep || [];

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function normalizePA(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length === 8) return `+507${digits}`;
  if (digits.length === 11 && digits.startsWith("507")) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith("00507")) return `+${digits.slice(2)}`;
  if (String(raw).startsWith("+") && digits.length >= 8) return `+${digits}`;
  return null;
}

function extractPhoneFromAny(s) {
  const txt = String(s || "");
  const m =
    txt.match(/\+507\s*\d{8}/) ||
    txt.match(/\b507\d{8}\b/) ||
    txt.match(/\b00507\d{8}\b/) ||
    txt.match(/\b[6]\d{7}\b/);
  if (!m) return null;
  return normalizePA(m[0]);
}

async function forceSetValue(page, selector, value) {
  await page.evaluate(({ sel, val }) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.value = val;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }, { sel: selector, val: value });
}

async function safeText(loc) {
  try { return (await loc.first().innerText())?.trim() || ""; } catch { return ""; }
}
async function safeAttr(loc, name) {
  try { return await loc.first().getAttribute(name); } catch { return null; }
}

function nowIso() { return new Date().toISOString(); }

function buildShotsDir() {
  const base = process.env.ENC24_SHOTS_DIR || "/tmp/enc24_shots";
  return `${base}/${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function maybeShot(page, saveShots, shotsDir, name) {
  if (!saveShots) return;
  try { await page.screenshot({ path: `${shotsDir}/${name}.png`, fullPage: true }); } catch {}
}

function antiBotArgs() {
  return [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-sandbox",
    "--disable-infobars",
    "--start-maximized",
  ];
}

async function attachNetworkSniffer(page, debug) {
  let captured = null;

  page.on("response", async (res) => {
    try {
      const url = res.url();
      const ct = (res.headers()["content-type"] || "").toLowerCase();
      if (!ct.includes("json") && !ct.includes("text")) return;

      const maybeRelevant =
        url.includes("contact") ||
        url.includes("phone") ||
        url.includes("message") ||
        url.includes("reveal") ||
        url.includes("ajax") ||
        url.includes("api");

      if (!maybeRelevant) return;

      const txt = await res.text().catch(() => "");
      const p = extractPhoneFromAny(txt);
      if (p && !captured) {
        captured = p;
        debug.net_phone = p;
        debug.net_url = url;
        debug.net_ct = ct;
      }
    } catch {}
  });

  return () => captured;
}

/** profile lock cleanup (no cambia tu lógica) */
function cleanupChromeProfileLocks(userDataDir, debug) {
  if (!userDataDir) return;
  const dir = userDataDir.replace(/\/+$/, "");
  const locks = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  for (const f of locks) {
    const p = `${dir}/${f}`;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      debug.profile_lock_cleanup = (debug.profile_lock_cleanup || []).concat(p);
    } catch (e) {
      debug.profile_lock_cleanup_err = String(e?.message || e);
    }
  }
}

/** CDP support (usa tu Chrome real) */
async function maybeConnectOverCDP(debug) {
  const useCdp = String(process.env.ENC24_CDP || "") === "1";
  if (!useCdp) return null;

  const url = process.env.ENC24_CDP_URL || "http://127.0.0.1:9222";
  try {
    const browser = await chromium.connectOverCDP(url);
    const context = browser.contexts()[0] || (await browser.newContext());
    const page = await context.newPage();
    debug.connected_over_cdp = true;
    debug.cdp_url = url;
    return { browser, context, page, cdp: true };
  } catch (e) {
    debug.connected_over_cdp = false;
    debug.cdp_error = String(e?.message || e);
    return null;
  }
}

/**
 * NEW: mata el overlay “Permita anuncios…” + backdrop.
 * Esto es exactamente lo que te estaba bloqueando el teléfono.
 */
async function dismissAdblockOverlay(page, debug, saveShots, shotsDir) {
  // intenta varias veces, a veces aparece tarde
  for (let i = 0; i < 4; i++) {
    try {
      // 1) click X en el overlay si existe
      const closeBtn = page.locator(
        [
          // tu screenshot: X arriba derecha del modal
          ".d3-modal__close",
          ".d3-modal__close-button",
          "button[aria-label='Cerrar']",
          "button[aria-label='Close']",
          "button:has-text('×')",
          "button:has-text('✕')",
          "button:has-text('Cerrar')",
          "a[aria-label='Cerrar']",
          "a[aria-label='Close']",
          "div[role='dialog'] button",
          "div[aria-modal='true'] button",
        ].join(",")
      ).first();

      if (await closeBtn.isVisible().catch(() => false)) {
        await closeBtn.click({ timeout: 1500 }).catch(() => {});
        debug.adblock_overlay_closed = true;
        await sleep(350);
        await maybeShot(page, saveShots, shotsDir, `adblock_closed_${i}`);
      }

      // 2) si quedó backdrop, bórralo vía JS
      const killed = await page.evaluate(() => {
        const killers = [
          // overlays típicos
          "[role='dialog']",
          "div[aria-modal='true']",
          ".d3-modal",
          ".modal",
          ".overlay",
          ".backdrop",
        ];
        let removed = 0;
        for (const sel of killers) {
          document.querySelectorAll(sel).forEach((n) => {
            const txt = (n.innerText || "").toLowerCase();
            if (
              txt.includes("bloqueador") ||
              txt.includes("anuncios") ||
              txt.includes("permita") ||
              txt.includes("bienvenido a encuentra24")
            ) {
              n.remove();
              removed++;
            }
          });
        }
        // desbloquea scroll
        document.documentElement.style.overflow = "auto";
        document.body.style.overflow = "auto";
        return removed;
      }).catch(() => 0);

      if (killed) {
        debug.adblock_overlay_removed_nodes = (debug.adblock_overlay_removed_nodes || 0) + killed;
        await sleep(250);
      }

      // quick exit si ya no hay modal visible
      const stillModal = await page.locator("div[aria-modal='true'], [role='dialog']").first().isVisible().catch(() => false);
      if (!stillModal) return;
    } catch {}
    await sleep(650);
  }
}

/**
 * NEW: teclea teléfono como humano (igual que tú lo hiciste).
 * OJO: primero intenta solo tipeo; SOLO si falla, forceSetValue.
 */
async function typeLikeHuman(page, phoneVisible, phone8, debug, delay = 110) {
  await phoneVisible.scrollIntoViewIfNeeded().catch(() => {});
  await phoneVisible.click({ timeout: 8000 }).catch(() => {});
  // clear robust
  await phoneVisible.fill("").catch(() => {});
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
  // type slowly
  await page.keyboard.type(phone8, { delay }).catch(() => {});
  await sleep(350);

  // blur/focus to trigger binders
  await page.keyboard.press("Tab").catch(() => {});
  await sleep(150);
  await phoneVisible.click().catch(() => {});
  debug.phone_typed_like_human = true;
}

/**
 * Resolver Encuentra24 (Stage2)
 * - Si opts.userDataDir: usa Chrome real + persistent context
 * - Llena form, click “Llamar”
 * - Extrae por DOM + NETWORK sniffer
 * Extra:
 * - Maneja popup adblock
 * - CDP opcional
 */
export async function resolveEncuentra24PhoneFromListing(url, opts = {}) {
  const headless = opts.headless ?? true;
  const form = opts.form ?? {};
  const delays = opts.delays ?? {};
  const userDataDir = opts.userDataDir;

  const SLOWMO = Number(process.env.PW_SLOWMO || "0");
  const KEEP_OPEN = String(process.env.KEEP_OPEN || "") === "1";
  const saveShots = Number(opts.saveShots || 0);

  const debug = {
    ts: nowIso(),
    scoped: true,
    last_open_url: url,
    userDataDir: userDataDir || null,
    headless,
  };

  const WAIT_CONTACT_MS = Number(delays.waitContactMs || 20000);
  const WAIT_PHONE_INPUT_MS = Number(delays.waitPhoneInputMs || 20000);
  const BEFORE_PHONE_TYPE_MS = Number(delays.beforePhoneTypeMs || 1200);
  const TYPING_DELAY_MS = Number(delays.typingDelayMs || 120);
  const AFTER_FILL_MS = Number(delays.afterFillMs || 1400);
  const AFTER_CLICK_CALL_MS = Number(delays.afterClickCallMs || 2200);
  const WAIT_TEL_MAX_MS = Number(delays.waitTelMaxMs || 25000);

  let browser = null;
  let context = null;
  let page = null;
  let isCDP = false;

  const shotsDir = saveShots ? buildShotsDir() : null;

  try {
    if (shotsDir) {
      try { await fs.promises.mkdir(shotsDir, { recursive: true }); } catch {}
      debug.shots_dir = shotsDir;
    }

    const persistent = !!userDataDir;
    debug.persistent = persistent;

    // CDP first if enabled
    const cdp = await maybeConnectOverCDP(debug);
    if (cdp) {
      browser = cdp.browser;
      context = cdp.context;
      page = cdp.page;
      isCDP = true;
    } else {
      if (persistent) cleanupChromeProfileLocks(userDataDir, debug);

      if (persistent) {
        context = await chromium.launchPersistentContext(userDataDir, {
          headless,
          channel: "chrome",
          slowMo: SLOWMO,
          viewport: null,
          locale: "es-PA",
          timezoneId: "America/Panama",
          args: antiBotArgs(),
        });
        page = await context.newPage();
      } else {
        browser = await chromium.launch({
          headless,
          channel: process.env.ENC24_CHANNEL === "chrome" ? "chrome" : undefined,
          slowMo: SLOWMO,
          args: antiBotArgs(),
        });
        context = await browser.newContext({
          viewport: { width: 1280, height: 900 },
          locale: "es-PA",
          timezoneId: "America/Panama",
        });
        page = await context.newPage();
      }
    }

    debug.is_cdp = isCDP;

    if (KEEP_OPEN) globalThis.__enc24_keep.push({ browser, context, page });

    const getNetPhone = await attachNetworkSniffer(page, debug);

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await sleep(600);
    await maybeShot(page, saveShots, shotsDir, "01_loaded");

    // ✅ adblock overlay killer (antes de tocar inputs)
    await dismissAdblockOverlay(page, debug, saveShots, shotsDir);

    const contactBox = page.locator("form[id^='messageform_'], .d3-property-contact__form").first();
    await contactBox.waitFor({ state: "visible", timeout: WAIT_CONTACT_MS });
    await maybeShot(page, saveShots, shotsDir, "02_contact_visible");

    // inputs
    const emailInput = contactBox.locator("input[name*='email'], input[name*='fromemail']").first();
    const nameInput = contactBox.locator("input[name*='name']").first();

    await emailInput.waitFor({ state: "visible", timeout: 10000 });
    await emailInput.fill(form.email || "pacho@pachosanchez.com");

    await nameInput.waitFor({ state: "visible", timeout: 10000 });
    await nameInput.fill(form.name || "Pacho");

    // hidden phone fields
    const ccHidden = contactBox.locator(
      "input[name='cnmessage[phone][countrycode]'], #cnmessage_phone_countrycode, input[name$='[countrycode]']"
    ).first();

    const pnHidden = contactBox.locator(
      "input[name='cnmessage[phone][phonenumber]'], #cnmessage_phone_phonenumber, input[name$='[phonenumber]']"
    ).first();

    await ccHidden.waitFor({ state: "attached", timeout: WAIT_PHONE_INPUT_MS }).catch(() => {});
    await pnHidden.waitFor({ state: "attached", timeout: WAIT_PHONE_INPUT_MS }).catch(() => {});

    // visible phone inside box
    const phoneVisible = contactBox.locator(
      [
        "input[type='tel']:visible",
        "input[placeholder*='Tel']:visible",
        "input[placeholder*='tel']:visible",
        "input[placeholder*='6123']:visible",
        "input[placeholder*='Ej']:visible",
        "input[name*='phone']:visible",
        "input[id*='phone']:visible",
        "input[class*='phone']:visible",
      ].join(",")
    ).first();

    await phoneVisible.waitFor({ state: "visible", timeout: WAIT_PHONE_INPUT_MS });

    await sleep(BEFORE_PHONE_TYPE_MS);

    const phone8 = String(form.phone8 || "67777777").replace(/\D/g, "").slice(-8);
    debug.phone8 = phone8;

    async function typePhoneAndSync() {
      // ✅ overlay puede reaparecer; lo tumbamos otra vez justo antes del tel
      await dismissAdblockOverlay(page, debug, saveShots, shotsDir);

      // ✅ primero tipeo humano (como tú hiciste)
      await typeLikeHuman(page, phoneVisible, phone8, debug, TYPING_DELAY_MS);

      await sleep(650);

      let hiddenNow = await pnHidden.inputValue().catch(() => "");
      debug.phone_hidden_after_type = hiddenNow;

      // ensure cc
      let ccVal = await ccHidden.inputValue().catch(() => "");
      debug.cc_hidden_before_force = ccVal;

      if (!ccVal || !String(ccVal).includes("507")) {
        await forceSetValue(
          page,
          "input[name='cnmessage[phone][countrycode]'], #cnmessage_phone_countrycode, input[name$='[countrycode]']",
          "00507"
        );
        await sleep(250);
      }

      // si NO sincronizó hidden, entonces forzamos hidden (fallback)
      const hiddenDigits = String(hiddenNow || "").replace(/\D/g, "");
      if (hiddenDigits.length < 8) {
        debug.phone_sync = "fallback_force_hidden_js";
        await forceSetValue(
          page,
          "input[name='cnmessage[phone][phonenumber]'], #cnmessage_phone_phonenumber, input[name$='[phonenumber]']",
          phone8
        );
        await sleep(250);
      } else {
        debug.phone_sync = "typed_ok";
      }

      const ccFinal = await ccHidden.inputValue().catch(() => "");
      const pnFinal = await pnHidden.inputValue().catch(() => "");
      debug.cc_hidden_final = ccFinal;
      debug.phone_hidden_final = pnFinal;

      return {
        ccOk: String(ccFinal || "").includes("507"),
        pnOk: String(pnFinal || "").replace(/\D/g, "").length >= 8,
      };
    }

    const s1 = await typePhoneAndSync();
    if (!s1.ccOk || !s1.pnOk) {
      debug.phone_sync_retry = true;
      await sleep(900);
      await typePhoneAndSync();
    }

    await maybeShot(page, saveShots, shotsDir, "03_filled");
    await sleep(AFTER_FILL_MS);

    // Click “Llamar”
    const callBtn = contactBox.locator(
      ".d3-button.d3-property-contact__phone, button:has-text('Llamar'), a:has-text('Llamar')"
    ).first();

    await callBtn.waitFor({ state: "visible", timeout: 15000 });
    await callBtn.scrollIntoViewIfNeeded().catch(() => {});
    await sleep(250);

    debug.call_btn_text_before = await safeText(callBtn);
    debug.call_btn_class = await safeAttr(callBtn, "class");

    // overlay puede bloquear el click también
    await dismissAdblockOverlay(page, debug, saveShots, shotsDir);

    await callBtn.click({ timeout: 10000, force: true }).catch(async () => {
      await callBtn.evaluate((el) => el.click()).catch(() => {});
    });

    await sleep(AFTER_CLICK_CALL_MS);
    await maybeShot(page, saveShots, shotsDir, "04_after_call_click");

    // Poll reveal: NETWORK + DOM
    const start = Date.now();
    while (Date.now() - start < WAIT_TEL_MAX_MS) {
      // overlay otra vez? la tumbamos mientras esperamos
      await dismissAdblockOverlay(page, debug, 0, null);

      const netPhone = getNetPhone();
      if (netPhone) {
        debug.method_hit = "network";
        const sellerProfileRel = await safeAttr(page.locator("a[href*='/user/profile/id/']").first(), "href");
        return {
          ok: true,
          stage: 2,
          method: "stage2_network_sniff",
          phone_e164: netPhone,
          wa_link: `https://wa.me/${netPhone.replace("+", "")}`,
          seller_name: (await safeText(page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first())) || null,
          seller_profile_url: sellerProfileRel ? new URL(sellerProfileRel, "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: shotsDir,
        };
      }

      const telHref = await safeAttr(contactBox.locator("a[href^='tel:']").first(), "href");
      const p1 = extractPhoneFromAny(telHref);
      if (p1) {
        debug.method_hit = "tel_href";
        const sellerProfileRel = await safeAttr(page.locator("a[href*='/user/profile/id/']").first(), "href");
        return {
          ok: true,
          stage: 2,
          method: "stage2_call_tel_href",
          phone_e164: p1,
          wa_link: `https://wa.me/${p1.replace("+", "")}`,
          seller_name: (await safeText(page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first())) || null,
          seller_profile_url: sellerProfileRel ? new URL(sellerProfileRel, "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: shotsDir,
        };
      }

      const btnText = await safeText(callBtn);
      const p2 = extractPhoneFromAny(btnText);
      if (p2) {
        debug.method_hit = "btn_text";
        debug.call_btn_text_after = btnText;
        const sellerProfileRel = await safeAttr(page.locator("a[href*='/user/profile/id/']").first(), "href");
        return {
          ok: true,
          stage: 2,
          method: "stage2_call_btn_text",
          phone_e164: p2,
          wa_link: `https://wa.me/${p2.replace("+", "")}`,
          seller_name: (await safeText(page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first())) || null,
          seller_profile_url: sellerProfileRel ? new URL(sellerProfileRel, "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: shotsDir,
        };
      }

      const boxText = await safeText(contactBox);
      const p4 = extractPhoneFromAny(boxText);
      if (p4) {
        debug.method_hit = "box_text";
        const sellerProfileRel = await safeAttr(page.locator("a[href*='/user/profile/id/']").first(), "href");
        return {
          ok: true,
          stage: 2,
          method: "stage2_call_box_text",
          phone_e164: p4,
          wa_link: `https://wa.me/${p4.replace("+", "")}`,
          seller_name: (await safeText(page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first())) || null,
          seller_profile_url: sellerProfileRel ? new URL(sellerProfileRel, "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: shotsDir,
        };
      }

      await sleep(650);
    }

    debug.final_hidden_cc = await ccHidden.inputValue().catch(() => "");
    debug.final_hidden_pn = await pnHidden.inputValue().catch(() => "");
    debug.final_visible_phone = await phoneVisible.inputValue().catch(() => "");
    debug.final_call_btn_text = await safeText(callBtn);

    await maybeShot(page, saveShots, shotsDir, "05_not_revealed");

    return {
      ok: false,
      stage: 2,
      method: "not_revealed",
      phone_e164: null,
      wa_link: "",
      seller_name: (await safeText(page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first())) || null,
      seller_profile_url: (await safeAttr(page.locator("a[href*='/user/profile/id/']").first(), "href"))
        ? new URL(await safeAttr(page.locator("a[href*='/user/profile/id/']").first(), "href"), "https://www.encuentra24.com").toString()
        : null,
      seller_address: null,
      reason: `Click en Llamar, pero no apareció número en ${WAIT_TEL_MAX_MS}ms`,
      debug,
      shots_dir: shotsDir,
    };
  } catch (err) {
    return {
      ok: false,
      stage: 2,
      method: "error",
      phone_e164: null,
      wa_link: "",
      seller_name: null,
      seller_profile_url: null,
      seller_address: null,
      reason: String(err?.message || err),
      debug,
      shots_dir: shotsDir,
    };
  } finally {
    if (!KEEP_OPEN) {
      try { if (context) await context.close(); } catch {}
      // en CDP NO cierres el Chrome real
      try { if (browser && !isCDP) await browser.close(); } catch {}
    }
  }
}
