// worker/providers/phone-resolver/encuentra24_whatsapp_resolver.mjs
import { chromium } from "playwright";
import fs from "fs";
import path from "path";

globalThis.__enc24_keep = globalThis.__enc24_keep || [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function nowTag() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// ---------- phone normalize ----------
function normalizePA(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (!digits) return null;

  // +507xxxxxxxx
  if (digits.length === 11 && digits.startsWith("507")) return `+${digits}`;
  // 00507xxxxxxxx -> +507xxxxxxxx
  if (digits.length === 13 && digits.startsWith("00507")) return `+${digits.slice(2)}`;
  // local 8 digits
  if (digits.length === 8) return `+507${digits}`;

  // if already has + but got stripped, try rescue
  if (digits.length > 11 && digits.endsWith("507") === false) {
    // not safe, ignore
  }
  return null;
}

function extractPhoneFromAnyText(s) {
  const txt = String(s || "");
  // tel:+507xxxxxxxx
  let m = txt.match(/tel:\+?507\d{8}/i);
  if (m) return normalizePA(m[0]);

  // +507xxxxxxxx
  m = txt.match(/\+507\d{8}/);
  if (m) return normalizePA(m[0]);

  // 507xxxxxxxx
  m = txt.match(/\b507\d{8}\b/);
  if (m) return normalizePA(m[0]);

  // 8 digits starting with 6 (mobile)
  m = txt.match(/\b6\d{7}\b/);
  if (m) return normalizePA(m[0]);

  return null;
}

async function forceSetValue(page, selector, value) {
  return await page.evaluate(
    ({ sel, val }) => {
      const el = document.querySelector(sel);
      if (!el) return { ok: false, why: "not_found" };
      el.value = val;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return { ok: true, value: el.value };
    },
    { sel: selector, val: value }
  );
}

async function getAttr(locator, name) {
  try {
    return await locator.getAttribute(name);
  } catch {
    return null;
  }
}

async function safeInnerText(locator) {
  try {
    return await locator.innerText();
  } catch {
    return "";
  }
}

function isTruthy(v) {
  return v !== null && v !== undefined && v !== "";
}

async function ensureDir(p) {
  await fs.promises.mkdir(p, { recursive: true }).catch(() => {});
}

async function shot(page, dir, name) {
  if (!dir) return null;
  await ensureDir(dir);
  const fp = path.join(dir, `${name}.png`);
  try {
    await page.screenshot({ path: fp, fullPage: false });
    return fp;
  } catch {
    return null;
  }
}

async function waitForCountryReady(page, formRoot, timeoutMs = 8000) {
  // Encuentra24 usa hidden: #cnmessage_phone_countrycode value="00507"
  // y el input visible: input.d3-textfield__phone.init-tel-input
  const cc = formRoot.locator("#cnmessage_phone_countrycode, input[name='cnmessage[phone][countrycode]']").first();
  const vis = formRoot.locator("input.d3-textfield__phone.init-tel-input, input.init-tel-input[type='tel']").first();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ccVal = await cc.inputValue().catch(() => "");
    const visEnabled = await vis.isEnabled().catch(() => false);
    // ready cuando cc ya está seteado a 00507 y el visible está enabled
    if (ccVal && ccVal.includes("00507") && visEnabled) return { ok: true, ccVal };
    await sleep(200);
  }
  return { ok: false };
}

async function typePhoneVisibleThenSync(page, formRoot, phone8, delays, debug) {
  const beforePhoneTypeMs = Number(delays?.beforePhoneTypeMs ?? 650);
  const perKeyDelay = Number(delays?.perKeyDelay ?? 80);

  const visible = formRoot.locator("input.d3-textfield__phone.init-tel-input, input.init-tel-input[type='tel']").first();
  const hiddenPN = formRoot.locator("#cnmessage_phone_phonenumber, input[name='cnmessage[phone][phonenumber]']").first();
  const hiddenCC = formRoot.locator("#cnmessage_phone_countrycode, input[name='cnmessage[phone][countrycode]']").first();

  // 1) esperar widget ready (bandera + 00507)
  await sleep(beforePhoneTypeMs);
  const ready = await waitForCountryReady(page, formRoot, Number(delays?.countryReadyMaxMs ?? 8000));
  debug.phone_country_ready = ready.ok ? "yes" : "no";

  // 2) click + fill visible (limpia y type con delay)
  await visible.scrollIntoViewIfNeeded().catch(() => {});
  await visible.click({ timeout: 4000 }).catch(() => {});
  await visible.fill("").catch(() => {});
  await page.keyboard.type(String(phone8), { delay: perKeyDelay });

  // 3) verificar sync hidden
  const afterTypeWait = Number(delays?.afterPhoneTypeMs ?? 450);
  await sleep(afterTypeWait);

  const hiddenVal1 = await hiddenPN.inputValue().catch(() => "");
  const ccVal1 = await hiddenCC.inputValue().catch(() => "");
  debug.phone_hidden_after_type = hiddenVal1;
  debug.cc_hidden = ccVal1;

  // 4) si no sync, forzar hiddenPN (NO tocar CC si ya existe)
  if (!hiddenVal1 || String(hiddenVal1).replace(/\D/g, "").length < 8) {
    debug.phone_sync = "force_hidden_js";
    await forceSetValue(page, "#cnmessage_phone_phonenumber, input[name='cnmessage[phone][phonenumber]']", String(phone8));
    const ccValNow = await hiddenCC.inputValue().catch(() => "");
    if (!ccValNow) {
      // Solo si viene vacío: 00507
      await forceSetValue(page, "#cnmessage_phone_countrycode, input[name='cnmessage[phone][countrycode]']", "00507");
    }
    await sleep(120);
  } else {
    debug.phone_sync = "typed_ok";
  }

  const hiddenVal2 = await hiddenPN.inputValue().catch(() => "");
  debug.phone_hidden_final = hiddenVal2;

  const ok = String(hiddenVal2 || "").replace(/\D/g, "").length >= 8;
  return { ok };
}

async function clickCallAndRead(page, formRoot, delays, debug) {
  const afterFillMs = Number(delays?.afterFillMs ?? 900);
  const afterClickCallMs = Number(delays?.afterClickCallMs ?? 1000);
  const waitTelMaxMs = Number(delays?.waitTelMaxMs ?? 12000);

  // botones reales en el HTML: .show-phone (div) dentro de span.d3-button...disabled
  const callClickable = formRoot.locator(".show-phone").first();
  const callContainer = formRoot.locator(".d3-property-contact__phone").first();

  await sleep(afterFillMs);

  // Asegurar que ya no esté disabled (la clase .disabled está en el contenedor)
  // Igual clickeamos el .show-phone, pero si está disabled no hará nada.
  const cls = (await getAttr(callContainer, "class")) || "";
  debug.call_container_class = cls;

  await callClickable.scrollIntoViewIfNeeded().catch(() => {});
  await callClickable.click({ timeout: 8000 }).catch((e) => {
    debug.call_click_error = String(e?.message || e);
  });

  await sleep(afterClickCallMs);

  // Polling dentro del formRoot para encontrar tel:
  const start = Date.now();
  while (Date.now() - start < waitTelMaxMs) {
    const telHref = await formRoot.locator("a[href^='tel:']").first().getAttribute("href").catch(() => "");
    const p1 = extractPhoneFromAnyText(telHref);
    if (p1) {
      debug.call_tel_href = telHref;
      return { ok: true, phone: p1, method: "stage2_call_tel_href" };
    }

    // a veces el número aparece como texto dentro del panel
    const boxText = await safeInnerText(formRoot);
    const p2 = extractPhoneFromAnyText(boxText);
    if (p2) {
      debug.call_text_hit = true;
      return { ok: true, phone: p2, method: "stage2_call_text" };
    }

    await sleep(300);
  }

  return { ok: false, reason: `Click en Llamar, pero no apareció número en ${waitTelMaxMs}ms` };
}

function pickSellerName(page) {
  // intenta varios selectores reales
  return page
    .locator(".contact_name, .d3-property-info__vendor a.contact_name, .d3-property-info__vendor h4, .d3-property-info__vendor")
    .first();
}

function pickSellerProfileUrl(page) {
  return page.locator(".d3-property-info__vendor a[href*='/user/profile']").first();
}

export async function resolveEncuentra24PhoneFromListing(url, opts = {}) {
  const headless = opts.headless ?? true;
  const prefer = opts.prefer ?? "call_first";
  const form = opts.form ?? {};
  const delays = opts.delays ?? {};
  const saveShots = Boolean(opts.saveShots);

  const SLOWMO = Number(process.env.PW_SLOWMO || "0");
  const KEEP_OPEN = String(process.env.KEEP_OPEN || "") === "1";
  const channel = process.env.ENC24_CHANNEL === "chrome" ? "chrome" : undefined;

  const shotsDir = saveShots ? (opts.shotsDir || `/tmp/enc24shots_${nowTag()}`) : null;

  let browser, context, page;

  const debug = {
    scoped: true,
    last_open_url: url,
  };

  try {
    browser = await chromium.launch({ headless, channel, slowMo: SLOWMO });
    context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: "es-PA",
    });
    page = await context.newPage();

    if (KEEP_OPEN) globalThis.__enc24_keep.push({ browser, context, page });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    // scope: el form de contacto
    const formRoot = page.locator("form[id^='messageform_'], .d3-property-contact__form").first();
    await formRoot.waitFor({ state: "visible", timeout: 15000 });

    // fill email/name/message
    const emailInput = formRoot.locator("input[name='cnmessage[fromemail]'], input[id='cnmessage_fromemail']").first();
    const nameInput = formRoot.locator("input[name='cnmessage[name]'], input[id='cnmessage_name']").first();
    const msgArea = formRoot.locator("textarea[name='cnmessage[message]'], textarea#cnmessage_message").first();

    await emailInput.fill(form.email || "pacho@pachosanchez.com");
    await nameInput.fill(form.name || "Pacho");
    if (await msgArea.count()) {
      await msgArea.fill(form.message || "Hola, me interesa. ¿Sigue disponible?");
    }

    // phone: CRÍTICO
    const phone8 = form.phone8 || "67777777";
    const phoneRes = await typePhoneVisibleThenSync(page, formRoot, phone8, delays, debug);

    if (!phoneRes.ok) {
      // screenshot para ver si el widget no cargó
      await shot(page, shotsDir, "phone_not_synced");
      return {
        ok: false,
        stage: 2,
        method: "error",
        phone_e164: null,
        wa_link: "",
        seller_name: null,
        seller_profile_url: null,
        seller_address: null,
        reason: "No logré sincronizar el teléfono en el input (visible/hidden).",
        debug,
        shots_dir: shotsDir,
      };
    }

    // Espera adicional antes de click (tu regla)
    await sleep(Number(delays?.afterFillMs ?? 900));

    // CALL FIRST (tu preferencia)
    let out = null;

    if (prefer === "call_first") {
      out = await clickCallAndRead(page, formRoot, delays, debug);
      if (!out.ok && delays?.retryClickCall) {
        // segundo intento
        await sleep(500);
        out = await clickCallAndRead(page, formRoot, { ...delays, afterFillMs: 400 }, debug);
      }
    }

    // si call falló, como fallback intenta WA (pero scoped)
    if (!out || !out.ok) {
      const waBtn = formRoot.locator(".show-whatsapp").first();
      await waBtn.scrollIntoViewIfNeeded().catch(() => {});
      await waBtn.click({ timeout: 8000 }).catch(() => {});
      await sleep(700);

      // intenta capturar url de wa desde popup o desde location new page no siempre
      // aquí solo buscamos dentro del DOM del form
      const html = await formRoot.innerHTML().catch(() => "");
      const waMatch =
        html.match(/https?:\/\/wa\.me\/\d+/i) ||
        html.match(/https?:\/\/api\.whatsapp\.com\/send\/\?phone=\d+/i);

      const waUrl = waMatch ? waMatch[0] : "";
      const p = extractPhoneFromAnyText(waUrl);
      if (p) {
        out = { ok: true, phone: p, method: "stage2_whatsapp_url", wa_link: `https://wa.me/${p.replace("+", "")}` };
        debug.whatsapp_url = out.wa_link;
      }
    }

    // seller
    const sellerName = (await safeInnerText(pickSellerName(page))).trim() || null;
    const sellerProfileHref = await pickSellerProfileUrl(page).getAttribute("href").catch(() => null);
    const sellerProfileUrl = sellerProfileHref
      ? (sellerProfileHref.startsWith("http") ? sellerProfileHref : `https://www.encuentra24.com${sellerProfileHref}`)
      : null;

    if (out && out.ok && out.phone) {
      const phone_e164 = normalizePA(out.phone) || out.phone;
      return {
        ok: true,
        stage: 2,
        method: out.method,
        phone_e164,
        wa_link: out.wa_link || `https://wa.me/${phone_e164.replace("+", "")}`,
        seller_name: sellerName,
        seller_profile_url: sellerProfileUrl,
        seller_address: null,
        reason: "",
        debug,
        shots_dir: shotsDir,
      };
    }

    await shot(page, shotsDir, "not_revealed");
    return {
      ok: false,
      stage: 2,
      method: "not_revealed",
      phone_e164: null,
      wa_link: "",
      seller_name: sellerName,
      seller_profile_url: sellerProfileUrl,
      seller_address: null,
      reason: out?.reason || "No se reveló teléfono (call/wa fallaron).",
      debug,
      shots_dir: shotsDir,
    };
  } catch (e) {
    if (page) await shot(page, shotsDir, "exception");
    return {
      ok: false,
      stage: 2,
      method: "error",
      phone_e164: null,
      wa_link: "",
      seller_name: null,
      seller_profile_url: null,
      seller_address: null,
      reason: String(e?.message || e),
      debug,
      shots_dir: shotsDir,
    };
  } finally {
    if (KEEP_OPEN) {
      // IMPORTANT: no cierres, pero NO rompas: igual devolvemos objeto arriba
      // nada aquí
    } else {
      try {
        await browser?.close();
      } catch {}
    }
  }
}
