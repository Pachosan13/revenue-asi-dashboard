alter table if exists lead_hunter.enc24_autopilot_settings
  add column if not exists ghl_enabled boolean not null default true;
