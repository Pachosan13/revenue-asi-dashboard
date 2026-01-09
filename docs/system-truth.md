# System Truth (SOT)

This document is the source of truth for **what is actually implemented in this repo**.  
If something is not provable from code/config in this repo, it is marked **UNRESOLVED**.

## Execution pipeline (high-level)

- **Orchestration (schedules touch_runs)**: `supabase/functions/touch-orchestrator-v7/index.ts`
- **Cadence runner (schedules touch_runs from touches table)**: `supabase/functions/run-cadence/index.ts`
- **Dispatch engine (claims + invokes dispatch-touch-* functions)**: `supabase/functions/dispatch-engine/index.ts`
- **Dispatchers (provider interactions)**:
  - Voice: `supabase/functions/dispatch-touch-voice-v5/index.ts`
  - SMS: `supabase/functions/dispatch-touch-sms/index.ts`
  - WhatsApp: `supabase/functions/dispatch-touch-whatsapp-v2/index.ts`
  - Email: `supabase/functions/dispatch-touch-email/index.ts` (**disabled when Elastic env missing; see Email section**)

## Known versions (provable)

- **touch-orchestrator-v7**: version string is defined in code. See: `supabase/functions/touch-orchestrator-v7/index.ts` (`const VERSION = "touch-orchestrator-v7_2026-01-08_email_disabled"`).
- **run-cadence**: version string is defined in code. See: `supabase/functions/run-cadence/index.ts` (`const VERSION = "run-cadence-v5_2025-12-13_deadstop"`).

Any claim about **touch-orchestrator-v8/v9** is **UNRESOLVED** unless there is a corresponding function in `supabase/functions/` and it is referenced by code/config in this repo.

## Scheduling / frequency

How often orchestrator / dispatch-engine are executed (cron, pg_cron, external scheduler, etc.) is **UNRESOLVED** in this repo.

Rationale: this repo contains the functions and DB migrations, but there is no authoritative, versioned scheduler config in code that proves “runs every N minutes”.

## Email (fail-closed until Elastic is configured)

Email must not be scheduled or dispatched unless ElasticEmail is configured.

### Elastic env normalization (compat)

Elastic API key is read from either env name (trimmed):

- `ELASTIC_EMAIL_API_KEY`
- `ELASTICEMAIL_API_KEY`

From-address is read from (trimmed):

- `ELASTIC_EMAIL_FROM`

`EMAIL_READY = Boolean(api_key && from)`

### Orchestrator (touch-orchestrator-v7)

- After loading `campaign_steps`, any step with `channel === "email"` is skipped when `EMAIL_READY === false`.
- A single log line is emitted per skipped step:
  - `ORCH_EMAIL_DISABLED_MISSING_ELASTIC_ENV { campaign_id, step }`

See: `supabase/functions/touch-orchestrator-v7/index.ts`

### Cadence runner (run-cadence)

- After building `cadence`, `cadenceFiltered` removes touches with `channel === "email"` when `EMAIL_READY === false`.
- Inserts use `cadenceFiltered`, so no email touch_runs are created.

See: `supabase/functions/run-cadence/index.ts`

### Email dispatcher (dispatch-touch-email)

- Uses the same env fallback.
- If not `EMAIL_READY`, it throws:
  - `missing_elastic_env: set ELASTIC_EMAIL_API_KEY (or ELASTICEMAIL_API_KEY) + ELASTIC_EMAIL_FROM`

See: `supabase/functions/dispatch-touch-email/index.ts`

### Warmup engine

- Uses the same Elastic key fallback so one key works across components.

See: `supabase/functions/warmup-engine/index.ts`

## Runtime truth for campaigns

Campaign runtime status is surfaced via a DB view:

- `public.v_campaign_runtime_status_v1`

Definition is in migrations:

- `supabase/migrations/20260108190000_v_campaign_runtime_status_v1.sql`
- `supabase/migrations/20260108203000_v_campaign_runtime_status_v1_fix.sql`

`last_touch_run_at` is derived from `max(public.touch_runs.created_at)` per (account_id, campaign_id).  
24h counts are derived from `public.touch_runs.created_at` within the last 24 hours.

## Executable Lead Requirements (minimum)

These are the minimum fields required for a lead to be eligible for scheduling/execution.

- **Lead identity**:
  - **Required**: `leads.id`
  - **Required**: `leads.account_id` (must be non-null for scheduling inserts)
- **Lead state gates (current behavior)**:
  - `run-cadence` currently selects leads where:
    - `status = "new"`
    - `phone IS NOT NULL`
    - `account_id IS NOT NULL`
    - `lead_state != "dead"`
  - See: `supabase/functions/run-cadence/index.ts`
- **Channel-specific minimums**:
  - **voice/sms/whatsapp**: must have a valid `leads.phone` (current cadence/orchestrator behavior depends on phone availability elsewhere in the pipeline).
  - **email**: must have a valid email address available to the dispatcher (`lead_enriched.email` is used by `dispatch-touch-email`), but email scheduling is disabled unless `EMAIL_READY`.


