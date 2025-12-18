import { chromium } from "playwright";
import fetch from "node-fetch";
import "dotenv/config";

const MARKETPLACE_URL =
  "https://www.facebook.com/marketplace/panama/search?query=autos";

function extractYear(text) {
  const m = text.match(/20\d{2}/);
  return m ? Number(m[0]) : null;
}

function prequalify(text) {
  if (!text) return false;
  if (/taxi|uber|indrive/i.test(text)) return false;
  if (/dealer|motors|autos|ventas/i.test(text)) return false;
  const year = extractYear(text);
  if (!year || year < 2012) return false;
  return true;
}

async function sendWhatsApp(msg) {
  await fetch(
    `https://graph.facebook.com/v18.0/${process.env.WHATSAPP_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: process.env.CLIENT_PHONE,
        type: "text",
        text: { body: msg }
      })
    }
  );
}

async function alreadySent(external_id) {
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/leads?external_id=eq.${external_id}&source=eq.facebook`,
    {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    }
  );
  const data = await res.json();
  return data.length > 0;
}

async function saveLead(external_id, url, year, text) {
  await fetch(`${process.env.SUPABASE_URL}/rest/v1/leads`, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      source: "facebook",
      external_id,
      url,
      year,
      raw: { text }
    })
  });
}

async function main() {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: "fb-session.json" });
  const page = await context.newPage();

  await page.goto(MARKETPLACE_URL, { waitUntil: "networkidle" });
  await page.waitForTimeout(5000);

  const items = await page.$$('[role="article"]');

  for (const item of items) {
    const text = await item.innerText();
    if (!prequalify(text)) continue;

    const linkEl = await item.$('a[href*="/marketplace/item"]');
    if (!linkEl) continue;

    const href = await linkEl.getAttribute("href");
    const idMatch = href.match(/item\/(\d+)/);
    if (!idMatch) continue;

    const external_id = idMatch[1];
    if (await alreadySent(external_id)) continue;

    const year = extractYear(text);

    const msg = `🚗 NUEVO LEAD FACEBOOK

Año: ${year}
Link:
https://facebook.com${href}

⏱ Publicado hace minutos`;

    await sendWhatsApp(msg);
    await saveLead(external_id, `https://facebook.com${href}`, year, text);
  }

  await context.storageState({ path: "fb-session.json" });
  await browser.close();
}

main();

