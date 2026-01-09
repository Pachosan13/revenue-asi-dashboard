-- v_campaign_runtime_status_v1: versioned runtime truth contract for campaigns.
-- NOTE: This view is superseded/adjusted by 20260108203000_v_campaign_runtime_status_v1_fix.sql
-- to ensure last_touch_run_at + 24h counts reflect production touch_runs semantics.

create or replace view public.v_campaign_runtime_status_v1 as
with tr as (
  select
    account_id,
    campaign_id,

    count(*) filter (
      where status in ('queued','scheduled','executing')
        and created_at >= now() - interval '24 hours'
    )::int as active_count_24h,

    count(*) filter (
      where status = 'sent'
        and created_at >= now() - interval '24 hours'
    )::int as sent_count_24h,

    count(*) filter (
      where status = 'failed'
        and created_at >= now() - interval '24 hours'
    )::int as failed_count_24h,

    max(created_at) as last_touch_run_at

  from public.touch_runs
  group by 1,2
)
select
  c.account_id,
  c.id as campaign_id,
  c.name,
  c.campaign_key,
  c.type,
  c.status as campaign_status,

  coalesce(tr.active_count_24h, 0)::int as active_count_24h,
  coalesce(tr.sent_count_24h, 0)::int as sent_count_24h,
  coalesce(tr.failed_count_24h, 0)::int as failed_count_24h,

  tr.last_touch_run_at,

  (
    c.status = 'active'
    and coalesce(tr.active_count_24h, 0) > 0
  ) as is_running

from public.campaigns c
left join tr
  on tr.account_id = c.account_id
 and tr.campaign_id = c.id;

-- Verification:
-- select * from public.v_campaign_runtime_status_v1 where account_id = '<account_id>' order by is_running desc, last_touch_run_at desc;

-- v_campaign_runtime_status_v1: runtime truth for campaign "running" state
-- Definition: is_running = (campaign_status='active' AND active_count_24h > 0)
-- Notes:
-- - active_count_24h counts touch_runs in ('queued','scheduled','executing') within last 24h (based on scheduled_at)
-- - sent/failed counts use coalesce(updated_at, scheduled_at, created_at) within last 24h

create or replace view public.v_campaign_runtime_status_v1 as
with tr as (
  select
    account_id,
    campaign_id,

    count(*) filter (
      where status in ('queued','scheduled','executing')
        and scheduled_at >= now() - interval '24 hours'
    )::int as active_count_24h,

    count(*) filter (
      where status = 'sent'
        and coalesce(updated_at, scheduled_at, created_at) >= now() - interval '24 hours'
    )::int as sent_count_24h,

    count(*) filter (
      where status = 'failed'
        and coalesce(updated_at, scheduled_at, created_at) >= now() - interval '24 hours'
    )::int as failed_count_24h,

    max(coalesce(updated_at, scheduled_at, created_at)) as last_touch_run_at

  from public.touch_runs
  group by 1,2
)
select
  c.account_id,
  c.id as campaign_id,
  c.name,
  c.campaign_key,
  c.type,
  c.status as campaign_status,

  coalesce(tr.active_count_24h, 0)::int as active_count_24h,
  coalesce(tr.sent_count_24h, 0)::int as sent_count_24h,
  coalesce(tr.failed_count_24h, 0)::int as failed_count_24h,

  tr.last_touch_run_at,

  (
    c.status = 'active'
    and coalesce(tr.active_count_24h, 0) > 0
  ) as is_running

from public.campaigns c
left join tr
  on tr.account_id = c.account_id
 and tr.campaign_id = c.id;


