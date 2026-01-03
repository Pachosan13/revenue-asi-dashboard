-- Multi-tenant accounts + guards (minimal for local dev)
-- Provides:
-- - public.accounts, public.account_members (required by getAccountContext)
-- - campaign active guard RPCs used by lead-hunter-tick and touch-orchestrator-v7

begin;

create extension if not exists pgcrypto;

-- -----------------------------
-- Accounts
-- -----------------------------
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'Default Account',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.account_members (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner',
  created_at timestamptz not null default now(),
  unique (account_id, user_id)
);

create index if not exists idx_account_members_user_id on public.account_members(user_id);

grant usage on schema public to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.accounts to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.account_members to anon, authenticated, authenticator;

-- -----------------------------
-- Campaign active guards
-- -----------------------------
create or replace function public.is_campaign_active(p_account_id uuid, p_campaign_key text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaigns c
    where c.account_id = p_account_id
      and c.campaign_key = p_campaign_key
      and lower(c.status) = 'active'
  );
$$;

create or replace function public.is_campaign_active_by_id(p_account_id uuid, p_campaign_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.campaigns c
    where c.account_id = p_account_id
      and c.id = p_campaign_id
      and lower(c.status) = 'active'
  );
$$;

grant execute on function public.is_campaign_active(uuid, text) to anon, authenticated, authenticator, service_role;
grant execute on function public.is_campaign_active_by_id(uuid, uuid) to anon, authenticated, authenticator, service_role;

notify pgrst, 'reload schema';

commit;


