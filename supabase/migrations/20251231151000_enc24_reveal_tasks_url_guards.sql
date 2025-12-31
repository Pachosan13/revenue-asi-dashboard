-- Guards to prevent non-listing URLs (e.g. /test/5) from being queued/claimed for Encuentra24 reveal.
-- Also adds a 4-arg claim function variant that the worker prefers (stale + max_attempts).

begin;

-- 1) Helper: validate Encuentra24 listing URL format (keep it strict for reliability)
create or replace function lead_hunter.is_valid_enc24_listing_url(p_url text)
returns boolean
language sql
immutable
as $$
  select
    p_url is not null
    and length(p_url) >= 12
    and lower(p_url) ~ '^https?://(www\.)?encuentra24\.com/'
    and p_url !~* '/test/'
    and p_url ~ '/[0-9]{6,}(\b|$)';
$$;

-- 2) Table-level constraint (NOT VALID so existing bad rows don't break migrations).
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'lead_hunter'
      and t.relname = 'enc24_reveal_tasks'
      and c.conname = 'enc24_reveal_tasks_listing_url_valid_ck'
  ) then
    execute $sql$
      alter table lead_hunter.enc24_reveal_tasks
      add constraint enc24_reveal_tasks_listing_url_valid_ck
      check (lead_hunter.is_valid_enc24_listing_url(listing_url))
      not valid
    $sql$;
  end if;
end$$;

-- 3) Cleanup: mark known-bad queued tasks as failed so they don't pollute the queue.
-- NOTE: does not delete rows (preserves audit).
update lead_hunter.enc24_reveal_tasks
set
  status = 'failed',
  last_error = 'invalid_listing_url_format',
  updated_at = now()
where status = 'queued'
  and not lead_hunter.is_valid_enc24_listing_url(listing_url);

-- 4) Patch existing 2-arg claimer to skip invalid URLs.
create or replace function lead_hunter.claim_enc24_reveal_tasks(p_worker_id text, p_limit integer default 5)
returns setof lead_hunter.enc24_reveal_tasks
language sql
security definer
as $function$
  with picked as (
    select id
    from lead_hunter.enc24_reveal_tasks
    where status = 'queued'
      and lead_hunter.is_valid_enc24_listing_url(listing_url)
    order by priority desc, created_at
    limit greatest(p_limit, 1)
    for update skip locked
  )
  update lead_hunter.enc24_reveal_tasks t
  set status = 'claimed',
      claimed_at = now(),
      claimed_by = p_worker_id,
      attempts = attempts + 1,
      updated_at = now()
  from picked
  where t.id = picked.id
  returning t.*;
$function$;

-- 5) Add 4-arg claimer variant (the worker will use this if present).
-- - Reclaims tasks stuck in 'claimed' older than p_stale_seconds
-- - Enforces max attempts
-- NOTE: Some environments already have a 4-arg function with the same signature but a different
-- return type. Postgres cannot "CREATE OR REPLACE" changing return type, so we DROP that signature first.
drop function if exists lead_hunter.claim_enc24_reveal_tasks(text, integer, integer, integer);
create or replace function lead_hunter.claim_enc24_reveal_tasks(
  p_worker_id text,
  p_limit integer,
  p_stale_seconds integer,
  p_max_attempts integer
)
returns setof lead_hunter.enc24_reveal_tasks
language sql
security definer
as $function$
  with picked as (
    select id
    from lead_hunter.enc24_reveal_tasks
    where
      lead_hunter.is_valid_enc24_listing_url(listing_url)
      and (
        status = 'queued'
        or (
          status = 'claimed'
          and claimed_at is not null
          and claimed_at < now() - make_interval(secs => greatest(coalesce(p_stale_seconds, 600), 30))
        )
      )
      and attempts < greatest(coalesce(p_max_attempts, 6), 1)
    order by priority desc, created_at
    limit greatest(coalesce(p_limit, 5), 1)
    for update skip locked
  )
  update lead_hunter.enc24_reveal_tasks t
  set status = 'claimed',
      claimed_at = now(),
      claimed_by = p_worker_id,
      attempts = attempts + 1,
      updated_at = now()
  from picked
  where t.id = picked.id
  returning t.*;
$function$;

commit;


