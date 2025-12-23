import * as cheerio from "cheerio";

/* =========================
   ENV
========================= */
const WHATSAPP_TOKEN = Deno.env.get("WHATSAPP_TOKEN")!;
const WHATSAPP_PHONE_ID = Deno.env.get("WHATSAPP_PHONE_ID")!;
const CLIENT_PHONE = Deno.env.get("CLIENT_PHONE")!; // Autos Panamá
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

if (!WHATSAPP_TOKEN || !WHATSAPP_PHONE_ID || !CLIENT_PHONE) {
  throw new Error("Missing WhatsApp env vars");
}
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing Supabase env vars");
}

/* =========================
   CONFIG
========================= */
function buildUrl(page: number) {
  const base = "https://www.encuentra24.com/panama-es/autos-usados";
  return page > 1 ? `${base}.${page}` : base;
}

/* =========================
   PREQUALIFICATION LOGIC
========================= */
function prequalify(lead: {
  year: number | null;
  text: string;
}) {
  if (!lead.year || lead.year < 2012) return false;
  if (/taxi/i.test(lead.text)) return false;
  if (/motors|autos|dealer|ventas|s\.a\.|corp/i.test(lead.text)) return false;
  return true;
}

/* =========================
   DEDUPE
========================= */
async function alreadySent(external_id: string): Promise<boolean> {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?external_id=eq.${external_id}&select=id&limit=1`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      },
    }
  );

  const data = await res.json();
  return Array.isArray(data) && data.length > 0;
}

/* =========================
   SAVE LEAD (MEMORY)
========================= */
async function saveLead(lead: any) {
  await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "encuentra24",
      external_id: lead.external_id,
      url: lead.url,
      year: lead.year,
      raw_text: lead.text,
      sent_at: new Date().toISOString(),
    }),
  });
}

/* =========================
   WHATSAPP SEND
========================= */
async function sendWhatsApp(text: string) {
  await fetch(
    `https://graph.facebook.com/v18.0/${WHATSAPP_PHONE_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: CLIENT_PHONE,
        type: "text",
        text: { body: text },
      }),
    }
  );
}

/* =========================
   EDGE FUNCTION
========================= */
Deno.serve(async () => {
  const page = 1; // siempre lo más nuevo
  const res = await fetch(buildUrl(page), {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120",
    },
  });

  const html = await res.text();
  const $ = cheerio.load(html);

  let sent = 0;

  $(".d3-ad-tile").each(async (_, el) => {
    const link = $(el).find("a.d3-ad-tile__description").attr("href");
    if (!link) return;

    const idMatch = link.match(/\/(\d{6,8})$/);
    if (!idMatch) return;

    const external_id = idMatch[1];
    const text = $(el).text().replace(/\s+/g, " ").trim();
    const yearMatch = text.match(/20\d{2}/);

    const lead = {
      external_id,
      url: `https://www.encuentra24.com${link}`,
      year: yearMatch ? Number(yearMatch[0]) : null,
      text,
    };

    // DEDUPE
    if (await alreadySent(lead.external_id)) return;

    // PREQUALIFY
    if (!prequalify(lead)) return;

    const msg = `🚗 *Lead calificado – Encuentra24*

Año: ${lead.year}
Link:
${lead.url}

⏱ Publicado recientemente
📞 Llamar directo desde el anuncio`;

    await sendWhatsApp(msg);
    await saveLead(lead);
    sent++;
  });

  return new Response(
    JSON.stringify({ ok: true, sent }),
    { headers: { "Content-Type": "application/json" } }
  );
});
