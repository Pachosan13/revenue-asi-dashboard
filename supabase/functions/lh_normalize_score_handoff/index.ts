import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  job_id: string;
  limit?: number;             // default 5000
  dry_run?: boolean;          // default true
  require_verified?: boolean; // default false
};

function json(status: number, payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function normEmail(v: any) {
  const s = String(v ?? "").trim().toLowerCase();
  return s.includes("@") ? s : "";
}

function roleWeight(title: string) {
  const t = title.toLowerCase();
  if (t.includes("owner") || t.includes("founder") || t.includes("ceo") || t.includes("president")) return 3;
  if (t.includes("manager") || t.includes("director") || t.includes("gm")) return 2;
  return 1;
}

function computeScore(row: {
  domain?: string | null;
  email?: string | null;
  phone?: string | null;
  contact_name?: string | null;
  title?: string | null;
}) {
  let s = 0;
  if (row.domain) s += 25;
  if (row.email) s += 45;
  if (row.phone) s += 10;
  if (row.contact_name) s += 10;
  if (row.title) s += 10;
  if (s > 100) s = 100;
  return s;
}

async function rpcGetJob(supabase: any, job_id: string) {
  const { data, error } = await supabase.rpc("lh_get_job", { p_job_id: job_id });
  if (error) throw error;
  return data as any;
}

async function rpcPatchJob(supabase: any, job_id: string, patch: { status?: string; meta?: any }) {
  const { data, error } = await supabase.rpc("lh_patch_job", {
    p_job_id: job_id,
    p_status: patch.status ?? null,
    p_meta: patch.meta ?? null,
  });
  if (error) throw error;
  return data as any;
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return json(405, { ok: false, error: "Use POST" });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const job_id = String(body.job_id ?? "").trim();
    if (!job_id) return json(400, { ok: false, error: "Missing job_id" });

    const limit = Math.max(1, Math.min(Number(body.limit ?? 5000), 20000));
    const dryRun = Boolean(body.dry_run ?? true);
    const requireVerified = Boolean(body.require_verified ?? false);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json(500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY" });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch } });
    const lh = supabase.schema("lead_hunter");

    const jobRow = await rpcGetJob(supabase, job_id);
    if (!jobRow) return json(404, { ok: false, error: "Job not found" });

    const meta = (jobRow.meta ?? {}) as any;
    const niche = String(meta.niche ?? jobRow.niche ?? "").trim();
    const geo = String(meta.geo ?? jobRow.geo ?? "").trim();

    const { data: leads, error: leadsErr } = await lh
      .from("leads_canonical")
      .select("id, place_id, domain, business_name, contact_name, title, email, phone, niche, geo, completeness_score, ready_for_outreach, created_at")
      .eq("niche", niche || "roofers")
      .eq("geo", geo || "USA|Miami")
      .limit(limit);

    if (leadsErr) throw leadsErr;

    const leadRows = (leads ?? []).filter((l) => l.place_id);
    if (!leadRows.length) {
      await rpcPatchJob(supabase, job_id, {
        status: "running",
        meta: {
          ...meta,
          progress: {
            ...(meta.progress ?? {}),
            normalize: { scanned: 0, updated: 0, ready: 0, dry_run: dryRun, require_verified: requireVerified },
          },
        },
      });
      return json(200, { ok: true, scanned: 0, updated: 0, ready: 0, dry_run: dryRun });
    }

    const placeIds = Array.from(new Set(leadRows.map((l) => String(l.place_id))));

    const { data: domRows, error: domErr } = await lh
      .from("domains")
      .select("domain, place_id, status, meta")
      .in("place_id", placeIds);

    if (domErr) throw domErr;

    const domainsByPlace = new Map<string, string>();
    for (const r of (domRows ?? [])) {
      const pid = String(r.place_id ?? "");
      const d = String(r.domain ?? "").trim().toLowerCase();
      if (!pid || !d) continue;
      if (!domainsByPlace.has(pid)) domainsByPlace.set(pid, d);
    }

    const allDomains = Array.from(new Set(Array.from(domainsByPlace.values())));

    const contactsByDomain = new Map<string, any[]>();
    if (allDomains.length) {
      const { data: contacts, error: cErr } = await lh
        .from("contacts_raw")
        .select("domain, full_name, title, email, phone, source, confidence, created_at")
        .in("domain", allDomains);

      if (cErr) throw cErr;

      for (const c of (contacts ?? [])) {
        const d = String(c.domain ?? "").trim().toLowerCase();
        if (!d) continue;
        if (!contactsByDomain.has(d)) contactsByDomain.set(d, []);
        contactsByDomain.get(d)!.push(c);
      }
    }

    const emails = new Set<string>();
    for (const arr of contactsByDomain.values()) {
      for (const c of arr) {
        const e = normEmail(c.email);
        if (e) emails.add(e);
      }
    }
    const emailList = Array.from(emails);

    const emailStatus = new Map<string, string>();
    if (emailList.length) {
      const { data: ev, error: evErr } = await lh
        .from("email_verifications")
        .select("email, status")
        .in("email", emailList);

      if (evErr) throw evErr;
      for (const r of (ev ?? [])) emailStatus.set(String(r.email).toLowerCase(), String(r.status));
    }

    function pickBestContact(domain: string) {
      const arr = contactsByDomain.get(domain) ?? [];
      if (!arr.length) return null;

      const scored = arr
        .map((c) => {
          const conf = Number(c.confidence ?? 0);
          const title = String(c.title ?? "");
          const email = normEmail(c.email);
          return {
            c,
            score: (email ? 1000 : 0) + roleWeight(title) * 100 + Math.floor(conf * 100),
          };
        })
        .sort((a, b) => b.score - a.score);

      return scored[0]?.c ?? null;
    }

    let updated = 0;
    let ready = 0;

    for (const l of leadRows) {
      const pid = String(l.place_id);
      const domain = (String(l.domain ?? "").trim().toLowerCase()) || domainsByPlace.get(pid) || null;

      let best = null as any;
      if (domain) best = pickBestContact(domain);

      const email = best ? normEmail(best.email) : normEmail(l.email);
      const phone = String(best?.phone ?? l.phone ?? "").trim() || null;
      const contact_name = String(best?.full_name ?? l.contact_name ?? "").trim() || null;
      const title = String(best?.title ?? l.title ?? "").trim() || null;

      const verified = email ? (emailStatus.get(email) ?? "") : "";
      const okVerified = !requireVerified || verified === "valid" || verified === "verified";

      const score = computeScore({ domain, email: email || null, phone, contact_name, title });
      const isReady = Boolean(email && okVerified);

      const patch: any = {
        domain,
        email: email || null,
        phone,
        contact_name,
        title,
        completeness_score: score,
        ready_for_outreach: isReady,
      };

      const { error: upErr } = await lh.from("leads_canonical").update(patch).eq("id", l.id);
      if (upErr) throw upErr;

      updated++;
      if (isReady) ready++;
    }

    let domainsMarked = 0;
    for (const d of allDomains) {
      const hasContacts = (contactsByDomain.get(d) ?? []).length > 0;
      if (!hasContacts) continue;

      const existingMeta =
        domRows?.find((x: any) => String(x.domain).toLowerCase() === d)?.meta ?? {};

      const { error: dErr } = await lh
        .from("domains")
        .update({
          status: "revealed",
          meta: { ...existingMeta, normalized_at: new Date().toISOString() },
        })
        .eq("domain", d);

      if (dErr) throw dErr;
      domainsMarked++;
    }

    const newMeta = {
      ...meta,
      progress: {
        ...(meta.progress ?? {}),
        normalize: {
          scanned: leadRows.length,
          updated,
          ready,
          domains_marked: domainsMarked,
          dry_run: dryRun,
          require_verified: requireVerified,
          at: new Date().toISOString(),
        },
      },
    };

    await rpcPatchJob(supabase, job_id, { status: "running", meta: newMeta });

    return json(200, {
      ok: true,
      scanned: leadRows.length,
      updated,
      ready,
      domains_marked: domainsMarked,
      niche,
      geo,
      dry_run: dryRun,
      require_verified: requireVerified,
    });
  } catch (err) {
    return json(500, { ok: false, error: String((err as any)?.message ?? err) });
  }
});
