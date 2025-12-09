-- Enrichment Engine V2 – tabla, triggers, vista y RPC

begin;

------------------------------------------------------------
-- 1) Tabla principal: public.lead_enrichments_v2
------------------------------------------------------------

create table if not exists public.lead_enrichments_v2 (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,

  -- Campos estructurados del Lead Genome
  industry text,
  sub_industry text,
  pain_points jsonb,
  objections jsonb,
  emotional_state jsonb,
  urgency_score numeric(5,2),
  budget_estimate text,
  decision_authority_score numeric(5,2),
  conversion_likelihood numeric(5,2),
  recommended_channel text,
  recommended_cadence jsonb,
  recommended_persona text,

  -- Meta / engine
  status text not null default 'pending',  -- pending | running | completed | failed
  mode text not null default 'auto',       -- auto | force | system
  input_snapshot jsonb,
  raw_result jsonb,
  ai_lead_score numeric(5,2),
  core_memory_event_id uuid,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_lead_enrichments_v2_lead_id
  on public.lead_enrichments_v2(lead_id);

create index if not exists idx_lead_enrichments_v2_status
  on public.lead_enrichments_v2(status);

create index if not exists idx_lead_enrichments_v2_created_at
  on public.lead_enrichments_v2(created_at);

------------------------------------------------------------
-- 2) Trigger updated_at
------------------------------------------------------------

create or replace function public.set_timestamp_lead_enrichments_v2()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_set_timestamp_lead_enrichments_v2
  on public.lead_enrichments_v2;

create trigger trg_set_timestamp_lead_enrichments_v2
before update on public.lead_enrichments_v2
for each row
execute procedure public.set_timestamp_lead_enrichments_v2();

------------------------------------------------------------
-- 3) Trigger → core_memory_events al completar enrichment
------------------------------------------------------------

create or replace function public.log_lead_enrichments_v2_to_memory()
returns trigger
language plpgsql
as $$
declare
  v_event_id uuid;
begin
  if new.status = 'completed'
     and (old.status is distinct from 'completed')
     and new.core_memory_event_id is null
  then
    insert into public.core_memory_events (
      scope,
      account_id,
      entity_id,
      actor,
      event_type,
      payload
    )
    values (
      'lead',
      null,
      new.lead_id,
      'enrichment_v2',
      'lead_enriched_v2',
      jsonb_build_object(
        'enrichment_run_id',      new.id,
        'ai_lead_score',          new.ai_lead_score,
        'industry',               new.industry,
        'sub_industry',           new.sub_industry,
        'urgency_score',          new.urgency_score,
        'conversion_likelihood',  new.conversion_likelihood,
        'recommended_channel',    new.recommended_channel,
        'recommended_persona',    new.recommended_persona,
        'raw',                    new.raw_result
      )
    )
    returning id into v_event_id;

    new.core_memory_event_id := v_event_id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_log_lead_enrichments_v2_to_memory
  on public.lead_enrichments_v2;

create trigger trg_log_lead_enrichments_v2_to_memory
after update on public.lead_enrichments_v2
for each row
execute procedure public.log_lead_enrichments_v2_to_memory();

------------------------------------------------------------
-- 4) Vista enriquecida: v_lead_with_enrichment_v2
------------------------------------------------------------

create or replace view public.v_lead_with_enrichment_v2 as
select
  l.*,
  e.id                      as enrichment_id,
  e.industry,
  e.sub_industry,
  e.pain_points,
  e.objections,
  e.emotional_state,
  e.urgency_score,
  e.budget_estimate,
  e.decision_authority_score,
  e.conversion_likelihood,
  e.recommended_channel,
  e.recommended_cadence,
  e.recommended_persona,
  e.ai_lead_score,
  e.status                  as enrichment_status,
  e.created_at              as enrichment_created_at,
  e.updated_at              as enrichment_updated_at
from public.leads l
left join lateral (
  select *
  from public.lead_enrichments_v2 e
  where e.lead_id = l.id
    and e.status = 'completed'
  order by e.created_at desc
  limit 1
) e on true;

------------------------------------------------------------
-- 5) RPC: run_enrichment_v2
------------------------------------------------------------

create or replace function public.run_enrichment_v2(
  p_lead_id uuid,
  p_mode text default 'auto'
)
returns public.lead_enrichments_v2
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.lead_enrichments_v2;
begin
  if p_lead_id is null then
    raise exception 'p_lead_id is required';
  end if;

  if p_mode = 'auto' then
    select *
    into v_run
    from public.lead_enrichments_v2
    where lead_id = p_lead_id
      and status = 'completed'
    order by created_at desc
    limit 1;

    if found then
      return v_run;
    end if;
  end if;

  with lead_data as (
    select row_to_json(l) as data
    from public.leads l
    where l.id = p_lead_id
  )
  insert into public.lead_enrichments_v2 (
    lead_id,
    status,
    mode,
    input_snapshot
  )
  select
    p_lead_id,
    'pending',
    coalesce(p_mode, 'auto'),
    ld.data
  from lead_data ld
  returning * into v_run;

  if not found then
    raise exception 'Lead % not found', p_lead_id;
  end if;

  return v_run;
end;
$$;

commit;

