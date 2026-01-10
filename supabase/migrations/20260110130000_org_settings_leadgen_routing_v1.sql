-- Org settings + LeadGen Routing (MVP)
-- NOTE: `org_settings` is referenced by the Settings UI. This migration codifies it in repo-truth.

create table if not exists public.org_settings (
  id uuid primary key default gen_random_uuid(),

  -- existing UI fields
  autopause_on_errors boolean not null default false,
  notify_on_anomalies boolean not null default true,
  sync_crm_webhooks boolean not null default false,
  fallback_email text not null default '',
  webhook_url text not null default '',

  -- LeadGen Routing (JSON payload; no secrets)
  leadgen_routing jsonb null,

  updated_at timestamptz null default now()
);

-- Minimal server-side validation (reject invalid values).
alter table public.org_settings
  drop constraint if exists org_settings_leadgen_routing_valid;

alter table public.org_settings
  add constraint org_settings_leadgen_routing_valid check (
    leadgen_routing is null
    or (
      jsonb_typeof(leadgen_routing) = 'object'
      and (
        (leadgen_routing ? 'radius_miles') = false
        or (
          (leadgen_routing->>'radius_miles') ~ '^[0-9]+$'
          and ((leadgen_routing->>'radius_miles')::int >= 1)
          and ((leadgen_routing->>'radius_miles')::int <= 50)
        )
      )
      and (
        (leadgen_routing ? 'active') = false
        or (leadgen_routing->>'active') in ('true','false')
      )
      and (
        -- If active=true, dealer_address must be present + non-empty.
        (leadgen_routing->>'active') <> 'true'
        or length(trim(coalesce(leadgen_routing->>'dealer_address',''))) > 0
      )
    )
  );


