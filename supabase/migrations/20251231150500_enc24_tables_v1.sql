-- Encuentra24 tables v1 (local + cloud safe)
-- Creates the minimal tables the enc24 worker + DB RPCs expect.

begin;

create extension if not exists pgcrypto;
create schema if not exists lead_hunter;

-- ------------------------------------------------------------
-- lead_hunter.enc24_listings (staging)
-- ------------------------------------------------------------
create table if not exists lead_hunter.enc24_listings (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null,
  source text not null default 'encuentra24',

  listing_url text not null,
  listing_url_hash text generated always as (md5(lower(listing_url))) stored,

  ok boolean not null default false,
  stage int null,
  method text null,
  reason text null,

  seller_name text null,
  seller_profile_url text null,
  seller_address text null,

  phone_e164 text null,
  wa_link text null,

  raw jsonb not null default '{}'::jsonb,

  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists enc24_listings_url_uq
  on lead_hunter.enc24_listings(listing_url_hash);

create index if not exists enc24_listings_ok_lastseen_idx
  on lead_hunter.enc24_listings(ok, last_seen_at desc);

create index if not exists enc24_listings_phone_idx
  on lead_hunter.enc24_listings(phone_e164);

-- ------------------------------------------------------------
-- lead_hunter.enc24_reveal_tasks (queue)
-- ------------------------------------------------------------
create table if not exists lead_hunter.enc24_reveal_tasks (
  id uuid primary key default gen_random_uuid(),
  listing_url text not null,
  status text not null default 'queued', -- queued | claimed | done | failed
  priority int not null default 0,
  attempts int not null default 0,
  claimed_at timestamptz null,
  claimed_by text null,
  last_error text null,
  last_heartbeat_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists enc24_reveal_tasks_listing_url_uq
  on lead_hunter.enc24_reveal_tasks(listing_url);

create index if not exists enc24_reveal_tasks_status_idx
  on lead_hunter.enc24_reveal_tasks(status, priority desc, created_at asc);

commit;


