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

## Command OS: Programs vs Campaigns

- `campaign.list` lists **only outbound campaigns** from `public.campaigns`.
  - If the user asks about **Craigslist/LeadGen/autopilot**, Command OS should redirect them to `program.list` / `program.status` (Craigslist is not a campaign row).
- `program.list` lists LeadGen programs (e.g. Craigslist, Encuentra24 autopilot if configured).
- `program.status` returns status for a specific program (e.g. Craigslist Miami), including a concrete `next_action`.

### Verification SQL (LeadGen programs)

-- routing active (org_settings is a singleton table in repo-truth)
select leadgen_routing
from public.org_settings
limit 1;

-- tasks last 60m (Craigslist)
select status, task_type, count(*) as n
from lead_hunter.craigslist_tasks_v1
where created_at > now() - interval '60 minutes'
group by 1,2
order by 1,2;

-- leads from craigslist last 60m
select count(*) as leads_last_60m
from public.leads
where source = 'craigslist'
  and created_at > now() - interval '60 minutes';

## Programs UI (clickable, auditable)

Canonical endpoints (Next.js):

- `GET /api/programs/list` — known programs + health summary
- `GET /api/programs/[key]` — program detail:
  - health: routing_active, worker_health (claimed/done last 15m), last_success_at
  - throughput: tasks last 60m by status + top_errors
  - output: leads last 60m/24h (if `public.leads.source` exists; in this repo it does via migrations)
  - events: last 20 task rows (best available evidence; task transitions are not separately logged in repo-truth)

Program ON definition (Craigslist):

- **Disabled**: `routing_active=false` OR (no tasks last 60m)
- **Degraded**: `routing_active=true` AND `failed > 0` AND `done = 0` in last 60m
- **Live**: `routing_active=true` AND `done > 0` in last 60m

Verification SQL (Programs endpoints backing data):

-- tasks last 15m (worker health evidence)
select status, count(*) as n
from lead_hunter.craigslist_tasks_v1
where created_at > now() - interval '15 minutes'
group by 1
order by 1;

-- last success (done)
select created_at
from lead_hunter.craigslist_tasks_v1
where status='done'
order by created_at desc
limit 1;

## Lead truth surfaces (UI + Command OS)

Leads UI and Command OS must use the same DB truth:

- Inbox aggregation: `public.inbox_events` (view; defined in `supabase/migrations/20251231170000_public_ui_support_v1.sql`)
- Lead enrichment: `public.lead_enriched` (view; defined in `supabase/migrations/20251231182100_lead_enriched_view_v1.sql`)
- Multichannel aggregates: `public.multichannel_lead_signals` (view; defined in `supabase/migrations/20251231170000_public_ui_support_v1.sql`)
- Campaign/enrichment join: `public.v_lead_with_enrichment_and_campaign_v1` (view; defined in `supabase/migrations/20251231170000_public_ui_support_v1.sql`)
- Next-action / priority: `public.lead_next_action_view_v5` (versioned; see Canonical Lead Next Action View section)

## Canonical Lead Next Action View

- **View**: `public.lead_next_action_view_v5`
- **Versioned in**: `supabase/migrations/20260110220000_lead_next_action_view_v5.sql`
- **Fields (minimum contract)**:
  - `lead_id`
  - `campaign_id`
  - `lead_state`
  - `priority_score`
  - `next_action`
  - `next_action_at`
- **Compatibility fields (used by existing code paths)**:
  - `recommended_action` (alias of `next_action`)
  - `recommended_delay_minutes`
  - `recommended_channel`
  - `effective_channel`

### Verification SQL (no secrets)

-- view exists
select 1
from information_schema.views
where table_schema='public'
  and table_name='lead_next_action_view_v5';

-- sample
select *
from public.lead_next_action_view_v5
limit 5;

-- campaign mismatches should be 0
select count(*)
from public.campaigns
where (is_active = true and status <> 'active')
   or (is_active = false and status = 'active');

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
- ENC24 → GHL WhatsApp E2E: `worker/run-enc24-ghl-dispatch.mjs` now sends canonical payload fields (`phone_e164`, `contact_name`, `listing_url`, `make`, `model`, `year`, `price`, `city`, `external_id`) and enforces 24h idempotency by `external_id` OR `phone_e164` against `lead_hunter.enc24_ghl_deliveries.status='sent'`.
- GHL WhatsApp webhooks: added Edge Function `ghl-whatsapp-webhook` (`POST /functions/v1/ghl-whatsapp-webhook`) to classify and persist `message_sent|message_failed|inbound_reply` in `public.ghl_whatsapp_events`; inbound replies set `leads.lead_status='REPLIED'`, `leads.followup_free_text_until=now()+24h`, and cancel active `touch_runs`. See `supabase/functions/ghl-whatsapp-webhook/index.ts`, `supabase/migrations/20260228133000_ghl_whatsapp_events_handoff_v1.sql`, `supabase/config.toml`.
- Prequal handoff: added internal Edge Function `mark-prequalified` (`POST /functions/v1/mark-prequalified`) to set `leads.prequal_ok` and, when true, create/send a handoff record for Darmesh assignment in `public.ghl_handoff_events` (optional webhook dispatch). See `supabase/functions/mark-prequalified/index.ts`, `supabase/migrations/20260228133000_ghl_whatsapp_events_handoff_v1.sql`, `docs/ghl-whatsapp-handoff.md`.
- Inbound replies: added Edge Function `ghl-message-webhook` (`POST /functions/v1/ghl-message-webhook`) with optional token verification (`GHL_INBOUND_WEBHOOK_TOKEN` via `x-webhook-token`, Bearer auth, or `?token=`), lead resolution (`lead_id` or `phone/email`), lead update (`leads.lead_status='REPLIED'`, `leads.status='suppressed'`, `leads.lead_state='engaged'`), and cadence stop by canceling `touch_runs` in `queued|scheduled|executing`. See `supabase/functions/ghl-message-webhook/index.ts`, `supabase/migrations/20260228120000_leads_lead_status_replied_v1.sql`, `supabase/config.toml`.
- HQ Dealers Outreach MVP: added DB tables `public.hq_dealer_vdp_links`, `public.hq_dealer_prospects`, and `public.hq_dealer_outreach` (scoped by `account_id`) for dealer VDP ingestion, prospect rollups, and outreach token tracking. See `supabase/migrations/20260222110000_hq_dealers_outreach_mvp.sql`.
- HQ Dealers Outreach MVP: added Edge Function `hq-acq-import-apify` to upsert dealer VDP links and roll up `vdp_count`/`last_scraped_at` into `hq_dealer_prospects`. See `supabase/functions/hq-acq-import-apify/index.ts`, `supabase/config.toml`.
- HQ Dealers Outreach MVP: added authenticated enqueue endpoint `POST /api/hq/acq/enqueue` that selects eligible prospects (`vdp_count>=20`, valid `email`, no previous `sent_at`), upserts `public.leads`, and upserts `public.touch_runs` (`channel=email`) with direct payload fields `subject`, `body_html`, `body_text`, `to_email`. See `src/app/api/hq/acq/enqueue/route.ts`.
- HQ Dealers Outreach MVP: added click tracking endpoint `GET /api/hq/acq/click?token=...` that sets `clicked_at` (once) in `hq_dealer_outreach` and redirects to `CALENDLY_LINK`. See `src/app/api/hq/acq/click/route.ts`.
- Voice: OpenAI audio transcript outputs now flag `has_text` to avoid legacy fallback; fallback now emits the current stage template with normalized source labels (Craigslist/Autos-Panama). See `services/voice-rtp-gateway/server.js`.
- Voice: Autos Panama voice agent now speaks as “Juan Carlos” (persona, not empresa), runs deterministic stages (greet→availability→urgency→zone→time before done), and HOT handoff line passes the number to Juan Carlos (no dealer/compañía mention). See `services/voice-rtp-gateway/server.js`.
- Voice: Telnyx bidirectional streaming now accepts PCMA or PCMU and configures OpenAI Realtime to match (`input_audio_format`/`output_audio_format` set to `g711_alaw` for PCMA or `g711_ulaw` for PCMU). Logs `AUDIO_CODEC_INBOUND_ALAW_CONFIRMED` on first inbound PCMA. See `supabase/functions/dispatch-touch-voice-v5/index.ts`, `services/voice-rtp-gateway/server.js`.
- Voice: OpenAI realtime output audio (events `response.output_audio.delta` and legacy `response.audio.delta`, plus `response.output_audio.done` and `output_audio_buffer.started/stopped`) is now decoded and streamed to Telnyx as 20ms G.711 frames (A-law for PCMA, μ-law for PCMU). Logs `OUTBOUND_AUDIO_ENQUEUE` (bytes/frames/codec) and periodic `TELNYX_MEDIA_SENT` counts. See `services/voice-rtp-gateway/server.js`.
- Voice: Telnyx bot turn close now waits for a Telnyx mark ack or the post-mark timeout before closing; silence-only closure is no longer used for Telnyx paths to keep the WS open until playback is confirmed. See `services/voice-rtp-gateway/server.js`.
- Voice (Telnyx→OpenAI Realtime): server_vad now includes `idle_timeout_ms` (5s) and treats `input_audio_buffer.timeout_triggered` as turn end (logs `TURN_END_TIMEOUT_TRIGGERED` and can auto create a response). Inbound calls auto start Telnyx noise suppression once per call (`TELNYX_NOISE_SUPPRESSION_INBOUND_ENABLED`). Logs added for speech start/stop and timeout. See `services/voice-rtp-gateway/server.js`.
- Voice: Added signed Telnyx webhook backup cleanup at `POST /webhooks/telnyx` (Ed25519 via `TELNYX_PUBLIC_KEY`) that clears timers, stops playback, closes bot turns/OpenAI WS, and removes Telnyx sessions on hangup/stream-stop events. See `services/voice-rtp-gateway/server.js`.
- Voice: Documented post-incident voice turn lifecycle, audio vs logic split, webhook backup cleanup, and gated wartime socket/OpenAI event logs behind optional `VOICE_GATEWAY_DEBUG`. See `services/voice-rtp-gateway/server.js`, `docs/system-truth.md`.
- Voice: Deterministic TTS (greet/templates) now transcodes outbound frames to match the Telnyx negotiated codec (PCMA/PCMU) so streaming_start with PCMA is not mute. See `services/voice-rtp-gateway/server.js`.
- Voice: Removed `output_modalities` from Realtime session/response payloads to avoid `OPENAI_ERR_DETAIL unknown_parameter`, kept session `modalities=["text","audio"]` with Telnyx-matched `input_audio_format`/`output_audio_format` (PCMA→`g711_alaw`, PCMU→`g711_ulaw`), and added explicit logging for `response.output_audio.delta` / `response.audio.delta` alongside existing `OUTBOUND_AUDIO_ENQUEUE`/`TELNYX_MEDIA_SENT`. See `services/voice-rtp-gateway/server.js`.
- Voice: Bot turn close is deterministic: Telnyx paths require `openai_done` plus a Telnyx mark ack or the post-mark timeout (silence-only close is only used for non-Telnyx/test paths; no `response_done_timeout` auto-close). Logs `close_reason` (`telnyx_mark_ack`|`silence_after_audio`|`forced_hangup`). See `services/voice-rtp-gateway/server.js`.
- Voice: Telnyx turns now fail-safe close when outbound audio was enqueued, TTS is idle, and the Telnyx WS is closed/closing (no mark ack needed) to prevent stuck silent turns. See `services/voice-rtp-gateway/server.js`.
- Voice: Added one-time post-turn nudge (“Are you still there?”) after ~10s of silence when awaiting user input, canceled on `speech_started`. Logs `NUDGE_TIMER_ARMED`, `NUDGE_EMITTED`, `NUDGE_CLEARED_BY_SPEECH`. See `services/voice-rtp-gateway/server.js`.
- Voice: Realtime `session.update` now aligns both `input_audio_format` and `output_audio_format` to the Telnyx inbound codec (PCMA→`g711_alaw`, PCMU→`g711_ulaw`), logs `OPENAI_OUTPUT_CODEC_SET` once per call, and only sends outbound audio to Telnyx from `response.audio.delta` (PCM16 is not mixed with G.711). See `services/voice-rtp-gateway/server.js`.
- Voice: OpenAI `response.audio.delta` and `response.output_audio.delta` now share the same handler; G.711 deltas passthrough when codecs already match, otherwise transcode, and log once per session with `OUTBOUND_AUDIO_PATH` (passthrough/format/codec). See `services/voice-rtp-gateway/server.js`.
- Voice: Telnyx client_state is decoded from base64 JSON (preferring `payload.voice.source` → normalized to Craigslist/Encuentra24/Facebook Marketplace/Internet; decode failures log `CLIENT_STATE_DECODE_FAIL`), stage flow is greet→availability→urgency→zone→time→done, and ALL spoken lines go through `speakFinal` (templateEnforce + guardAssistantText runtime allowlist) with `SPEAK_TEXT` logs; off-template is replaced via `LOCKED_SYSTEM` and Telnyx paths never send “Say EXACTLY …” to OpenAI. See `services/voice-rtp-gateway/server.js`.
- Voice: Telnyx dial requests no longer send any `stream_*` fields; streaming now starts on `call.answered` via `voice-webhook` using `/actions/streaming_start` with `stream_track="both_tracks"`, `stream_bidirectional_mode="rtp"`, `stream_bidirectional_codec="PCMA"`, `stream_bidirectional_target_legs="opposite"`, and `client_state` passthrough. Logs added: `TELNYX_CREATE_CALL_REQ` (body keys only) and `TELNYX_STREAMING_START_REQ/RES`. See `supabase/functions/dispatch-touch-voice-v5/index.ts`, `supabase/functions/voice-webhook/index.ts`.
- Voice: Voice RTP gateway is now PCMA-only for Telnyx: OpenAI `session.update` is forced to `g711_alaw`, Telnyx WebSocket start rejects any non-PCMA codec with `TELNYX_CODEC_REJECTED`, deterministic TTS always converts to A-law, and Twilio route guards reject Telnyx paths. See `services/voice-rtp-gateway/server.js`.

## Voice RTP Gateway – Env Vars (Fly)

- `PORT` (Fly) — HTTP/WebSocket listener port.
- `VOICE_GATEWAY_TOKEN` (required) — query param token for `/telnyx?token=...`.
- `VOICE_CARRIER_PRIMARY` (optional; default `"twilio"`) — primary carrier selection.
- `OPENAI_API_KEY` (required) — for Realtime + TTS.
- `OPENAI_TTS_MODEL` (optional; default `"gpt-4o-mini-tts"`) — hard default to avoid TTS 400.
- `OPENAI_TTS_VOICE` (optional; default `"alloy"`).
- `TTS_SPEED` (optional; default `1.2`).
- `OPENAI_TEXT_MODEL` (optional; default `"gpt-4.1-mini"`).
- `OPENAI_REALTIME_MODEL` (optional; default `"gpt-4o-realtime-preview"`).
- `TELNYX_API_KEY` / `Telnyx_Api` (required for Telnyx call control).
- `TELNYX_APP_ID` (required per Telnyx app setup).
- `SUPABASE_VOICE_HANDOFF_URL` / `SUPABASE_VOICE_HANDOFF_TOKEN` (optional; HOT handoff).
- `TELNYX_PUBLIC_KEY` (required for Telnyx webhook signature verification).

### Telnyx webhook cleanup (gateway)
- Endpoint: `POST /webhooks/telnyx` (`services/voice-rtp-gateway/server.js`), verifies `telnyx-signature-ed25519` + `telnyx-timestamp` against `TELNYX_PUBLIC_KEY`; 401 + `WEBHOOK_AUTH_FAIL` on mismatch/missing key.
- Cleanup events: any Telnyx webhook with `hangup` in the event name, `call.end`/`call.ended`, or any event containing `stream.stop`/`streaming.stopped`. Audio end events (`call.speak.ended`, `call.playback.ended`) still mark `audio_done` to close turns.
- Cleanup actions: `clearResponseDoneTimer` → `stopOutboundPlayback` → `closeBotTurn(session, "telnyx_webhook_cleanup")` → close OpenAI WS (if open) → close Telnyx WS (if open) → remove the session from the Telnyx `sessions` map. Idempotent for repeated webhooks.
- Logs: single-line JSON `WEBHOOK_IN`, `WEBHOOK_OK`, `WEBHOOK_NO_SESSION`, `WEBHOOK_CLEANUP`, `WEBHOOK_AUTH_FAIL` with `session_id`, `call_control_id`, `stream_id`, `telnyx_event`.
- Local test (gateway running on `PORT`, throwaway Ed25519 keys):
  ```
  openssl genpkey -algorithm ed25519 -out telnyx.key
  openssl pkey -in telnyx.key -pubout -out telnyx.pub
  export TELNYX_PUBLIC_KEY="$(cat telnyx.pub)"
  BODY='{"data":{"event_type":"call.hangup","payload":{"call_control_id":"ccid-demo","stream_id":"stream-demo"}}}'
  TS=$(date +%s)
  SIG=$(printf "%s|%s" "$TS" "$BODY" | openssl pkeyutl -sign -inkey telnyx.key -rawin | openssl base64 -A)
  curl -i -X POST "http://localhost:${PORT:-8080}/webhooks/telnyx" \
    -H "content-type: application/json" \
    -H "telnyx-timestamp: $TS" \
    -H "telnyx-signature-ed25519: $SIG" \
    -d "$BODY"
  ```
  Expect `200` and logs `WEBHOOK_CLEANUP` (or `WEBHOOK_NO_SESSION` if no active session).
- Fly: set `TELNYX_PUBLIC_KEY` via `fly secrets set TELNYX_PUBLIC_KEY="$(cat telnyx.pub)"` and run the same curl against the Fly hostname (e.g., `https://voice-rtp-gateway.fly.dev/webhooks/telnyx`).

## Post-Incident Notes (Voice)
- Canonical turn close: `tryCloseBotTurnCanon` closes a bot turn only when `audio_done` **and** `openai_done` are true. `audio_done` is set by Telnyx mark ack/timeout, webhook audio end, or hangup/stream-stop cleanup; `openai_done` is set on OpenAI `response.done` (or forced for greet). Event log: `BOT_TURN_CANON_CLOSED`. Path: `services/voice-rtp-gateway/server.js`.
- Audio vs logic separation: audio delivery is tracked via Telnyx marks plus `response_done_timer` (best-effort timeout if no mark); logical completion is tracked via OpenAI response lifecycle. `turnClosed` gates user input only after both sides report done.
- Telnyx webhooks: `POST /webhooks/telnyx` (Ed25519 `TELNYX_PUBLIC_KEY`) is the backup cleanup when WS ordering/delivery is unreliable; it clears timers, stops playback, closes OpenAI/Telnyx WS, and removes the session on hangup/stream-stop/audio-end.
- Required Voice RTP Gateway env: `VOICE_GATEWAY_TOKEN`, `OPENAI_API_KEY`, `TELNYX_API_KEY` (or `Telnyx_Api`), `TELNYX_APP_ID`, `TELNYX_PUBLIC_KEY`; defaults remain for OpenAI model/voice (`OPENAI_TTS_MODEL`, `OPENAI_REALTIME_MODEL`, `OPENAI_TEXT_MODEL`) and `VOICE_CARRIER_PRIMARY` (twilio|telnyx).
- Observability knob: setting `VOICE_GATEWAY_DEBUG=1` (or `VOICE_DEBUG=1`) enables wartime socket-level and OpenAI-event logging; default off to avoid noise.

### Known failure mode (TTS)
- If `OPENAI_TTS_MODEL` is unset, OpenAI `/v1/audio/speech` returns `400` (“you must provide a model parameter”) → `TTS_FAIL` → silence. Fix: set `OPENAI_TTS_MODEL` or rely on default `"gpt-4o-mini-tts"`.

### Voice RTP Gateway – Codec Support
- **Supported**: PCMA (A-law) and PCMU (μ-law). OpenAI Realtime input/output audio formats are set to the matching G.711 flavor per Telnyx `media_format.encoding`.
- **Unsupported**: G729 (hard-fail). Reason: triggers false RMS/barge-in and results in mute audio.
  - Guardrail: if Telnyx start event reports an encoding other than PCMA/PCMU, the gateway logs `ERROR_FATAL_CODEC` and closes the session.
  - Telnyx streaming_start MUST use `/actions/streaming_start` and include `stream_track`. Logs required for debugging: `TELNYX_STREAMING_START_REQ/RES`. Success criteria: gateway `TELNYX_START.media_format.encoding` is `PCMA` or `PCMU`.
  - Webhook logs required: `VOICE_WEBHOOK_HIT`, `VOICE_WEBHOOK_EVENT`, `TELNYX_STREAMING_START_REQ/RES/ERR`, plus `STREAMING_WAIT_STATE` / `STREAMING_START_AFTER_ANSWER` when gating answered events.
  - WS auth: `/telnyx` is trusted carrier ingress and is allowed without token (explicit bypass logged as `AUTH_BYPASS_TELNYX`). All other WS paths keep token requirements.
  - After `input_audio_buffer.commit` with real audio, always issue `response.create`; do not time-gate on `last_transcript_at`.

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
- Command OS: added Autos full-funnel commands:
  - `autos.activate`: turns LeadGen routing ON via `org_settings.leadgen_routing.active=true` (only if routing is already fully configured), enqueues a Craigslist discover task for the city, and enables the autos outbound campaign using **only** `campaign_key` as canonical contract:
    - outbound campaigns must have `campaign_key` starting with `autos_outbound_`
    - if `city` is present: requires an exact match `campaign_key = 'autos_outbound_<city>'`
    - 0 matches → `needs_setup` (no outbound campaign activated)
    - >1 matches → `needs_confirmation` (no outbound campaign activated)
  - `autos.deactivate`: turns LeadGen routing OFF via `org_settings.leadgen_routing.active=false`, stops queued Craigslist tasks for the city, and pauses the autos outbound campaign using the same `campaign_key` rule above.

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

