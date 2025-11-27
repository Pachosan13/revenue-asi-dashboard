create or replace view lead_enriched as
select
  l.id,
  -- combinamos diferentes columnas reales para obtener un "full_name" seguro
  coalesce(le.name, l.contact_name, l.company_name, 'Sin nombre') as full_name,
  l.email,
  l.phone,
  l.state,

  -- último touch (resuelve con lateral join)
  last_tr.sent_at        as last_touch_at,
  last_tr.channel        as channel_last,
  last_tr.status         as last_touch_status,
  last_tr.campaign_id    as campaign_id,
  c.name                 as campaign_name

from leads l

left join lead_enriched le
  on le.id = l.id

left join lateral (
  select
    tr.campaign_id,
    tr.channel,
    tr.status,
    tr.sent_at,
    tr.scheduled_at,
    tr.created_at
  from touch_runs tr
  where tr.lead_id = l.id
  order by
    tr.sent_at desc nulls last,
    tr.scheduled_at desc nulls last,
    tr.created_at desc
  limit 1
) last_tr on true

left join campaigns c on c.id = last_tr.campaign_id

order by last_tr.sent_at desc nulls last, l.created_at desc;
