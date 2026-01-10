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

## Local Dev (Next.js) — OpenAI env + fallbacks

- Command OS uses OpenAI in two places:
  - **Intent parse**: `src/app/backend/src/command-os/client.ts` (`callCommandOs` → OpenAI `chat.completions` when no rule-based match)
  - **Assistant phrasing**: `src/app/api/command-os/route.ts` (`llmAssistantMessage` → OpenAI `chat.completions`)
- Local dev key lookup (trimmed):
  - Prefer `OPENAI_API_KEY`
  - Fallback `OPEN_AI_KEY`
  - Legacy fallback `OPEN_API_KEY` (exists in some supabase env files)
- Local dev env loading note:
  - `next.config.ts` loads `supabase/.env` + `supabase/.env.local` as **non-overriding** supplements (repo-root `.env.local` wins).
- If OpenAI is missing/down:
  - `system.status` and “campañas prendidas/activas ahora” use DB-only rule-based parsing (no OpenAI required).

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

## Programs vs Campaigns (UI semantics)

- **LeadGen Programs**: lead generation sources (scraping + ingestion). Example: Craigslist V0. They are controlled via Command OS start/stop and **do not** live in `public.campaigns`.
- **Outbound Campaigns**: outbound cadences that live in `public.campaigns`. The **only** enable/disable truth is `campaigns.is_active` (UI must not derive from `status`).

UI copy may present both under a single **LeadGen** page, but the internal distinction above remains required for correctness.

## Lead truth surfaces (UI + Command OS)

Leads UI and Command OS must use the same DB truth:

- Inbox aggregation: `public.inbox_events` (view; defined in `supabase/migrations/20251231170000_public_ui_support_v1.sql`)
- Lead enrichment: `public.lead_enriched` (view; defined in `supabase/migrations/20251231182100_lead_enriched_view_v1.sql`)
- Multichannel aggregates: `public.multichannel_lead_signals` (view; defined in `supabase/migrations/20251231170000_public_ui_support_v1.sql`)
- Campaign/enrichment join: `public.v_lead_with_enrichment_and_campaign_v1` (view; defined in `supabase/migrations/20251231170000_public_ui_support_v1.sql`)
- Next-action / priority: `public.lead_next_action_view_v5` (**UNRESOLVED** definition in this repo; the view is referenced by code but no migration defines it here)

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

## Lead sources

### Craigslist (US) V0

- **Collector execution**: local worker (see below). Edge web fetch is not reliable for Craigslist (403/503).
- **Trigger**: Command OS intent `craigslist.cto.start` (rule-based phrase: “prende craigslist …”). See:
  - `src/app/backend/src/command-os/client.ts`
  - `src/app/backend/src/command-os/router.ts`
- **Queue**: `lead_hunter.craigslist_tasks_v1` (discover/detail). See: `supabase/migrations/20260109120000_lead_hunter_craigslist_tasks_v1.sql`
- **Worker**: `services/craigslist-hunter/worker.js`
- **Storage**: worker inserts into `public.leads` with:
  - `source = 'craigslist'`
  - `country = 'US'`
  - `external_id = posting_id` (numeric id from URL)
- **Dedupe**:
  - Detail tasks: DB-enforced by unique index on `(account_id, external_id)` (migration adds if missing).
  - Leads: DB-enforced by unique index on `(account_id, source, external_id)` (migration adds if missing).
- **SSV (Supply Velocity)**: `public.v_craigslist_ssv_v0` (UTC day boundaries). Timezone mapping per US city is **UNRESOLVED**.

#### Craigslist V0 verified state (cloud)

Verified against Supabase Cloud (`project_ref=cdrrlkxgurckuyceiguo`) on **2026-01-09**:

- **Latest discover (miami)**:

```sql
select id, status, last_error, created_at
from lead_hunter.craigslist_tasks_v1
where task_type='discover' and city='miami'
order by created_at desc limit 1;
```

Result:
- `id=33e1a53a-f141-4e99-9508-c1ab4abd8c39` `status=done` `last_error=NULL` `created_at=2026-01-09 21:36:43.883651+00`

- **Detail tasks breakdown (miami, last 60m)**:

```sql
select status, task_type, count(*)
from lead_hunter.craigslist_tasks_v1
where city='miami' and created_at > now() - interval '60 minutes'
group by 1,2 order by 1,2;
```

Result:
- `claimed|detail|2`
- `done|detail|32`
- `done|discover|2`
- `failed|detail|16`

- **Leads inserted (miami, last 60m)**:

```sql
select count(*) as leads_last_60m
from public.leads
where source='craigslist' and city='miami'
and created_at > now() - interval '60 minutes';
```

Result:
- `leads_last_60m=35`

#### Ops: enqueue + run worker + verify

- **Enqueue discover (SQL)**:

```sql
select lead_hunter.enqueue_craigslist_discover_v1('<account_id>'::uuid, 'miami') as enqueued_task_id;
```

- **Run worker (cloud/headless)**:
  - Required env:
    - `SUPABASE_URL` (cloud project URL)
    - `SUPABASE_SERVICE_ROLE_KEY`
    - `WORKER_ID` (string identifier used in `claimed_by`)
  - Optional runtime knobs (see `services/craigslist-hunter/worker.js`):
    - `CL_HEADLESS` (default `"0"`)
    - `CL_SLOWMO` (default `"150"`)
    - `CL_HARD_TIMEOUT_MS` (default `"15000"`)
    - `CL_WAIT_SELECTOR_MS` (default `"12000"`)
    - `CL_JITTER_MIN_MS` (default `"2000"`)
    - `CL_JITTER_MAX_MS` (default `"4000"`)
    - `CL_SCREENSHOT_DIR` (default `"/tmp"`)
    - `CL_MAX_DISCOVER` (default `"50"`)
    - `CL_LOG_EVIDENCE` (default `"1"`)

#### Known failure modes (observed) + evidence

- `blocked_403` / `blocked_503`: Craigslist blocks navigation; worker logs `EVIDENCE { screenshot, html }` when `CL_LOG_EVIDENCE=1`.
- `detail_missing_dom`: listing loads but expected DOM is missing; worker logs `EVIDENCE` and fails task.
- `goto_timeout`: worker closes the page, resets, and fails the task to avoid hanging.

#### Guardrails

- No Edge Function scraping: Command OS only enqueues; worker is the only component that fetches Craigslist HTML.
- DB enforces dedupe and worker is idempotent via upserts (tasks and leads).

## Org Settings (UI)

The Settings UI reads/writes `public.org_settings` via Supabase PostgREST.

- UI: `src/app/(app)/settings/page.tsx`
- Storage: `public.org_settings`

## Onboarding v1

Onboarding v1 is implemented as the Settings UI flow that captures:

- Business identity: `business_name` (required by UI)
- Primary contact: `contact_email` (required by UI), plus optional `contact_phone`, `contact_whatsapp`
- Operational context: `vertical` (stored, default `"car_dealer"`, hidden in UI)
- LeadGen Routing: `org_settings.leadgen_routing` (existing)

Onboarding does **not** start any LeadGen program and does **not** configure campaigns.

### LeadGen Routing (MVP)

LeadGen routing is stored as JSON in `org_settings.leadgen_routing`:

```json
{
  "dealer_address": "string",
  "radius_miles": 10,
  "city_fallback": "miami",
  "active": true
}
```

Server-side validation exists as a DB CHECK constraint (radius 1–50; if `active=true`, `dealer_address` is required).

## Changelog

- Added Craigslist (US) V0 collector + SSV view + minimal `public.leads` columns/indexes required for `(account_id, source, external_id)` ingestion. See: `supabase/migrations/20260109090000_public_leads_source_external_id_v1.sql`, `supabase/migrations/20260109090100_v_craigslist_ssv_v0.sql`.
- Updated Craigslist SSV timestamp to use `coalesce(first_seen_at, created_at)` and made `first_seen_at` nullable to avoid “now” contamination on existing rows. See: `supabase/migrations/20260109100000_fix_first_seen_at_safe.sql`, `supabase/migrations/20260109100100_v_craigslist_ssv_v0_fix.sql`.
- Moved Craigslist execution from Edge web fetch to queued tasks + local worker. See: `supabase/migrations/20260109120000_lead_hunter_craigslist_tasks_v1.sql`, `services/craigslist-hunter/worker.js`.
- Verified Craigslist V0 end-to-end on cloud (discover ok, detail tasks created, leads inserted) and documented required env + failure evidence behavior. See: `docs/system-truth.md` (Craigslist V0 verified state).
- Local dev: normalized OpenAI env lookup (`OPENAI_API_KEY` → `OPEN_AI_KEY` → legacy `OPEN_API_KEY`) and added a debug endpoint (`/api/debug/openai-env`) that returns only existence/len/prefix (no secrets).
- Campaigns UI: added a demo “Craigslist Miami” row that reflects `lead_hunter.craigslist_tasks_v1` state and can start/stop via Command OS (`prende/apaga craigslist miami`).
- Settings: added `org_settings.leadgen_routing` (dealer_address + radius_miles + city_fallback + active) and wired Craigslist LeadGen start to require it (or explicit override), with duplicate-run confirmation.
- Onboarding v1: added `business_name`, `contact_email`, `contact_phone`, `contact_whatsapp`, `vertical` to `public.org_settings` and updated the Settings UI to a 3-step onboarding flow (identity + contact + routing).
- Campaigns UI: separated LeadGen Programs from Outbound Campaigns; outbound enable/disable truth is `campaigns.is_active` and UI re-reads after toggles.
- Command OS: `campaign.toggle` now keeps `campaigns.is_active` and `campaigns.status` consistent and returns the re-read row.
- Campaigns: added a safe bulk toggle (`campaign.toggle.bulk`) and UI “Pause all running” action; bulk updates always keep `status` derived from `is_active` (active/paused).
- Command OS (leads): lead listing/inspect/next_action now use `lead_next_action_view_v5` (plus `lead_enriched` + `inbox_events`) and support suppression via `leads.status='suppressed'` (run-cadence selects `status='new'`, so suppression fail-closes scheduling).

### Verification snippets (no secrets)

Campaign consistency (should return 0 rows):

```sql
select id, name, is_active, status
from public.campaigns
where is_active = true and status <> 'active';
```

Bulk pause impact (running count should drop):

```sql
select count(*) as running
from public.campaigns
where is_active = true;
```

Lead next action exists (sample):

```sql
select lead_id, priority_score, recommended_action, effective_channel
from public.lead_next_action_view_v5
order by priority_score desc
limit 10;
```

