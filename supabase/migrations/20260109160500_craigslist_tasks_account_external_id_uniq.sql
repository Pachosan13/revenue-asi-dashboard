begin;

-- Required so PostgREST upsert with on_conflict=account_id,external_id can target a matching unique index.
-- Note: external_id is NULL for discover tasks, and NULLs do not conflict under UNIQUE indexes.
create unique index if not exists craigslist_tasks_account_external_id_uniq
on lead_hunter.craigslist_tasks_v1 (account_id, external_id);

commit;


