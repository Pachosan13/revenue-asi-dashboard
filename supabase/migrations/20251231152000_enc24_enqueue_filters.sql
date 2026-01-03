-- Tighten enqueue_enc24_reveal_tasks so it only queues:
-- - valid Encuentra24 listing URLs (no /test/*, must contain numeric listing id)
-- - likely "persona natural" (best-effort based on seller_name + raw flags)
--
-- NOTE: This does not change enc24_listings schema; it uses existing columns.

begin;

create or replace function lead_hunter.enqueue_enc24_reveal_tasks(p_limit integer default 50)
returns jsonb
language plpgsql
security definer
as $function$
declare
  v_ins int := 0;
begin
  with cand as (
    select l.listing_url
    from lead_hunter.enc24_listings l
    where l.source = 'encuentra24'
      and (l.phone_e164 is null or l.phone_e164 = '')
      and lead_hunter.is_valid_enc24_listing_url(l.listing_url)

      -- Persona natural filter (best-effort):
      -- 1) If raw contains any known "is business" flags, exclude when truthy.
      and not (
        (l.raw ? 'seller_is_business' and lower(coalesce(l.raw->>'seller_is_business','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'is_business' and lower(coalesce(l.raw->>'is_business','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'isBusiness' and lower(coalesce(l.raw->>'isBusiness','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'business' and lower(coalesce(l.raw->>'business','')) in ('true','t','1','yes','y','si','sí'))
        or (l.raw ? 'sellerIsBusiness' and lower(coalesce(l.raw->>'sellerIsBusiness','')) in ('true','t','1','yes','y','si','sí'))
      )

      -- 2) Heuristic: exclude obvious commercial sellers by name/text.
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
  )
  select count(*) into v_ins from ins;

  return jsonb_build_object('ok', true, 'inserted', v_ins);
end
$function$;

commit;


