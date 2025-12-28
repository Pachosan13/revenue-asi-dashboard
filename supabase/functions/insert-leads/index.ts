import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  account_id: string;            // REQUIRED (public.leads requires it)
  job_id?: string;               // optional, stored in public.leads.job_id + raw.job_id
  limit?: number;                // default 500
  only_ready?: boolean;          // default true
  source?: string;               // default "lead_hunter"
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function parseGeo(geo: string | null | undefined) {
  // expected like "USA|Miami" or "USA|Miami,Orlando"
  const raw = String(geo ?? "").trim();
  const [countryPart, citiesPart] = raw.includes("|") ? raw.split("|", 2) : [raw, ""];
  const country = (countryPart || "").trim() || null;

  const firstCity = (citiesPart || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)[0] ?? null;

  return { country, city: firstCity };
}

serve(async (req) => {
  try {
    const auth = req.headers.get("authorization");
    if (!auth) return json(401, { ok: false, error: "Missing authorization header" });
    if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

    const URL = Deno.env.get("SUPABASE_URL")?.trim();
    const KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!URL || !KEY) return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;

    const account_id = String(body.account_id || "").trim();
    if (!account_id) return json(400, { ok: false, error: "account_id required" });

    const job_id = body.job_id ? String(body.job_id).trim() : null;
    const limit = Math.max(1, Math.min(Number(body.limit ?? 500), 5000));
    const only_ready = body.only_ready ?? true;
    const source = String(body.source ?? "lead_hunter").trim() || "lead_hunter";

    const supabase = createClient(URL, KEY, {
      global: { fetch },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const lh = supabase.schema("lead_hunter");

    // Pull canonical leads
    let q = lh
      .from("leads_canonical")
      .select("id, place_id, domain, business_name, contact_name, title, email, phone, niche, geo, completeness_score, ready_for_outreach, source, created_at")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (only_ready) q = q.eq("ready_for_outreach", true);

    const { data: canon, error: canonErr } = await q;
    if (canonErr) return json(400, { ok: false, error: canonErr });

    const rows = (canon ?? []).map((c) => {
      const { country, city } = parseGeo(c.geo);

      // stable external_id for upsert
      const external_id = String(c.id);

      const mapsUrl =
        (c.source && typeof c.source === "object" ? (c.source as any).maps_url : null) ?? null;

      return {
        account_id,
        job_id,
        source,
        niche: c.niche ?? null,
        external_id,
        title: c.title ?? null,
        url: mapsUrl,
        price: null,
        city,
        country,
        raw: {
          job_id,
          lead_hunter: {
            lead_id: c.id,
            place_id: c.place_id,
            domain: c.domain,
            business_name: c.business_name,
            contact_name: c.contact_name,
            title: c.title,
            email: c.email,
            phone: c.phone,
            niche: c.niche,
            geo: c.geo,
            completeness_score: c.completeness_score,
            ready_for_outreach: c.ready_for_outreach,
            source: c.source,
            created_at: c.created_at,
          },
        },
      };
    });

    if (!rows.length) {
      return json(200, { ok: true, inserted: 0, scanned: 0, limit, only_ready, source, job_id });
    }

    // Upsert into public.leads
    const { data: up, error: upErr } = await supabase
      .from("leads")
      .upsert(rows, { onConflict: "account_id,source,external_id" })
      .select("id");

    if (upErr) return json(400, { ok: false, error: upErr });

    return json(200, {
      ok: true,
      scanned: rows.length,
      inserted: up?.length ?? 0,
      limit,
      only_ready,
      source,
      job_id,
    });
  } catch (e) {
    return json(500, { ok: false, error: String((e as any)?.message ?? e) });
  }
});
