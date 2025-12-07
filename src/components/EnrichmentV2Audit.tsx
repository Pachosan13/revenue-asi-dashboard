// Audit and design notes for Enrichment Engine V2 derived from the current repository state.
// This file is informational and unused by the runtime UI.

export const enrichmentV2Audit = {
  phase1Discovery: {
    leadsTable: {
      name: "public.leads",
      evidence: "Referenced in supabase/lead_enriched.sql as the base lead source with columns id, contact_name, company_name, email, phone, state, created_at.",
    },
    memoryTable: {
      name: "public.core_memory_events",
      evidence:
        "Used across supabase/functions/_shared/memory.ts with columns scope, account_id, entity_id, actor, event_type, payload, importance, created_at.",
    },
    enrichmentStructures: {
      viewLeadEnriched:
        "View supabase/lead_enriched.sql joins leads with lead_enriched (table) and latest touch_runs, exposing full_name, contact channels, state, last touch metadata, and campaign info.",
    },
    commandOs: {
      status:
        "No Command OS client/router endpoints found in the current codebase; no files under src/... reference command-os patterns.",
    },
  },
  phase2Design: {
    targetTable: "public.lead_enrichments_v2",
    desiredColumns: [
      "id uuid PK",
      "lead_id uuid FK -> public.leads",
      "industry text",
      "sub_industry text",
      "pain_points jsonb",
      "objections jsonb",
      "emotional_state jsonb",
      "urgency_score numeric(5,2)",
      "budget_estimate text",
      "decision_authority_score numeric(5,2)",
      "conversion_likelihood numeric(5,2)",
      "recommended_channel text",
      "recommended_cadence jsonb",
      "recommended_persona text",
      "status text default 'pending'",
      "mode text default 'auto'",
      "input_snapshot jsonb",
      "raw_result jsonb",
      "ai_lead_score numeric(5,2)",
      "core_memory_event_id uuid",
      "error text",
      "created_at timestamptz default now()",
      "updated_at timestamptz default now()",
    ],
    triggers: {
      updatedAt: "Trigger to update updated_at on row modification.",
      memoryInsert:
        "On status transition to completed without core_memory_event_id, insert into core_memory_events with scope='lead', actor='enrichment_v2', event_type='lead_enriched_v2', and payload carrying enrichment metadata.",
    },
    view: {
      name: "public.v_lead_with_enrichment_v2",
      description:
        "Select leads left join the latest completed lead_enrichments_v2 per lead to expose enrichment fields for dashboards and Director Engine.",
    },
  },
  phase3RpcAndCommandOs: {
    rpc: {
      name: "run_enrichment_v2(p_lead_id uuid, p_mode text default 'auto')",
      behavior:
        "Return last completed enrichment for auto mode; insert pending record with input_snapshot from leads when none or when mode is force.",
    },
    commandOs: {
      intent: "lead.enrich.v2",
      args: "{ lead_id: uuid, mode?: 'auto'|'force' }",
      router: "Should call Supabase RPC run_enrichment_v2 and return standard intent response structure.",
      inspect: "lead.inspect intent should read from v_lead_with_enrichment_v2 once available.",
    },
  },
  phase4Risks: [
    "Current repository lacks Command OS scaffolding; new intent wiring will require creating client/router modules.",
    "Lead schema is only inferred from lead_enriched view; confirm actual columns and constraints in Supabase before migration.",
    "RLS/policies unknown for core_memory_events and leads; trigger inserts may fail without service role privileges.",
  ],
}

export default enrichmentV2Audit
