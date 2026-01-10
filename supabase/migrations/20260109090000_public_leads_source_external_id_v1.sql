-- Add minimal columns required by Lead Hunter ingestion (used by existing functions)
-- NOTE: This migration is defensive (IF NOT EXISTS) because some environments may already have these columns.

begin;

alter table if exists public.leads
  add column if not exists source text,
  add column if not exists external_id text,
  add column if not exists niche text,
  add column if not exists title text,
  add column if not exists url text,
  add column if not exists price numeric,
  add column if not exists city text,
  add column if not exists country text,
  add column if not exists first_seen_at timestamptz not null default now(),
  add column if not exists raw jsonb not null default '{}'::jsonb;

-- Strict dedupe by (account_id, source, external_id) for source adapters like craigslist.
create unique index if not exists leads_account_source_external_id_uq
  on public.leads(account_id, source, external_id)
  where source is not null and external_id is not null and length(external_id) > 0;

-- Helpful lookup for city SSV aggregations
create index if not exists leads_source_city_first_seen_idx
  on public.leads(source, city, first_seen_at desc);

commit;


