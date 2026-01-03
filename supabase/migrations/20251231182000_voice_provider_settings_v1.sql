-- Voice provider settings v1
-- Required by dispatch-touch-voice-v5 (and other dispatchers) to resolve provider per account/channel.

begin;

create extension if not exists pgcrypto;

create table if not exists public.account_provider_settings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  channel text not null, -- voice | whatsapp | sms | email
  provider text not null, -- twilio | etc
  config jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, channel, is_default)
);

create index if not exists idx_account_provider_settings_account_channel
  on public.account_provider_settings(account_id, channel);

-- Local-friendly perms (adjust for prod/RLS later)
grant usage on schema public to anon, authenticated, authenticator;
grant select, insert, update, delete on table public.account_provider_settings to anon, authenticated, authenticator;

notify pgrst, 'reload schema';

commit;


