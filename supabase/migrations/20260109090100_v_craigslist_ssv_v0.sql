-- Craigslist SSV (Supply Velocity) v0
--
-- listings_today: count of NEW listings (first_seen_at) for today (UTC day) per city.
-- avg_last_7_days: average daily new listings over the last 7 UTC days per city.
--
-- Timezone mapping per US city is UNRESOLVED in repo; we use UTC day boundaries for v0 determinism.

begin;

create or replace view public.v_craigslist_ssv_v0 as
with base as (
  select
    l.city,
    l.first_seen_at
  from public.leads l
  where l.source = 'craigslist'
    and l.country = 'US'
    and l.city is not null
    and length(l.city) > 0
),
by_day as (
  select
    b.city,
    date_trunc('day', b.first_seen_at) as day_utc,
    count(*)::int as listings
  from base b
  where b.first_seen_at >= (now() - interval '7 days')
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
  where first_seen_at >= date_trunc('day', now())
    and first_seen_at <  date_trunc('day', now()) + interval '1 day'
  group by 1
)
select
  coalesce(t.city, a.city) as city,
  coalesce(t.listings_today, 0) as listings_today,
  coalesce(a.avg_last_7_days, 0)::numeric(10,2) as avg_last_7_days
from agg7 a
full join today t using (city);

commit;


