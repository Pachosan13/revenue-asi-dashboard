-- Fix v_campaign_runtime_status_v1 to reflect runtime truth from touch_runs (last 24h + last_touch_run_at).
-- Keeps columns stable; adjusts derivations to match production runtime behavior:
-- - last_touch_run_at derived from max(public.touch_runs.created_at)
-- - 24h counts derived from public.touch_runs.created_at

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


