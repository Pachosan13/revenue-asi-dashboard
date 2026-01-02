-- lead_enriched view v1 (minimal)
-- Required by dispatch-touch-voice-v5 which reads lead_enriched.phone by lead_id.

begin;

-- In some environments lead_state may be an enum; drop+recreate and cast to text for compatibility.
drop view if exists public.lead_enriched cascade;
create or replace view public.lead_enriched as
select
  l.id,
  l.account_id,
  l.contact_name,
  l.company,
  l.email,
  l.phone,
  coalesce(l.state::text, l.lead_state::text, l.status::text) as state,
  l.created_at,
  l.updated_at
from public.leads l;

grant select on public.lead_enriched to anon, authenticated, authenticator;

notify pgrst, 'reload schema';

commit;


