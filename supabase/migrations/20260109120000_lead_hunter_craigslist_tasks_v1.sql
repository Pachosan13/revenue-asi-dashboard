-- Craigslist local worker queue (v0)
-- Goal: stop scraping from Edge; Command OS enqueues tasks, local worker claims and executes.

begin;

create schema if not exists lead_hunter;

-- Keep grants aligned with existing lead_hunter objects in this repo.
grant usage on schema lead_hunter to anon, authenticated, service_role, authenticator;

create table if not exists lead_hunter.craigslist_tasks_v1 (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  city text not null,
  task_type text not null check (task_type in ('discover','detail')),
  listing_url text null,
  external_id text null,
  status text not null default 'queued' check (status in ('queued','claimed','done','failed')),
  attempts int not null default 0,
  claimed_by text null,
  claimed_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists craigslist_tasks_v1_detail_dedupe_uq
  on lead_hunter.craigslist_tasks_v1(account_id, external_id)
  where task_type = 'detail' and external_id is not null and length(external_id) > 0;

create index if not exists craigslist_tasks_v1_status_created_at_idx
  on lead_hunter.craigslist_tasks_v1(status, created_at);

grant select, insert, update, delete on table lead_hunter.craigslist_tasks_v1 to anon, authenticated, service_role, authenticator;

-- Worker RPCs

create or replace function lead_hunter.enqueue_craigslist_discover_v1(
  p_account_id uuid,
  p_city text
) returns uuid
language plpgsql
security definer
set search_path = lead_hunter, public
as $$
declare
  v_id uuid;
begin
  insert into lead_hunter.craigslist_tasks_v1 (account_id, city, task_type, status)
  values (p_account_id, btrim(p_city), 'discover', 'queued')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function lead_hunter.claim_craigslist_tasks_v1(
  p_worker_id text,
  p_limit int
) returns setof lead_hunter.craigslist_tasks_v1
language plpgsql
security definer
set search_path = lead_hunter, public
as $$
begin
  return query
  with cte as (
    select t.id
    from lead_hunter.craigslist_tasks_v1 t
    where t.status = 'queued'
    order by t.created_at asc
    limit greatest(1, least(coalesce(p_limit, 5), 50))
    for update skip locked
  )
  update lead_hunter.craigslist_tasks_v1 t
  set
    status = 'claimed',
    claimed_by = left(coalesce(p_worker_id, ''), 200),
    claimed_at = now(),
    attempts = t.attempts + 1,
    updated_at = now()
  from cte
  where t.id = cte.id
  returning t.*;
end;
$$;

create or replace function lead_hunter.finish_craigslist_task_v1(
  p_id uuid,
  p_ok boolean,
  p_error text
) returns void
language plpgsql
security definer
set search_path = lead_hunter, public
as $$
begin
  update lead_hunter.craigslist_tasks_v1
  set
    status = case when p_ok then 'done' else 'failed' end,
    last_error = case when p_ok then null else left(coalesce(p_error, ''), 2000) end,
    updated_at = now()
  where id = p_id;
end;
$$;

grant execute on function lead_hunter.enqueue_craigslist_discover_v1(uuid, text) to anon, authenticated, service_role, authenticator;
grant execute on function lead_hunter.claim_craigslist_tasks_v1(text, int) to anon, authenticated, service_role, authenticator;
grant execute on function lead_hunter.finish_craigslist_task_v1(uuid, boolean, text) to anon, authenticated, service_role, authenticator;

commit;


