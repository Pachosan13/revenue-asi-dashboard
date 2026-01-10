-- Craigslist safety fix: first_seen_at should be nullable (avoid heavy rewrites / "now" contamination).
-- Also add a global lookup index on (source, external_id) to support cross-account lookup.
--
-- Verified in migrations: public.leads has created_at. See: supabase/migrations/20251217035000_create_public_leads_stub.sql

begin;

alter table public.leads
  alter column first_seen_at drop not null;

-- Keep default for new inserts (safe even if already set).
alter table public.leads
  alter column first_seen_at set default now();

create index if not exists leads_source_external_id_idx
  on public.leads(source, external_id)
  where source is not null and external_id is not null and length(external_id) > 0;

commit;


