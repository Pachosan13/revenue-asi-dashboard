-- 1) Schema
create schema if not exists lead_hunter;

-- 2) Jobs (para Command OS)
create table if not exists lead_hunter.jobs (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null,
  directive_id uuid null,
  niche text not null,
  geo text not null,
  keywords text[] not null,
  target_leads int not null default 2000,
  status text not null default 'queued', -- queued | running | done | failed
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3) Raw places (source of truth)
create table if not exists lead_hunter.places_raw (
  place_id text primary key,
  name text,
  phone text,
  website text,
  address text,
  city text,
  state text,
  postal_code text,
  lat double precision,
  lng double precision,
  rating numeric,
  reviews_count int,
  category text,
  maps_url text,
  collected_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb
);

create index if not exists idx_places_raw_state on lead_hunter.places_raw(state);
create index if not exists idx_places_raw_website on lead_hunter.places_raw(website);

-- 4) Domains (normalized)
create table if not exists lead_hunter.domains (
  domain text primary key,
  place_id text references lead_hunter.places_raw(place_id) on delete set null,
  status text not null default 'pending', -- pending | enriched | failed
  last_enriched_at timestamptz,
  meta jsonb not null default '{}'::jsonb
);

-- 5) Contacts raw (Apollo/Hunter)
create table if not exists lead_hunter.contacts_raw (
  id uuid primary key default gen_random_uuid(),
  domain text references lead_hunter.domains(domain) on delete set null,
  full_name text,
  title text,
  email text,
  phone text,
  source text not null, -- apollo | hunter | other
  confidence numeric,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_contacts_raw_domain on lead_hunter.contacts_raw(domain);
create index if not exists idx_contacts_raw_email on lead_hunter.contacts_raw(email);

-- 6) Email verification
create table if not exists lead_hunter.email_verifications (
  email text primary key,
  status text not null, -- valid | risky | invalid | unknown
  provider text not null, -- zerobounce
  checked_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb
);

-- 7) Canonical leads (output)
create table if not exists lead_hunter.leads_canonical (
  id uuid primary key default gen_random_uuid(),
  place_id text references lead_hunter.places_raw(place_id) on delete set null,
  domain text,
  business_name text,
  contact_name text,
  title text,
  email text,
  phone text,
  niche text,
  geo text,
  completeness_score int not null default 0,
  ready_for_outreach boolean not null default false,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_leads_ready on lead_hunter.leads_canonical(ready_for_outreach);
create index if not exists idx_leads_niche on lead_hunter.leads_canonical(niche);

-- 8) View for Revenue ASI core to consume
create or replace view public.v_leads_ready as
select *
from lead_hunter.leads_canonical
where ready_for_outreach = true;

-- 9) updated_at trigger (jobs)
create or replace function lead_hunter.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_jobs_updated_at on lead_hunter.jobs;
create trigger trg_jobs_updated_at
before update on lead_hunter.jobs
for each row execute function lead_hunter.tg_set_updated_at();
