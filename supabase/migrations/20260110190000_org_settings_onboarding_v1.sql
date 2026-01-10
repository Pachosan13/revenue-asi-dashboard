-- Onboarding v1 fields (identity + contact + vertical)
-- Storage: public.org_settings (existing table used by Settings UI)

alter table public.org_settings
  add column if not exists business_name text;

alter table public.org_settings
  add column if not exists contact_email text;

alter table public.org_settings
  add column if not exists contact_phone text;

alter table public.org_settings
  add column if not exists contact_whatsapp text;

alter table public.org_settings
  add column if not exists vertical text default 'car_dealer';


