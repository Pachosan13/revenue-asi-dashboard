-- Ensure claiming sets updated_at so executing reapers don't kill fresh runs.
-- Existing schema: public.touch_runs has updated_at nullable.
create or replace function public.claim_touch_runs(p_limit integer)
returns setof touch_runs
language plpgsql
as $function$
begin
  return query
  with cte as (
    select id
    from public.touch_runs
    where status = 'queued'
      and scheduled_at <= now()
    order by scheduled_at
    for update skip locked
    limit p_limit
  )
  update public.touch_runs t
  set
    status = 'executing',
    executed_at = now(),
    updated_at = now()
  from cte
  where t.id = cte.id
  returning t.*;
end;
$function$;


