-- v_campaign_runtime_status: runtime truth for campaign "running" state
-- Legacy view (kept for compatibility with older dependencies).
-- Definition: running = campaigns.status='active'
--             AND has any touch_runs in ('queued','scheduled','executing') within last 24h

create or replace view public.v_campaign_runtime_status as
with tr as (
  select
    account_id,
    campaign_id,

    count(*) filter (
      where status in ('queued','scheduled','executing')
        and created_at >= now() - interval '24 hours'
    ) as active_count_24h,

    count(*) filter (
      where status = 'queued'
        and created_at >= now() - interval '24 hours'
    ) as queued_count_24h,

    count(*) filter (
      where status = 'scheduled'
        and created_at >= now() - interval '24 hours'
    ) as scheduled_count_24h,

    count(*) filter (
      where status = 'executing'
        and created_at >= now() - interval '24 hours'
    ) as executing_count_24h,

    count(*) filter (
      where status = 'sent'
        and created_at >= now() - interval '24 hours'
    ) as sent_count_24h,

    count(*) filter (
      where status = 'failed'
        and created_at >= now() - interval '24 hours'
    ) as failed_count_24h,

    max(created_at) as last_touch_run_at

  from public.touch_runs
  group by 1,2
)
select
  c.account_id,
  c.id as campaign_id,
  c.name,
  c.campaign_key,
  c.status as campaign_status,

  coalesce(tr.active_count_24h, 0) as active_count_24h,
  coalesce(tr.queued_count_24h, 0) as queued_count_24h,
  coalesce(tr.scheduled_count_24h, 0) as scheduled_count_24h,
  coalesce(tr.executing_count_24h, 0) as executing_count_24h,
  coalesce(tr.sent_count_24h, 0) as sent_count_24h,
  coalesce(tr.failed_count_24h, 0) as failed_count_24h,

  tr.last_touch_run_at,

  (
    c.status = 'active'
    and coalesce(tr.active_count_24h, 0) > 0
  ) as is_running

from public.campaigns c
left join tr
  on tr.account_id = c.account_id
 and tr.campaign_id = c.id;

-- v_campaign_runtime_status: runtime truth for campaign "running" state
-- Definition: running = campaigns.status='active'
--             AND has any touch_runs in ('queued','scheduled','executing') within last 24h

create or replace view public.v_campaign_runtime_status as
with tr as (
  select
    account_id,
    campaign_id,

    count(*) filter (
      where status in ('queued','scheduled','executing')
        and created_at >= now() - interval '24 hours'
    ) as active_count_24h,

    count(*) filter (
      where status = 'queued'
        and created_at >= now() - interval '24 hours'
    ) as queued_count_24h,

    count(*) filter (
      where status = 'scheduled'
        and created_at >= now() - interval '24 hours'
    ) as scheduled_count_24h,

    count(*) filter (
      where status = 'executing'
        and created_at >= now() - interval '24 hours'
    ) as executing_count_24h,

    count(*) filter (
      where status = 'sent'
        and created_at >= now() - interval '24 hours'
    ) as sent_count_24h,

    count(*) filter (
      where status = 'failed'
        and created_at >= now() - interval '24 hours'
    ) as failed_count_24h,

    max(created_at) as last_touch_run_at

  from public.touch_runs
  group by 1,2
)
select
  c.account_id,
  c.id as campaign_id,
  c.name,
  c.campaign_key,
  c.status as campaign_status,

  coalesce(tr.active_count_24h, 0) as active_count_24h,
  coalesce(tr.queued_count_24h, 0) as queued_count_24h,
  coalesce(tr.scheduled_count_24h, 0) as scheduled_count_24h,
  coalesce(tr.executing_count_24h, 0) as executing_count_24h,
  coalesce(tr.sent_count_24h, 0) as sent_count_24h,
  coalesce(tr.failed_count_24h, 0) as failed_count_24h,

  tr.last_touch_run_at,

  (
    c.status = 'active'
    and coalesce(tr.active_count_24h, 0) > 0
  ) as is_running

from public.campaigns c
left join tr
  on tr.account_id = c.account_id
 and tr.campaign_id = c.id;


