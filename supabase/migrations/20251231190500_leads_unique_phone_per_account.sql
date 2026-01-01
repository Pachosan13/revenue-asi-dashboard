-- Avoid duplicate leads by phone within an account (helps idempotent promotion from enc24).

begin;

create unique index if not exists leads_account_phone_uq
  on public.leads(account_id, phone)
  where phone is not null and length(phone) > 0;

commit;


