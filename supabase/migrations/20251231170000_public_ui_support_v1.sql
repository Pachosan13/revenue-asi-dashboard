-- Public UI Support v1
-- Creates minimal public tables/views used by the Next UI pages so local dev returns real data (or empty sets)
-- instead of falling back to mocks due to missing relations.

begin;

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- public.leads: expand stub to include fields the UI queries
-- -----------------------------------------------------------------------------
alter table if exists public.leads
  add column if not exists contact_name text,
  add column if not exists company text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists state text,
  add column if not exists status text,
  add column if not exists score numeric,
  add column if not exists lead_state text,
  add column if not exists lead_brain_score numeric,
  add column if not exists lead_brain_bucket text,
  add column if not exists last_touched_at timestamptz,
  add column if not exists last_channel text,
  add column if not exists notes text,
  add column if not exists enriched jsonb not null default '{}'::jsonb;

-- -----------------------------------------------------------------------------
-- public.appointments
-- -----------------------------------------------------------------------------
create table if not exists public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  channel text null,
  location text null,
  meta jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_appointments_lead_id on public.appointments(lead_id);
create index if not exists idx_appointments_scheduled_for on public.appointments(scheduled_for);

-- -----------------------------------------------------------------------------
-- public.lead_events (used by voice-insights page)
-- -----------------------------------------------------------------------------
create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_lead_events_lead_id on public.lead_events(lead_id);
create index if not exists idx_lead_events_type_created on public.lead_events(event_type, created_at desc);

-- -----------------------------------------------------------------------------
-- public.calls + voice_insights_calls_v1 view (used by voice-insights page)
-- -----------------------------------------------------------------------------
create table if not exists public.calls (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid null references public.leads(id) on delete set null,
  to_number text null,
  twilio_call_sid text null,
  outcome text null,
  direction text null,
  meta jsonb not null default '{}'::jsonb,
  started_at timestamptz null,
  ended_at timestamptz null,
  created_at timestamptz not null default now()
);

create index if not exists idx_calls_lead_id on public.calls(lead_id);
create index if not exists idx_calls_created_at on public.calls(created_at desc);

-- Views may already exist in remote environments with different column types.
-- Postgres won't allow CREATE OR REPLACE to change column types, so drop+recreate.
drop view if exists public.voice_insights_calls_v1 cascade;
create or replace view public.voice_insights_calls_v1 as
select
  c.id,
  c.lead_id,
  null::uuid as touch_run_id,
  coalesce(c.outcome, c.direction) as status,
  'twilio'::text as provider,
  c.twilio_call_sid as provider_call_id,
  c.to_number as to_phone,
  c.meta,
  coalesce(c.ended_at, c.started_at, c.created_at) as updated_at
from public.calls c
order by coalesce(c.ended_at, c.started_at, c.created_at) desc;

-- -----------------------------------------------------------------------------
-- Inbox + signals + enrichment/campaign view (used by leads page)
-- -----------------------------------------------------------------------------

-- latest touch run per lead (best-effort)
-- Cloud note: inbox_events may already exist with a different column type (e.g. enum).
-- Postgres won't allow CREATE OR REPLACE to change column types; drop & recreate.
drop view if exists public.inbox_events cascade;
create or replace view public.inbox_events as
with last_tr as (
  select distinct on (tr.lead_id)
    tr.lead_id,
    tr.campaign_id,
    tr.channel as channel_last,
    tr.step as last_step,
    tr.updated_at as last_step_at,
    tr.created_at as created_at
  from public.touch_runs tr
  order by tr.lead_id, tr.updated_at desc nulls last
)
select
  l.id as lead_id,
  coalesce(l.contact_name, l.company, l.email, l.phone, 'Lead') as lead_name,
  l.email as lead_email,
  l.phone as lead_phone,
  -- Cast to text to avoid enum/text COALESCE mismatches across environments.
  coalesce(l.state::text, l.lead_state::text, l.status::text, 'new') as lead_state,
  lt.last_step_at,
  lt.campaign_id,
  c.name as campaign_name,
  lt.channel_last,
  coalesce(lt.created_at, l.created_at) as created_at
from public.leads l
left join last_tr lt on lt.lead_id = l.id
left join public.campaigns c on c.id = lt.campaign_id;

drop view if exists public.multichannel_lead_signals cascade;
create or replace view public.multichannel_lead_signals as
select
  tr.lead_id,
  count(*)::int as attempts_total,
  count(distinct tr.channel)::int as distinct_channels,
  count(*) filter (where tr.status = 'failed')::int as errors_total,
  max(tr.updated_at) as last_touch_at,
  false as email_engaged,
  false as wa_engaged,
  false as sms_engaged,
  false as voice_engaged
from public.touch_runs tr
group by tr.lead_id;

drop view if exists public.v_lead_with_enrichment_and_campaign_v1 cascade;
create or replace view public.v_lead_with_enrichment_and_campaign_v1 as
select
  ie.lead_id as id,
  null::text as industry,
  null::text as sub_industry,
  null::numeric as ai_lead_score,
  null::text as enrichment_status,
  ie.campaign_id,
  ie.campaign_name,
  ie.lead_state,
  ie.last_step_at,
  ie.channel_last
from public.inbox_events ie;

-- -----------------------------------------------------------------------------
-- Dashboard summary views (used by dashboard page)
-- -----------------------------------------------------------------------------
drop view if exists public.lead_state_summary cascade;
create or replace view public.lead_state_summary as
select
  ie.campaign_id,
  ie.campaign_name,
  coalesce(ie.lead_state, 'unknown') as state,
  count(*)::int as total_leads
from public.inbox_events ie
group by ie.campaign_id, ie.campaign_name, coalesce(ie.lead_state, 'unknown');

drop view if exists public.lead_activity_summary cascade;
create or replace view public.lead_activity_summary as
select
  ie.lead_id,
  ie.lead_state as state,
  'encuentra24'::text as source,
  'autos'::text as niche,
  null::text as city,
  'PA'::text as country_code,
  ie.channel_last as last_channel,
  null::text as last_status,
  null::int as last_step,
  ie.last_step_at as last_touch_at
from public.inbox_events ie;

drop view if exists public.v_touch_funnel_by_campaign cascade;
create or replace view public.v_touch_funnel_by_campaign as
select
  tr.campaign_id,
  c.name as campaign_name,
  tr.channel,
  tr.status,
  count(*)::int as touches
from public.touch_runs tr
left join public.campaigns c on c.id = tr.campaign_id
group by tr.campaign_id, c.name, tr.channel, tr.status;

-- -----------------------------------------------------------------------------
-- Permissions (local-friendly)
-- -----------------------------------------------------------------------------
grant usage on schema public to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.leads to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.appointments to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.lead_events to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.calls to anon, authenticated, authenticator;

grant select on public.voice_insights_calls_v1 to anon, authenticated, authenticator;
grant select on public.inbox_events to anon, authenticated, authenticator;
grant select on public.multichannel_lead_signals to anon, authenticated, authenticator;
grant select on public.v_lead_with_enrichment_and_campaign_v1 to anon, authenticated, authenticator;
grant select on public.lead_state_summary to anon, authenticated, authenticator;
grant select on public.lead_activity_summary to anon, authenticated, authenticator;
grant select on public.v_touch_funnel_by_campaign to anon, authenticated, authenticator;

notify pgrst, 'reload schema';

commit;


