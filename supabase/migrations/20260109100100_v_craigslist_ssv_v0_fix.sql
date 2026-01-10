-- Craigslist SSV (Supply Velocity) v0 fix:
-- Use coalesce(first_seen_at, created_at) as the event timestamp when created_at exists.
--
-- created_at exists (repo-truth): supabase/migrations/20251217035000_create_public_leads_stub.sql
-- Timezone mapping per US city is UNRESOLVED in repo; UTC day boundaries are used for determinism.

begin;

create or replace view public.v_craigslist_ssv_v0 as
with base as (
  select
    l.city,
    coalesce(l.first_seen_at, l.created_at) as seen_at
  from public.leads l
  where l.source = 'craigslist'
    and l.country = 'US'
    and l.city is not null
    and length(l.city) > 0
),
by_day as (
  select
    b.city,
    date_trunc('day', b.seen_at) as day_utc,
    count(*)::int as listings
  from base b
  where b.seen_at >= (now() - interval '7 days')
  group by 1,2
),
agg7 as (
  select
    city,
    avg(listings)::numeric(10,2) as avg_last_7_days
  from by_day
  group by 1
),
today as (
  select
    city,
    count(*)::int as listings_today
  from base
  where seen_at >= date_trunc('day', now())
    and seen_at <  date_trunc('day', now()) + interval '1 day'
  group by 1
)
select
  coalesce(t.city, a.city) as city,
  coalesce(t.listings_today, 0) as listings_today,
  coalesce(a.avg_last_7_days, 0)::numeric(10,2) as avg_last_7_days
from agg7 a
full join today t using (city);

commit;


