reset search_path;
set search_path = public;

create extension if not exists pgcrypto;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
