-- Billing infra v2 (RLS + policies + aggregates)
-- - Supabase Cloud only (no local DB required)
-- - Proper authz: user can read billing rows ONLY if in public.account_members for that account_id
-- - Keep billing_plans server-only (RLS ON, no policies for client roles)
-- - Add aggregate RPCs for performance (security invoker; respects RLS)

-- 1) RLS ON (billing tables + membership)
alter table public.usage_ledger enable row level security;
alter table public.account_billing enable row level security;
alter table public.billing_statements enable row level security;
alter table public.billing_plans enable row level security;
alter table public.account_members enable row level security;

-- 2) Grants for app roles (RLS still applies)
grant select on table public.usage_ledger to authenticated;
grant select on table public.account_billing to authenticated;
grant select on table public.billing_statements to authenticated;
grant select on table public.account_members to authenticated;

-- Allow plan assignment via RLS (owner/admin only)
grant insert, update on table public.account_billing to authenticated;

-- 3) Policies
drop policy if exists usage_ledger_read_member on public.usage_ledger;
create policy usage_ledger_read_member on public.usage_ledger
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = usage_ledger.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists billing_statements_read_member on public.billing_statements;
create policy billing_statements_read_member on public.billing_statements
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = billing_statements.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists account_billing_read_member on public.account_billing;
create policy account_billing_read_member on public.account_billing
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = account_billing.account_id
        and am.user_id = auth.uid()
    )
  );

drop policy if exists account_billing_write_admin on public.account_billing;
create policy account_billing_write_admin on public.account_billing
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.account_members am
      where am.account_id = account_billing.account_id
        and am.user_id = auth.uid()
        and lower(am.role) in ('owner','admin')
    )
  );

drop policy if exists account_billing_update_admin on public.account_billing;
create policy account_billing_update_admin on public.account_billing
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.account_members am
      where am.account_id = account_billing.account_id
        and am.user_id = auth.uid()
        and lower(am.role) in ('owner','admin')
    )
  )
  with check (
    exists (
      select 1
      from public.account_members am
      where am.account_id = account_billing.account_id
        and am.user_id = auth.uid()
        and lower(am.role) in ('owner','admin')
    )
  );

drop policy if exists account_members_read_self on public.account_members;
create policy account_members_read_self on public.account_members
  for select
  to authenticated
  using (user_id = auth.uid());

-- billing_plans stays server-only: no client policies by default.

-- 4) Aggregate RPCs (perf): by channel / by source
create or replace function public.billing_usage_by_channel(
  p_account_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  channel text,
  units bigint,
  amount_cents bigint
)
language sql
stable
as $$
  select
    ul.channel,
    coalesce(sum(ul.units), 0)::bigint as units,
    coalesce(sum(ul.amount_cents), 0)::bigint as amount_cents
  from public.usage_ledger ul
  where ul.account_id = p_account_id
    and ul.occurred_at >= p_from
    and ul.occurred_at < p_to
  group by ul.channel
  order by amount_cents desc;
$$;

create or replace function public.billing_usage_by_source(
  p_account_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  source text,
  units bigint,
  amount_cents bigint
)
language sql
stable
as $$
  select
    ul.source,
    coalesce(sum(ul.units), 0)::bigint as units,
    coalesce(sum(ul.amount_cents), 0)::bigint as amount_cents
  from public.usage_ledger ul
  where ul.account_id = p_account_id
    and ul.occurred_at >= p_from
    and ul.occurred_at < p_to
  group by ul.source
  order by amount_cents desc;
$$;

grant execute on function public.billing_usage_by_channel(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.billing_usage_by_source(uuid, timestamptz, timestamptz) to authenticated;

notify pgrst, 'reload schema';


