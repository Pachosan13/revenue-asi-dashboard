begin;

alter table if exists public.leads
  add column if not exists lead_status text;

commit;
