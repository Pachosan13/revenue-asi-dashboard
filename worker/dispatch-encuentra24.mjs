// worker/dispatch-encuentra24.mjs
// Crea jobs cada minuto si no hay uno activo reciente

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error("Missing env vars");
}

async function main() {
  // 1) ¿Hay job reciente (últimos 2 min)?
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/jobs?select=id,status,created_at&source=eq.encuentra24&niche=eq.autos&order=created_at.desc&limit=1`,
    {
      headers: {
        apikey: SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Accept-Profile": "lead_hunter",
      },
    }
  );

  if (!res.ok) throw new Error(await res.text());
  const rows = await res.json();

  const last = rows[0];
  if (last) {
    const ageSec =
      (Date.now() - new Date(last.created_at).getTime()) / 1000;

    // Si hay job de < 60s, no creamos otro
    if (ageSec < 60) {
      console.log("Recent job exists, skipping dispatch");
      return;
    }
  }

  // 2) Crear job nuevo
  const create = await fetch(
    `${SUPABASE_URL}/functions/v1/create-job`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_id: "a0e3fc34-0bc4-410f-b363-a25b00fa16b8",
        source: "encuentra24",
        niche: "autos",
        geo: { country: "PA" },
        meta: { cadence: "1min", channel: "encuentra24" },
      }),
    }
  );

  const out = await create.json();
  console.log("JOB CREATED:", out?.job?.id);
}

main().catch((e) => {
  console.error("DISPATCH ERROR:", e.message);
  process.exit(1);
});
