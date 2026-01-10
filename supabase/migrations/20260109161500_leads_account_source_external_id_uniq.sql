begin;

-- Required so PostgREST upsert with on_conflict=account_id,source,external_id can target a matching unique index.
-- Note: NULLs do not conflict under UNIQUE indexes.
create unique index if not exists leads_account_source_external_id_uniq
on public.leads(account_id, source, external_id);

commit;


