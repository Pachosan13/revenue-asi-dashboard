import fetch from "node-fetch";

const GHL_WEBHOOK =
  "https://services.leadconnectorhq.com/hooks/MdobjsDECDbuVlc0m99p/webhook-trigger/70d2243c-9152-4afb-a169-25e5a8a22e5a";

function hasTaxiFlag(text) {
  const t = (text || "").toLowerCase();

  // Si explícitamente dice que NO fue taxi -> NO bloquear
  if (/(nunca\s+taxi|no\s+taxi|jam[aá]s\s+taxi|no\s+fue\s+taxi)/i.test(t)) return false;

  // Si menciona taxi/colectivo/uber sin negación -> bloquear
  return /(taxi|colectivo|uber)/i.test(t);
}

function isDealerOrBusiness(text) {
  const t = (text || "").toLowerCase();
  return /(dealer|motors|autos\s|ventas|compra\s?venta|agencia|showroom|financiamiento\s+disponible)/i.test(t);
}

function prequalify(lead) {
  const year = Number(lead.year || 0);
  const text = lead.text || "";

  if (!year || year < 2012) return false;
  if (hasTaxiFlag(text)) return false;
  if (isDealerOrBusiness(text)) return false;

  return true;
}

async function sendToGHL(lead) {
  const payload = {
    source: "facebook_marketplace",
    title: lead.title ?? null,
    year: lead.year ?? null,
    price: lead.price ?? null,
    city: lead.city ?? null,
    url: lead.url ?? null,
    notes: (lead.text || "").slice(0, 500),
    client_phone: "+50766791506",
  };

  const res = await fetch(GHL_WEBHOOK, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const txt = await res.text();
  if (!res.ok) throw new Error(`GHL webhook ${res.status}: ${txt}`);
  return txt;
}

// MOCK (por ahora). Luego lo cambiamos por scraper real con Playwright.
async function fetchMarketplaceLeadsMock() {
  return [
    {
      title: "Toyota Corolla 2018 - dueño directo",
      year: 2018,
      price: 8500,
      city: "Panamá",
      url: "https://www.facebook.com/marketplace/item/1234567890",
      text: "Auto personal, nunca taxi. Papeles al día.",
    },
  ];
}

async function main() {
  const leads = await fetchMarketplaceLeadsMock();

  let sent = 0;
  for (const lead of leads) {
    const ok = prequalify(lead);

    if (!ok) {
      console.log("SKIP:", lead.title, "| reason=prequalify");
      continue;
    }

    const resp = await sendToGHL(lead);
    sent++;
    console.log("SENT:", lead.title, "| ghl=", resp?.slice(0, 80));
  }

  console.log("DONE. sent=", sent);
}

main().catch((e) => {
  console.error("FB WORKER ERROR:", e?.message || e);
  process.exit(1);
});
