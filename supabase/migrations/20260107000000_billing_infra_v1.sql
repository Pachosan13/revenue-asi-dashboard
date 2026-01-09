-- Billing infra v1 (multi-tenant, usage-based, auditable, idempotent)
-- Source of truth: public.usage_ledger (immutable, provider-accepted only)

-- 1) Immutable usage ledger
create table if not exists public.usage_ledger (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  lead_id uuid null,
  channel text not null check (channel in ('sms','voice','email','whatsapp')),
  provider text not null check (provider in ('telnyx','elastic','whatsapp_provider')),
  source text not null default 'unknown',
  ref_id text not null,
  units integer not null check (units > 0),
  unit_cost_cents integer not null check (unit_cost_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  occurred_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create unique index if not exists usage_ledger_unique_ref
  on public.usage_ledger (account_id, channel, provider, ref_id);

create index if not exists usage_ledger_account_occurred_at_desc
  on public.usage_ledger (account_id, occurred_at desc);

-- 2) Billing plans (pricing config, payment-provider agnostic)
create table if not exists public.billing_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  currency text not null default 'USD',
  billing_cycle text not null default 'monthly',
  included jsonb not null default '{}'::jsonb,
  unit_cost_cents jsonb not null default '{}'::jsonb,
  active boolean not null default true
);

-- 3) Account billing settings (who is on which plan)
create table if not exists public.account_billing (
  account_id uuid primary key,
  plan_id uuid not null references public.billing_plans(id) on delete restrict,
  status text not null default 'active',
  provider text null,
  provider_customer_id text null,
  meta jsonb not null default '{}'::jsonb
);

-- 4) Monthly statements (for future payments layer to consume)
create table if not exists public.billing_statements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  totals jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  constraint billing_statements_unique_period unique (account_id, period_start, period_end)
);

-- Seed: a minimal default plan (adjust pricing/limits later)
insert into public.billing_plans (code, name, currency, billing_cycle, included, unit_cost_cents, active)
select
  'forge_usage_draft' as code,
  'Forge Usage (Draft Pricing)' as name,
  'USD' as currency,
  'monthly' as billing_cycle,
  jsonb_build_object(
    'sms', 1000,
    'voice', 200,
    'email', 5000,
    'whatsapp', 500
  ) as included,
  jsonb_build_object(
    'sms', 3,
    'voice', 150,
    'email', 1,
    'whatsapp', 3
  ) as unit_cost_cents,
  true as active
where not exists (
  select 1 from public.billing_plans where name = 'Forge Usage (Draft Pricing)'
);


