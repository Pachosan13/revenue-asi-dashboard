-- Campaign Core v1 (minimal tables to unblock orchestrator/router)
create extension if not exists pgcrypto;

-- campaigns
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  name text not null,
  campaign_key text not null,
  status text not null default 'draft' check (status in ('active','paused','draft','archived')),
  type text null default 'outbound',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, campaign_key)
);

create index if not exists idx_campaigns_account_status
on public.campaigns (account_id, status);

-- campaign_steps
create table if not exists public.campaign_steps (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  step int not null,
  channel text not null,
  delay_minutes int not null default 0,
  is_active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, step, channel)
);

create index if not exists idx_campaign_steps_campaign
on public.campaign_steps (campaign_id, is_active, step);

-- campaign_leads
create table if not exists public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  status text not null default 'enrolled' check (status in ('enrolled','active','paused','completed','removed')),
  enrolled_at timestamptz not null default now(),
  next_action_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, campaign_id, lead_id)
);

create index if not exists idx_campaign_leads_due
on public.campaign_leads (account_id, status, next_action_at);

-- touch_runs (minimal)
create table if not exists public.touch_runs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  campaign_run_id uuid null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  step int not null,
  channel text not null,
  status text not null default 'queued' check (status in ('queued','scheduled','executing','sent','failed','canceled')),
  scheduled_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  meta jsonb not null default '{}'::jsonb,
  error text null,
  message_class text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lead_id, campaign_id, step, channel)
);

create index if not exists idx_touch_runs_queue
on public.touch_runs (account_id, status, scheduled_at);

-- updated_at triggers if helper exists
do $$
begin
  if exists (select 1 from pg_proc where proname='set_updated_at') then
    drop trigger if exists trg_campaigns_updated_at on public.campaigns;
    create trigger trg_campaigns_updated_at
      before update on public.campaigns
      for each row execute function set_updated_at();

    drop trigger if exists trg_campaign_steps_updated_at on public.campaign_steps;
    create trigger trg_campaign_steps_updated_at
      before update on public.campaign_steps
      for each row execute function set_updated_at();

    drop trigger if exists trg_campaign_leads_updated_at on public.campaign_leads;
    create trigger trg_campaign_leads_updated_at
      before update on public.campaign_leads
      for each row execute function set_updated_at();

    drop trigger if exists trg_touch_runs_updated_at on public.touch_runs;
    create trigger trg_touch_runs_updated_at
      before update on public.touch_runs
      for each row execute function set_updated_at();
  end if;
end $$;

-- PostgREST role (authenticator) needs privileges
grant usage on schema public to authenticator;
grant select, insert, update, delete on table public.campaigns to authenticator;
grant select, insert, update, delete on table public.campaign_steps to authenticator;
grant select, insert, update, delete on table public.campaign_leads to authenticator;
grant select, insert, update, delete on table public.touch_runs to authenticator;

notify pgrst, 'reload schema';
