-- debug_voice_e2e.sql
--
-- End-to-end deterministic check:
-- 1) Pick an active voice step (campaign_id/account_id/step) from public.campaign_steps
-- 2) Pick a lead with phone from public.lead_enriched for same account
-- 3) Insert a queued voice touch_run
-- 4) Invoke dispatch-engine (HTTP) via pg_net
-- 5) Assert voice_calls row exists and dispatch_events count >= 3
--
-- Requirements:
-- - Run as postgres in Supabase SQL editor (or psql).
-- - pg_net extension enabled.
-- - You must fill in the placeholders below.

-- === CONFIG (FILL THESE) ===
-- Replace with your project ref (e.g. cdrrlkxgurckuyceiguo)
-- Replace with your anon key
-- Replace with your x-revenue-secret (if your gateway requires it; can be empty string if not)
-- NOTE: dispatch-engine currently uses service role internally; this HTTP call only needs to pass function auth.
\set project_ref '__PROJECT_REF__'
\set anon_key '__ANON_KEY__'
\set revenue_secret '__X_REVENUE_SECRET__'

create extension if not exists pg_net;

-- 1) Pick a voice campaign step
with step_pick as (
  select account_id, campaign_id, step, payload
  from public.campaign_steps
  where channel = 'voice'
    and is_active = true
  order by updated_at desc nulls last
  limit 1
),
lead_pick as (
  select le.id as lead_id
  from public.lead_enriched le
  join step_pick s on s.account_id = le.account_id
  where le.phone is not null and length(le.phone) > 0
  order by le.updated_at desc nulls last
  limit 1
),
ins as (
  insert into public.touch_runs (
    id, account_id, campaign_id, campaign_run_id, lead_id,
    step, channel, payload, scheduled_at, status, meta
  )
  select
    gen_random_uuid(),
    s.account_id,
    s.campaign_id,
    gen_random_uuid(),
    l.lead_id,
    s.step,
    'voice',
    coalesce(s.payload, '{}'::jsonb),
    now(),
    'queued',
    '{}'::jsonb
  from step_pick s
  cross join lead_pick l
  returning id as touch_run_id
),
call_engine as (
  select net.http_post(
    url := format('https://%s.supabase.co/functions/v1/dispatch-engine', :'project_ref'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey', :'anon_key',
      'Authorization', format('Bearer %s', :'anon_key'),
      'x-revenue-secret', :'revenue_secret'
    ),
    body := jsonb_build_object('dry_run', true, 'batch', 1, 'concurrency', 1)
  ) as res
  from ins
)
select
  (select touch_run_id from ins) as touch_run_id,
  (select res from call_engine) as dispatch_engine_http;

-- 5) Verify artifacts
-- Replace the placeholder with the touch_run_id from the previous query output.
-- \set touch_run_id '__TOUCH_RUN_ID__'
-- select * from public.voice_calls where touch_run_id = :'touch_run_id';
-- select count(*) as dispatch_events_count from public.dispatch_events where touch_run_id = :'touch_run_id';


