// worker/dispatch-encuentra24.mjs
// Crea jobs si no hay uno activo reciente (sin inventar columnas)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE ||
  process.env.SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error(
    "Missing env vars: SUPABASE_URL and one of SUPABASE_SERVICE_ROLE_KEY | SUPABASE_SERVICE_ROLE | SERVICE_ROLE_KEY"
  );
}

const ACCOUNT_ID =
  process.env.ACCOUNT_ID || "a0e3fc34-0bc4-410f-b363-a25b00fa16b8";

const LH_HEADERS = {
  apikey: SERVICE_ROLE_KEY,
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  "Content-Type": "application/json",
  "Content-Profile": "lead_hunter",
  "Accept-Profile": "lead_hunter",
};

async function main() {
  // ✅ lead_hunter.jobs columns reales: niche, geo, keywords, status, meta, created_at
  // Buscamos el más reciente queued/running para evitar duplicar jobs.
  const url =
    `${SUPABASE_URL}/rest/v1/jobs` +
    `?select=id,status,created_at,niche,meta` +
    `&niche=eq.autos` +
    `&status=in.(queued,running)` +
    `&order=created_at.desc` +
    `&limit=1`;

  const res = await fetch(url, { headers: LH_HEADERS });
  if (!res.ok) throw new Error(await res.text());

  const rows = await res.json();
  const last = rows[0];

  if (last) {
    const ageSec = (Date.now() - new Date(last.created_at).getTime()) / 1000;
    if (ageSec < 120) { // 2 min window
      console.log("Recent active job exists, skipping dispatch");
      return;
    }
  }

  // Crear job via Edge Function create-job (con service role)
  const create = await fetch(`${SUPABASE_URL}/functions/v1/create-job`, {
    method: "POST",
    headers: {
      apikey: SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account_id: ACCOUNT_ID,
      source: "encuentra24",
      niche: "autos",
      geo: { country: "PA" },
      keywords: ["autos_usados"], // jobs.keywords es NOT NULL
      target_leads: 2000,
      meta: { cadence: "1min", channel: "encuentra24", source: "encuentra24" },
    }),
  });

  if (!create.ok) throw new Error(await create.text());
  const out = await create.json();
  console.log("JOB CREATED:", out?.job?.id || out);
}

main().catch((e) => {
  console.error("DISPATCH ERROR:", e.message);
  process.exit(1);
});
