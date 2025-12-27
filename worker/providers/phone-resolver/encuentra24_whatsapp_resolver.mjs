import { chromium } from "playwright";

globalThis.__enc24_keep = globalThis.__enc24_keep || [];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  // captura +507XXXXXXXX, 507XXXXXXXX, 00507XXXXXXXX o XXXXXXXX (8 digitos)
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

export async function resolveEncuentra24PhoneFromListing(url, opts = {}) {
  const headless = opts.headless ?? true;
  const form = opts.form ?? {};
  const delays = opts.delays ?? {};

  const SLOWMO = Number(process.env.PW_SLOWMO || "0");
  const KEEP_OPEN = String(process.env.KEEP_OPEN || "") === "1";
  const channel = process.env.ENC24_CHANNEL === "chrome" ? "chrome" : undefined;

  const debug = { scoped: true, last_open_url: url };

  let browser, context, page;

  try {
    browser = await chromium.launch({ headless, channel, slowMo: SLOWMO });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "es-PA" });
    page = await context.newPage();

    if (KEEP_OPEN) globalThis.__enc24_keep.push({ browser, context, page });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });

    const contactBox = page.locator("form[id^='messageform_'], .d3-property-contact__form").first();
    await contactBox.waitFor({ state: "visible", timeout: 15000 });

    // Fill email + name
    await contactBox.locator("input[name*='email'], input[name*='fromemail']").first()
      .fill(form.email || "pacho@pachosanchez.com");
    await contactBox.locator("input[name*='name']").first()
      .fill(form.name || "Pacho");

    // Phone: wait until country code ready, then type, else force hidden
    const ccHidden = contactBox.locator("input[name='cnmessage[phone][countrycode]'], #cnmessage_phone_countrycode").first();
    const pnHidden = contactBox.locator("input[name='cnmessage[phone][phonenumber]'], #cnmessage_phone_phonenumber").first();
    const phoneVisible = contactBox.locator("input:visible").filter({ has: page.locator("xpath=.") })
      .locator("input[type='tel'], input[placeholder*='Ej'], input[placeholder*='6123'], input[placeholder*='Tel']").first();

    // wait for ccHidden to exist (it can be hidden)
    await ccHidden.waitFor({ state: "attached", timeout: Number(delays.waitPhoneInputMs || 12000) }).catch(() => {});
    debug.phone_country_ready = "yes";

    await sleep(Number(delays.beforePhoneTypeMs || 650));

    // type in visible if possible
    const phone8 = String(form.phone8 || "67777777");
    await phoneVisible.waitFor({ state: "visible", timeout: 8000 });
    await phoneVisible.click();
    await phoneVisible.fill("");
    await page.keyboard.type(phone8, { delay: Number(delays.typingDelayMs || 80) });

    const hiddenAfter = await pnHidden.inputValue().catch(() => "");
    debug.phone_hidden_after_type = hiddenAfter;

    // Ensure hidden has phone + cc = 00507
    if (!hiddenAfter || hiddenAfter.replace(/\D/g, "").length < 8) {
      debug.phone_sync = "force_hidden_js";
      await forceSetValue(page, "input[name='cnmessage[phone][phonenumber]'], #cnmessage_phone_phonenumber", phone8);
    } else {
      debug.phone_sync = "typed_ok";
    }

    // ccHidden expects 00507 in many cases
    const ccVal = await ccHidden.inputValue().catch(() => "");
    if (!ccVal) {
      await forceSetValue(page, "input[name='cnmessage[phone][countrycode]'], #cnmessage_phone_countrycode", "00507");
    }
    debug.cc_hidden = await ccHidden.inputValue().catch(() => ccVal || "00507");
    debug.phone_hidden_final = await pnHidden.inputValue().catch(() => phone8);

    await sleep(Number(delays.afterFillMs || 900));

    // Click "Llamar"
    const callBtn = contactBox.locator(".d3-button.d3-property-contact__phone, button:has-text('Llamar'), a:has-text('Llamar')").first();
    await callBtn.waitFor({ state: "visible", timeout: 10000 });
    debug.call_container_class = await callBtn.getAttribute("class").catch(() => "");

    await callBtn.click();
    await sleep(Number(delays.afterClickCallMs || 1200));

    // Poll reveal inside contactBox
    const timeout = Number(delays.waitTelMaxMs || 15000);
    const start = Date.now();

    while (Date.now() - start < timeout) {
      // 1) tel href
      const telHref = await contactBox.locator("a[href^='tel:']").first().getAttribute("href").catch(() => "");
      const p1 = extractPhoneFromAny(telHref);
      if (p1) {
        debug.call_tel_href = telHref;
        return {
          ok: true,
          stage: 2,
          method: "stage2_call_tel_href",
          phone_e164: p1,
          wa_link: `https://wa.me/${p1.replace("+", "")}`,
          seller_name: (await page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first().innerText().catch(() => ""))?.trim() || null,
          seller_profile_url: (await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href").catch(() => "")) ?
            new URL(await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href"), "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: null
        };
      }

      // 2) text of callBtn
      const btnText = await callBtn.innerText().catch(() => "");
      const p2 = extractPhoneFromAny(btnText);
      if (p2) {
        debug.call_text_phone = btnText;
        return {
          ok: true,
          stage: 2,
          method: "stage2_call_btn_text",
          phone_e164: p2,
          wa_link: `https://wa.me/${p2.replace("+", "")}`,
          seller_name: (await page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first().innerText().catch(() => ""))?.trim() || null,
          seller_profile_url: (await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href").catch(() => "")) ?
            new URL(await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href"), "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: null
        };
      }

      // 3) any data-* attribute near the button
      const dataAttrs = await callBtn.evaluate(el => {
        const out = {};
        for (const k of Object.keys(el.dataset || {})) out[k] = el.dataset[k];
        return out;
      }).catch(() => ({}));
      const p3 = extractPhoneFromAny(JSON.stringify(dataAttrs));
      if (p3) {
        debug.call_data_attrs = dataAttrs;
        return {
          ok: true,
          stage: 2,
          method: "stage2_call_data_attr",
          phone_e164: p3,
          wa_link: `https://wa.me/${p3.replace("+", "")}`,
          seller_name: (await page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first().innerText().catch(() => ""))?.trim() || null,
          seller_profile_url: (await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href").catch(() => "")) ?
            new URL(await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href"), "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: null
        };
      }

      // 4) any phone-looking text inside the contactBox
      const boxText = await contactBox.innerText().catch(() => "");
      const p4 = extractPhoneFromAny(boxText);
      if (p4) {
        debug.call_box_text = boxText.slice(0, 300);
        return {
          ok: true,
          stage: 2,
          method: "stage2_call_box_text",
          phone_e164: p4,
          wa_link: `https://wa.me/${p4.replace("+", "")}`,
          seller_name: (await page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first().innerText().catch(() => ""))?.trim() || null,
          seller_profile_url: (await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href").catch(() => "")) ?
            new URL(await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href"), "https://www.encuentra24.com").toString() : null,
          seller_address: null,
          reason: "",
          debug,
          shots_dir: null
        };
      }

      await sleep(600);
    }

    return {
      ok: false,
      stage: 2,
      method: "not_revealed",
      phone_e164: null,
      wa_link: "",
      seller_name: (await page.locator(".d3-property-contact__name, .contact_name, .vendor-name, h4").first().innerText().catch(() => ""))?.trim() || null,
      seller_profile_url: (await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href").catch(() => "")) ?
        new URL(await page.locator("a[href*='/user/profile/id/']").first().getAttribute("href"), "https://www.encuentra24.com").toString() : null,
      seller_address: null,
      reason: `Click en Llamar, pero no apareció número en ${timeout}ms`,
      debug,
      shots_dir: null
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
      shots_dir: null
    };
  } finally {
    if (!KEEP_OPEN && browser) await browser.close();
  }
}
