begin;

alter table if exists public.leads
  add column if not exists followup_free_text_until timestamptz,
  add column if not exists prequal_ok boolean,
  add column if not exists prequal_marked_at timestamptz,
  add column if not exists handoff_at timestamptz,
  add column if not exists handoff_assignee_user_id text,
  add column if not exists handoff_assignee_email text;

create table if not exists public.ghl_whatsapp_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null,
  lead_id uuid null references public.leads(id) on delete set null,
  external_id text null,
  phone_e164 text null,
  provider_message_id text null,
  event_type text not null check (event_type in ('message_sent', 'message_failed', 'inbound_reply')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ghl_whatsapp_events_event_created_idx
  on public.ghl_whatsapp_events (event_type, created_at desc);

create index if not exists ghl_whatsapp_events_lead_created_idx
  on public.ghl_whatsapp_events (lead_id, created_at desc);

create index if not exists ghl_whatsapp_events_phone_created_idx
  on public.ghl_whatsapp_events (phone_e164, created_at desc);

create table if not exists public.ghl_handoff_events (
  id uuid primary key default gen_random_uuid(),
  account_id uuid null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  prequal_ok boolean not null default false,
  assignee_user_id text null,
  assignee_email text null,
  assignment_method text null,
  assignment_target text null,
  status text not null default 'recorded' check (status in ('recorded', 'sent', 'failed', 'skipped')),
  webhook_url text null,
  webhook_response_status int null,
  webhook_response_text text null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ghl_handoff_events_lead_created_idx
  on public.ghl_handoff_events (lead_id, created_at desc);

grant select, insert, update, delete on table public.ghl_whatsapp_events to anon, authenticated, service_role, authenticator;
grant select, insert, update, delete on table public.ghl_handoff_events to anon, authenticated, service_role, authenticator;

notify pgrst, 'reload schema';
commit;
