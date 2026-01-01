-- Grant table privileges in lead_hunter schema for app roles.
-- Fixes: permission denied for table lead_hunter.enc24_listings when using Supabase clients.

begin;

grant usage on schema lead_hunter to anon, authenticated, service_role, authenticator;

-- Tables: allow app roles to read/write staging + queue tables (local/dev baseline).
grant select, insert, update, delete on all tables in schema lead_hunter to anon, authenticated, service_role, authenticator;
alter default privileges in schema lead_hunter
  grant select, insert, update, delete on tables to anon, authenticated, service_role, authenticator;

-- Sequences (if any)
grant usage, select on all sequences in schema lead_hunter to anon, authenticated, service_role, authenticator;
alter default privileges in schema lead_hunter
  grant usage, select on sequences to anon, authenticated, service_role, authenticator;

notify pgrst, 'reload schema';

commit;


