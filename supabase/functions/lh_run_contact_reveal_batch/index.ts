import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

type ReqBody = {
  job_id: string;
  batch_size?: number;
  dry_run?: boolean;
};

function toHex(bytes: ArrayBuffer) {
  const u8 = new Uint8Array(bytes);
  let s = "";
  for (const b of u8) s += b.toString(16).padStart(2, "0");
  return s;
}

async function deterministic(seed: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed));
  return toHex(hash).slice(0, 10);
}

serve(async (req) => {
  try {
    if (req.method !== "POST") return new Response("Use POST", { status: 405 });

    const body = (await req.json().catch(() => ({}))) as ReqBody;
    const job_id = String(body.job_id || "").trim();
    if (!job_id) throw new Error("Missing job_id");

    const batchSize = Math.max(1, Math.min(Number(body.batch_size ?? 25), 200));
    const dryRun = Boolean(body.dry_run ?? true);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")?.trim();
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { global: { fetch } });
    const lh = supabase.schema("lead_hunter");

    // pull tasks
    const { data: tasks, error: tErr } = await lh
      .from("contact_reveal_tasks")
      .select("id, domain, status, attempts")
      .eq("job_id", job_id)
      .eq("status", "queued")
      .limit(batchSize);

    if (tErr) throw tErr;

    if (!tasks?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0, reason: "no queued tasks" }), {
        headers: { "content-type": "application/json" },
      });
    }

    let processed = 0;
    let insertedContacts = 0;

    for (const task of tasks) {
      const domain = String(task.domain);
      const suffix = await deterministic(`${job_id}:${domain}`);

      // mark processing
      await lh.from("contact_reveal_tasks").update({ status: "processing" }).eq("id", task.id);

      try {
        if (dryRun) {
          // generate 2 fake contacts per domain
          const contacts = [
            {
              domain,
              full_name: `Dry Contact ${suffix} A`,
              title: "Owner",
              email: `owner+${suffix}@${domain}`,
              phone: null,
              source: "dry_run",
              confidence: 0.5,
              raw_payload: { __dry_run: true, __domain: domain, __job_id: job_id },
            },
            {
              domain,
              full_name: `Dry Contact ${suffix} B`,
              title: "Manager",
              email: `manager+${suffix}@${domain}`,
              phone: null,
              source: "dry_run",
              confidence: 0.4,
              raw_payload: { __dry_run: true, __domain: domain, __job_id: job_id },
            },
          ];

          const { error: cErr } = await lh.from("contacts_raw").insert(contacts);
          if (cErr) throw cErr;
          insertedContacts += contacts.length;
        } else {
          // real provider later
          throw new Error("provider_not_configured");
        }

        // domain status -> revealed
        await lh.from("domains").update({ status: "revealed" }).eq("domain", domain);

        // task done
        await lh.from("contact_reveal_tasks").update({ status: "done" }).eq("id", task.id);

        processed++;
      } catch (e) {
        const msg = String((e as any)?.message ?? e);
        await lh
          .from("contact_reveal_tasks")
          .update({
            status: "failed",
            attempts: Number(task.attempts ?? 0) + 1,
            last_error: msg,
          })
          .eq("id", task.id);
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, inserted_contacts: insertedContacts, dry_run: dryRun }), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    return new Response(JSONify({ ok: false, error: String((err as any)?.message ?? err) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
});

// tiny helper to avoid TS complaint
function JSONify(x: unknown) {
  return JSON.stringify(x);
}
