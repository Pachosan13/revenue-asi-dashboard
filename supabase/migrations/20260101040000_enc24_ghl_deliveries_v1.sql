-- Encuentra24 -> GHL deliveries (idempotent outbound webhook queue)
-- Goal: send revealed persona-natural leads (phone_e164) to GoHighLevel via LeadConnector webhook
-- WITHOUT impacting reveal worker reliability. This table is the idempotency + retry ledger.

begin;

create schema if not exists lead_hunter;

create table if not exists lead_hunter.enc24_ghl_deliveries (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,

  listing_url text not null,
  listing_url_hash text generated always as (md5(lower(listing_url))) stored,
  external_id text null,

  phone_e164 text null,

  status text not null default 'queued' check (status in ('queued','sending','sent','failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz null,
  last_attempt_at timestamptz null,
  last_error text null,

  payload jsonb not null default '{}'::jsonb,
  response_status int null,
  response_text text null,

  sent_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (account_id, listing_url_hash)
);

create index if not exists enc24_ghl_deliveries_status_due_idx
  on lead_hunter.enc24_ghl_deliveries (account_id, status, next_attempt_at, created_at);

create index if not exists enc24_ghl_deliveries_phone_idx
  on lead_hunter.enc24_ghl_deliveries (account_id, phone_e164);

-- Local-friendly perms (matches the rest of lead_hunter)
grant usage on schema lead_hunter to anon, authenticated, service_role, authenticator;
grant select, insert, update, delete on table lead_hunter.enc24_ghl_deliveries to anon, authenticated, service_role, authenticator;

notify pgrst, 'reload schema';
commit;


