-- Make enc24 enqueue "soft":
-- - Do not requeue DONE tasks
-- - Only requeue FAILED tasks after a cooldown (prevents re-hitting the same listing every 5 minutes)
--
-- This supports the desired behavior: poll every N minutes, take 1–2 newest, don't repeat.

begin;

create or replace function lead_hunter.enqueue_enc24_reveal_tasks(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_ins int := 0;
  v_requeued int := 0;
  v_cooldown interval := interval '6 hours';
begin
  with cand as (
    select l.listing_url
    from lead_hunter.enc24_listings l
    where l.source = 'encuentra24'
      and (l.phone_e164 is null or l.phone_e164 = '')
      and lead_hunter.is_valid_enc24_listing_url(l.listing_url)

      -- Persona natural filter (best-effort):
      and not (
        (l.raw ? 'seller_is_business' and lower(coalesce(l.raw->>'seller_is_business','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'is_business' and lower(coalesce(l.raw->>'is_business','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'isBusiness' and lower(coalesce(l.raw->>'isBusiness','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'business' and lower(coalesce(l.raw->>'business','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'sellerIsBusiness' and lower(coalesce(l.raw->>'sellerIsBusiness','')) in ('true','t','1','yes','y','si','sí'))
      )
      and not (
        lower(coalesce(l.seller_name,'')) ~ '(motors|motor|dealer|agencia|concesionario|showroom|autolote|importadora|rent a car|rental|flota|stock|ventas|financiamiento|\ms\.a\.?\M|\mcorp\M|\minc\M|\mltd\M)'
        or lower(coalesce(l.raw::text,'')) ~ '(dealer|agencia|concesionario|autolote|showroom|empresa|membres[ií]a empresarial|soluci[oó]n de negocios)'
      )

    order by l.last_seen_at desc nulls last
    limit greatest(p_limit, 1)
  ),
  ins as (
    insert into lead_hunter.enc24_reveal_tasks (listing_url, status, priority)
    select c.listing_url, 'queued', 0
    from cand c
    on conflict (listing_url) do nothing
    returning 1
  ),
  requeue as (
    update lead_hunter.enc24_reveal_tasks t
      set status = 'queued',
          updated_at = now()
    where t.listing_url in (select listing_url from cand)
      and t.status = 'failed'
      and coalesce(t.updated_at, t.created_at) < now() - v_cooldown
    returning 1
  )
  select (select count(*) from ins), (select count(*) from requeue)
    into v_ins, v_requeued;

  return jsonb_build_object('ok', true, 'inserted', v_ins, 'requeued', v_requeued, 'cooldown_hours', 6);
end
$function$;

commit;


