// supabase/functions/enrichment-v2/index.ts
// Worker v2: procesa lead_enrichments_v2.pending y los completa usando OpenAI.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY")!;

const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

type EnrichmentRow = {
  id: string;
  lead_id: string;
  input_snapshot: Record<string, unknown> | null;
};

serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { data: pending, error: pendingError } = await supabaseAdmin
      .from("lead_enrichments_v2")
      .select("id, lead_id, input_snapshot")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5);

    if (pendingError) {
      console.error("Error fetching pending enrichments", pendingError);
      return json({ ok: false, error: pendingError.message }, 500);
    }

    if (!pending || pending.length === 0) {
      return json({ ok: true, processed: 0 }, 200);
    }

    const results: Array<{ id: string; ok: boolean; error?: string }> = [];

    for (const row of pending as EnrichmentRow[]) {
      try {
        const snapshot = row.input_snapshot ?? {};
        const leadContext = buildLeadContext(snapshot);

        const enrichment = await callOpenAIEnrichment(leadContext);

        const updatePayload: Record<string, unknown> = {
          industry: enrichment.industry ?? null,
          sub_industry: enrichment.sub_industry ?? null,
          pain_points: enrichment.pain_points ?? null,
          objections: enrichment.objections ?? null,
          emotional_state: enrichment.emotional_state ?? null,
          urgency_score: enrichment.urgency_score ?? null,
          budget_estimate: enrichment.budget_estimate ?? null,
          decision_authority_score: enrichment.decision_authority_score ?? null,
          conversion_likelihood: enrichment.conversion_likelihood ?? null,
          recommended_channel: enrichment.recommended_channel ?? null,
          recommended_cadence: enrichment.recommended_cadence ?? null,
          recommended_persona: enrichment.recommended_persona ?? null,
          ai_lead_score: enrichment.ai_lead_score ?? null,
          raw_result: enrichment.raw_result ?? null,
          status: "completed",
          error: null,
        };

        const { error: updateError } = await supabaseAdmin
          .from("lead_enrichments_v2")
          .update(updatePayload)
          .eq("id", row.id);

        if (updateError) {
          console.error("Error updating enrichment row", row.id, updateError);
          results.push({ id: row.id, ok: false, error: updateError.message });
        } else {
          results.push({ id: row.id, ok: true });
        }
      } catch (err) {
        console.error("Error processing enrichment row", row.id, err);
        await supabaseAdmin
          .from("lead_enrichments_v2")
          .update({
            status: "failed",
            error: String(err),
          })
          .eq("id", row.id);

        results.push({ id: row.id, ok: false, error: String(err) });
      }
    }

    return json({ ok: true, processed: results }, 200);
  } catch (err) {
    console.error("Unhandled error in enrichment-v2", err);
    return json({ ok: false, error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function buildLeadContext(snapshot: Record<string, unknown>) {
  return {
    lead_id: snapshot["id"] ?? null,
    email: snapshot["email"] ?? null,
    phone: snapshot["phone"] ?? null,
    country: snapshot["country"] ?? null,
    company_name: snapshot["company_name"] ?? snapshot["company"] ?? null,
    contact_name: snapshot["contact_name"] ?? null,
    state: snapshot["state"] ?? null,
    status: snapshot["status"] ?? null,
    source: snapshot["source"] ?? null,
    enriched_v1: snapshot["enriched"] ?? null,
    created_at: snapshot["created_at"] ?? null,
  };
}

async function callOpenAIEnrichment(leadContext: Record<string, unknown>) {
  const system = `
You are the ENRICHMENT ENGINE V2 inside Revenue ASI.

Your role is to transform minimal lead context into a COMPLETE Lead Genome that can be consumed by AI Scoring, Cadence Builder, and Director Engine.

You MUST infer, deduce, approximate and fill the gaps intelligently.
EMPTY responses are NOT allowed.

Return ONLY a valid JSON object with EXACTLY these fields:

{
  "industry": string,
  "sub_industry": string,
  "pain_points": string[],
  "objections": string[],
  "emotional_state": {
    "primary": string,
    "secondary": string[]
  },
  "urgency_score": number,
  "budget_estimate": string,
  "decision_authority_score": number,
  "conversion_likelihood": number,
  "recommended_channel": string,
  "recommended_cadence": {
    "initial_contact_days": number,
    "follow_up_days": number[]
  },
  "recommended_persona": string,
  "ai_lead_score": number
}

RULES:

1. NEVER return null. NEVER return empty arrays.
2. You MUST infer based on:
   - website domain
   - email domain
   - niche
   - company name
   - country
   - enriched_v1 data
   - lead behavior implied by missing or ambiguous data

3. INDUSTRY:
   - Must always exist. If unclear, choose the MOST PROBABLE based on email/company/niche.

4. PAIN POINTS:
   - Minimum 3 real pains.
   - MUST be specific to the inferred industry/sub-industry.

5. OBJECTIONS:
   - Minimum 3 objections.
   - Include at least 1 emotional objection (fear/uncertainty).

6. EMOTIONAL STATE:
   - "primary" = 1 word (anxiety, urgency, curiosity, resistance, overwhelm, etc.)
   - "secondary" = array of 2–4 emotions.

7. SCORES:
   - urgency_score:       0–100
   - decision_authority:  0–100
   - conversion_likelihood:0–100
   - ai_lead_score:       0–100
   → Never output round numbers (avoid 50/70/90). Use realistic fractional precision.

8. RECOMMENDED CHANNEL:
   - If professional service (doctor/dentist/lawyer) → email
   - If home services → sms/whatsapp
   - If high-ticket B2B → email or voice

9. CADENCE:
   - initial_contact_days: 0 or 1
   - follow_up_days: MUST be 3–5 items (e.g. [2,5,9,15])

10. NEVER output prose. ONLY JSON.

You must provide the most useful actionable Lead Genome possible.
`;

  const body = {
    model: "gpt-4.1-mini",
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: JSON.stringify({
          lead_context: leadContext,
        }),
      },
    ],
  };

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI error: ${resp.status} – ${text}`);
  }

  const json = await resp.json();
  const content = json.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("Empty content from OpenAI");
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to parse OpenAI JSON: ${e} – content: ${content}`);
  }

  return {
    ...parsed,
    raw_result: parsed,
  };
}
