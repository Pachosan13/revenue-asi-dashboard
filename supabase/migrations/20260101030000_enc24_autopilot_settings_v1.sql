-- Encuentra24 autos usados autopilot settings (per-account)
begin;

create schema if not exists lead_hunter;

create table if not exists lead_hunter.enc24_autopilot_settings (
  account_id uuid primary key,
  enabled boolean not null default false,
  country text not null default 'PA',
  interval_minutes int not null default 5,
  max_new_per_tick int not null default 2,
  start_hour int not null default 8,
  end_hour int not null default 19,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists enc24_autopilot_settings_enabled_idx
  on lead_hunter.enc24_autopilot_settings(enabled, updated_at desc);

-- Local-friendly perms
grant usage on schema lead_hunter to anon, authenticated, service_role, authenticator;
grant select, insert, update, delete on table lead_hunter.enc24_autopilot_settings to anon, authenticated, service_role, authenticator;

notify pgrst, 'reload schema';
commit;


