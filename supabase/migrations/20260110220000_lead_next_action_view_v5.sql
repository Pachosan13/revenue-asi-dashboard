-- Canonical Lead Next Action View v5 (versioned)
-- Conservative definition derived only from repo-known objects:
-- - public.inbox_events (view)
-- - public.campaign_leads (table; optional)
--
-- Required columns (used by app code paths):
-- - lead_id
-- - campaign_id
-- - lead_state
-- - priority_score
-- - next_action
-- - next_action_at
--
-- Plus compatibility aliases used by existing code:
-- - recommended_action, recommended_delay_minutes, recommended_channel, effective_channel

begin;

-- Drop+recreate to avoid CREATE OR REPLACE type-change limitations across environments.
drop view if exists public.lead_next_action_view_v5 cascade;

create or replace view public.lead_next_action_view_v5 as
with due as (
  select distinct on (cl.lead_id)
    cl.lead_id,
    cl.campaign_id,
    cl.next_action_at
  from public.campaign_leads cl
  where cl.status in ('enrolled','active')
  order by cl.lead_id, cl.next_action_at asc nulls last
)
select
  ie.lead_id,
  coalesce(ie.campaign_id, d.campaign_id) as campaign_id,
  ie.lead_state,

  -- Conservative score: state weight + recency buckets (0..100).
  (
    case lower(coalesce(ie.lead_state, 'new'))
      when 'new' then 50
      when 'enriched' then 45
      when 'attempting' then 40
      when 'engaged' then 30
      when 'qualified' then 20
      when 'booked' then 10
      when 'dead' then 0
      when 'suppressed' then 0
      else 25
    end
    +
    case
      when coalesce(ie.last_step_at, ie.created_at) is null then 10
      when coalesce(ie.last_step_at, ie.created_at) > now() - interval '6 hours' then 20
      when coalesce(ie.last_step_at, ie.created_at) > now() - interval '24 hours' then 15
      when coalesce(ie.last_step_at, ie.created_at) > now() - interval '7 days' then 8
      else 0
    end
  )::numeric as priority_score,

  -- Default action is intentionally conservative.
  case
    when lower(coalesce(ie.lead_state, '')) = 'dead' then 'none'
    when lower(coalesce(ie.lead_state, '')) = 'suppressed' then 'suppressed'
    else 'review'
  end::text as next_action,

  coalesce(d.next_action_at, ie.last_step_at, ie.created_at, now()) as next_action_at,

  -- Compatibility aliases used by app code
  case
    when lower(coalesce(ie.lead_state, '')) = 'dead' then 'none'
    when lower(coalesce(ie.lead_state, '')) = 'suppressed' then 'suppressed'
    else 'review'
  end::text as recommended_action,

  greatest(
    0,
    floor(
      extract(epoch from (coalesce(d.next_action_at, ie.last_step_at, ie.created_at, now()) - now())) / 60
    )::int
  ) as recommended_delay_minutes,

  coalesce(ie.channel_last, 'sms')::text as recommended_channel,
  coalesce(ie.channel_last, 'sms')::text as effective_channel

from public.inbox_events ie
left join due d on d.lead_id = ie.lead_id;

grant select on public.lead_next_action_view_v5 to anon, authenticated, authenticator;
notify pgrst, 'reload schema';

-- Repair: keep campaigns.status derived from campaigns.is_active (idempotent).
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'campaigns'
      and column_name = 'is_active'
  ) then
    update public.campaigns
    set status = case when is_active then 'active' else 'paused' end
    where (is_active = true and status <> 'active')
       or (is_active = false and status = 'active');
  end if;
end $$;

commit;


