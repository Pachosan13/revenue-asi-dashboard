-- Avoid duplicate leads by phone within an account (helps idempotent promotion from enc24).

begin;

-- Remote safety: if duplicates exist already, de-dupe before adding the unique index.
-- Policy: keep the most recently updated lead per (account_id, phone); null the phone on the rest.
with ranked as (
  select
    id,
    account_id,
    phone,
    row_number() over (
      partition by account_id, phone
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn
  from public.leads
  where phone is not null and length(phone) > 0
),
dupes as (
  select * from ranked where rn > 1
)
update public.leads l
set
  phone = null,
  enriched = coalesce(l.enriched,'{}'::jsonb) || jsonb_build_object(
    'dedupe',
    jsonb_build_object(
      'reason', 'duplicate_phone_before_unique_index',
      'phone', d.phone,
      'at', now()
    )
  ),
  updated_at = now()
from dupes d
where l.id = d.id;

create unique index if not exists leads_account_phone_uq
  on public.leads(account_id, phone)
  where phone is not null and length(phone) > 0;

commit;


