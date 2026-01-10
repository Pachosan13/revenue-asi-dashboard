begin;

create unique index if not exists craigslist_tasks_detail_uniq
on lead_hunter.craigslist_tasks_v1 (account_id, external_id)
where task_type = 'detail' and external_id is not null;

commit;


