# Revenue ASI — Director Engine v1

Revenue ASI is a **Growth Director AI** for SMBs selling to the Hispanic market.

It:

- Defines niche, offer, messaging, and channels.
- Orchestrates outbound campaigns (voice, email, WhatsApp, SMS, voice SDR).
- Enriches leads and prioritizes follow-ups.
- Runs a conversational CRM instead of a field-based CRM.
- Drives appointments and pipeline, not vanity metrics.

> Core target: SMBs in the US who sell to Hispanics and want **10–20 qualified appointments per month** on autopilot, at a price point around **$3k/month**.

---

## 1. ICP (first focus)

### 1.1 Company profile

- SMBs in USA selling to Hispanic markets.
- Headcount: **3–50 employees**.
- Owner still involved in **sales** or revenue decisions.
- Has leads but **no consistent outbound system**.

### 1.2 Priority verticals (v1)

- **Auto dealers**
- **Dentists / clinics**
- **Financial loan providers**
- **Agencies that sell to Hispanics**

These are “pattern-matching” ICPs: high ticket, recurring need for leads, pain around follow-up, and chaos in CRM.

---

## 2. Mental architecture of the system

Think of Revenue ASI as a **stacked brain**:

1. **Input layer**

   - Lead lists (CSV, Google Sheet, CRM import).
   - Campaign parameters: niche, offer, geography, target #appointments/month.
   - Client preferences: schedules, tone, allowed channels, compliance constraints.

2. **Director Engine (strategic brain)**

   - Chooses:
     - Niche + core promise.
     - Primary channel (voice / WhatsApp / email).
     - Cadence (sequence of touches).
   - Generates:
     - Voice scripts.
     - Email sequences.
     - WhatsApp/SMS scripts.
   - Prioritizes:
     - Which leads to attack first (fit, recency, behavior).
   - Adapts:
     - More calls, fewer emails, different copy, intensifies or slows down cadences.

3. **Execution layer**

   - Runs the actual touches:
     - Voice SDR (Twilio / voice agent).
     - Email (Elastic / similar).
     - WhatsApp / SMS.
   - Schedules and dispatches:
     - cadences,
     - retries,
     - fallbacks when one channel fails.
   - Updates the **lead state machine** based on outcomes.

4. **Memory & analytics layer**

   - Central log of:
     - Leads
     - Touches
     - Appointments
     - Outcomes
     - Campaign runs
   - Powers:
     - Lead timelines.
     - Operator dashboard.
     - Director dashboard (system health, queues, failures).
   - Feeds back into the Director Engine for strategy adjustments.

5. **Experience layer (UI)**

   - **Operator cockpit**:
     - Leads, inbox, timelines, appointments, tasks.
   - **Director dashboard**:
     - Engine health, queues, errors, campaign performance.
   - **Client portal (light)**:
     - New leads, booked appointments, core KPIs.

---

## 3. Core modules (logical, not just code)

### 3.1 Lead State Machine

A deterministic state machine that tracks where each lead is in the lifecycle.

Typical states:

- `new`
- `enriched`
- `attempting` (in cadence)
- `engaged` (responded)
- `appointment_scheduled`
- `appointment_completed`
- `unqualified`
- `do_not_contact`

The state:

- Is updated by triggers (touch results, appointments, outcomes).
- Drives which cadences are allowed.
- Prevents double-touching, loops and spam.

### 3.2 Touch Orchestrator

Responsible for **what happens next** for each lead.

- Inputs:
  - lead_id
  - campaign_id
  - cadence definition (steps, channels, timing)
- Writes into `touch_runs`:
  - `lead_id`
  - `channel`
  - `step`
  - `status`
  - `scheduled_at`
  - `payload` (context)

It:

- Orchestrates multichannel (voice, email, WhatsApp/SMS).
- Applies fallbacks:
  - if voice fails → email
  - if email bounces → SMS
- Respects throttling and per-client rules.

### 3.3 Appointments Engine & Reminders

Manages bookings, reminders and outcomes.

- `appointments` table:
  - `id`
  - `lead_id`
  - `channel`
  - `status` (scheduled, completed, no_show, cancelled)
  - `outcome` (show, no_show, rescheduled, unqualified, cancelled)
  - `scheduled_for` / `starts_at`

- `appointments_notifications`:
  - 24h, 1h and 10m reminders.
  - Each reminder becomes a `touch_runs` record (`step` 200/201/202 with payload).

- Triggers:
  - `schedule_appointment_notifications(id)` after insert.
  - `handle_appointment_outcome` → writes follow-up `touch_runs` (e.g. no-show follow-up).

### 3.4 Director Engine (AGI-like layer, v1)

This is the “AGI Director” you want:

- Has access to:
  - ICP definition.
  - Lead data.
  - Campaigns & performance.
  - Appointments & show/no-show data.
- Can:
  - Propose new cadences.
  - Adjust messaging.
  - Flag broken campaigns.
  - Recommend where to focus (which leads, which market, which offer).

Implementation wise:

- Director prompts stored in the repo.
- Runs on OpenAI API when connected.
- Writes back decisions as:
  - `programs` / `playbooks`
  - `campaigns`
  - `director_events` / `core_memory_events`.

---

## 4. Data contracts

### 4.1 `lead_enriched` view (contract)

`lead_enriched` is a SQL view that enriches leads with last touch and campaign metadata using **existing** tables:

- `leads`
- `touch_runs`
- `campaigns`

Exposed columns:

- `id` — Lead ID.
- `full_name` — Computed from `name`, `contact_name` or `company_name`.
- `email`
- `phone`
- `state` — current lead state.
- `last_touch_at` — timestamp of last relevant touch.
- `campaign_id`
- `campaign_name`
- `channel_last` — last touch channel.

Leads Inbox / Leads Page expectations:

- Read from: `supabase.from("lead_enriched").select("*")`.
- Display `state` as status (with filters).
- Display `last_touch_at`, `campaign_name`, `channel_last` as context.
- If the view fails, UI can fall back to mocks and show an error banner.

### 4.2 `touch_runs`

Execution log for the orchestrator.

Key fields:

- `id`
- `lead_id`
- `campaign_id`
- `channel` (email, voice, whatsapp, sms)
- `step` (integer, cadence step id)
- `status` (queued, sent, failed, cancelled)
- `scheduled_at`
- `sent_at`
- `payload` (jsonb: message, template, reason, kind)
- `error`

This feeds:

- Lead timeline.
- Director dashboard (volume / failures).
- Operator cockpit.

---

## 5. Current status (reality check)

### 5.1 Built & working (backend)

- Lead state machine with triggers.
- Touch orchestrator v4 (multi-channel, queued, using `touch_runs`).
- Appointments engine + outcomes + reminders → reminders become `touch_runs`.
- Cron-based dispatch for:
  - campaign engine.
  - enrichment.
  - cadence / dispatch-touch.
  - appointment notifications.
- Views:
  - `lead_enriched`
  - `voice_insights_calls_v1`
- Edge functions:
  - campaign engine
  - run-enrichment
  - touch orchestrator
  - dispatch appointment notifications.

### 5.2 Built & working (UI)

- Leads / Leads Inbox pages using `lead_enriched`.
- Lead detail with timeline (touch-based, now showing cleaner previews).
- Appointments dashboard:
  - server-rendered bookings
  - inline outcome buttons → `set_appointment_outcome` RPC.
- Voice Insights page using `voice_insights_calls_v1`.
- Director dashboard (PR) exposing:
  - engine schedules.
  - core KPIs (appointments, lead flow).

### 5.3 Not wired yet / next

- Twilio / voice agent (outbound & inbound hooks).
- Elastic / email provider (sends, bounces, opens).
- WhatsApp/SMS provider.
- OpenAI Director fully connected to live data.
- Multi-tenant boundaries (org_id / client_id everywhere).
- Client-facing mini portal.

---

## 6. DEFCON-1 roadmap (build the real thing, not a toy)

This is the **canonical plan** going forward.  

We split the work in **4 blocks** that can be iterated fast:

### Block 1 — Hardening & Observability (where we are now)

Goal: make sure the brain never lies and we always know what’s happening.

- Finalize Director dashboard:
  - engine health (crons, queues, failures)
  - appointments funnel
  - lead state distribution
- Normalize logging:
  - all edge functions log to a central table (`core_memory_events` / similar).
  - tags: engine, campaign_id, lead_id, appointment_id, error_code.
- Stabilize:
  - appointment reminders → `touch_runs` → timelines.
  - outcome follow-ups (210/220 steps).

### Block 2 — Providers & channels (make it talk for real)

Goal: plug in the external world.

- Twilio voice:
  - outbound calls using `touch_runs`.
  - webhooks for call status & recordings.
- SMS / WhatsApp:
  - same model, via provider of choice.
- Email provider:
  - unify send logic behind a single “SendEmail” edge function.
  - track bounces & constraints per client.

### Block 3 — Skin: Operator cockpit & light client portal

Goal: make this **sellable**.

- Operator cockpit:
  - leads, inbox, timelines, appointments, tasks.
  - filters by state, campaign, intent.
- Client mini-portal:
  - new leads
  - booked appointments
  - 3–5 KPIs only
- Director dashboard polished:
  - ready for demos and sales screenshare.

### Block 4 — Multi-tenant + AGI Director v1

Goal: turn this into an actual product, not a lab.

- Add `org_id` / `client_id` everywhere.
- Per-client limits and throttling.
- Simple onboarding & billing hooks (Stripe or similar).
- Director “AGI”:
  - can read metrics and suggest:
    - campaigns to pause.
    - ICPs to double-down on.
    - cadences to tweak.

---

## 7. How this compares to “flow-builder” tools (like n8n)

Revenue ASI is **not** a drag-and-drop flow builder.

It is:

- A **productized** outbound machine:
  - opinionated lead state machine.
  - opinionated touch orchestrator.
  - opinionated appointment engine.
- A **Director AI** that:
  - sees the whole funnel.
  - writes and rewrites the strategy.
- Built to handle:
  - many clients,
  - many campaigns,
  - with logs, retries, and safety.

Flow builders are great for prototyping.  
Revenue ASI is designed for **owning the pipe** end-to-end.

---
