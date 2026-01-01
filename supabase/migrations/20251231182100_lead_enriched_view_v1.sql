-- lead_enriched view v1 (minimal)
-- Required by dispatch-touch-voice-v5 which reads lead_enriched.phone by lead_id.

begin;

create or replace view public.lead_enriched as
select
  l.id,
  l.account_id,
  l.contact_name,
  l.company,
  l.email,
  l.phone,
  coalesce(l.state, l.lead_state, l.status) as state,
  l.created_at,
  l.updated_at
from public.leads l;

grant select on public.lead_enriched to anon, authenticated, authenticator;

notify pgrst, 'reload schema';

commit;


