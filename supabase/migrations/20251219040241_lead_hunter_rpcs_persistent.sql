drop function if exists lead_hunter.claim_next_job(text,text,text);
create function lead_hunter.claim_next_job(p_worker_id text, p_source text, p_niche text)
returns jsonb
language plpgsql
security definer
as $$
declare v_id uuid; v_row jsonb;
begin
  with c as (
    select id from lead_hunter.jobs
    where status='queued' and niche=p_niche and (p_source is null or p_source='' or meta->>'source'=p_source or meta->>'market'=p_source)
    order by created_at asc limit 1 for update skip locked
  )
  update lead_hunter.jobs j
  set status='running',
      meta=jsonb_set(jsonb_set(coalesce(j.meta,'{}'::jsonb), '{worker_id}', to_jsonb(p_worker_id), true),
                    '{source}', to_jsonb(coalesce(p_source,'')), true)
  from c where j.id=c.id
  returning j.id into v_id;

  if v_id is null then return null; end if;

  select to_jsonb(j.*) into v_row from lead_hunter.jobs j where j.id=v_id;
  return v_row;
end;
$$;

drop function if exists public.claim_next_job(jsonb);
create function public.claim_next_job(p jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare v_worker_id text; v_source text; v_niche text;
begin
  v_worker_id := coalesce(p->>'p_worker_id', p->>'worker_id', p->>'p_worker');
  v_source := coalesce(p->>'p_source', 'encuentra24');
  v_niche := coalesce(p->>'p_niche', 'autos');
  if v_worker_id is null then raise exception 'Missing p_worker_id'; end if;
  return lead_hunter.claim_next_job(v_worker_id, v_source, v_niche);
end;
$$;

revoke all on function public.claim_next_job(jsonb) from public;
grant execute on function public.claim_next_job(jsonb) to anon, authenticated, service_role;
revoke all on function lead_hunter.claim_next_job(text,text,text) from public;
grant execute on function lead_hunter.claim_next_job(text,text,text) to service_role;
