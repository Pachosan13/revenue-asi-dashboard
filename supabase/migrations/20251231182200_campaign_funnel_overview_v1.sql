-- Campaign funnel overview v1
-- Required by /campaigns UI which queries public.campaign_funnel_overview.

begin;

create or replace view public.campaign_funnel_overview as
select
  c.id as campaign_id,
  c.name as campaign_name,
  count(tr.id)::int as total_touches,
  count(distinct tr.lead_id)::int as leads_touched,
  count(distinct tr.lead_id) filter (where tr.status in ('queued','scheduled','executing','processing'))::int as leads_attempting,
  0::int as leads_engaged,
  0::int as leads_booked,
  0::int as leads_booked_show,
  0::int as leads_booked_no_show,
  0::numeric as reply_rate,
  (count(*) filter (where tr.status='failed')::numeric / nullif(count(*),0)::numeric) as error_rate,
  min(tr.created_at) as first_touch_at,
  max(coalesce(tr.updated_at, tr.created_at)) as last_touch_at
from public.campaigns c
left join public.touch_runs tr on tr.campaign_id = c.id
group by c.id, c.name;

grant select on public.campaign_funnel_overview to anon, authenticated, authenticator;

notify pgrst, 'reload schema';

commit;


