-- View to expose unified voice call data for the dashboard without altering existing tables
create or replace view voice_insights_calls_v1 as
select
  c.id,
  c.lead_id,
  null::uuid as touch_run_id,
  coalesce(c.outcome, c.direction) as status,
  'twilio'::text as provider,
  c.twilio_call_sid as provider_call_id,
  c.to_number as to_phone,
  c.meta,
  coalesce(c.ended_at, c.started_at, c.created_at) as updated_at
from
  public.calls c
order by
  coalesce(c.ended_at, c.started_at, c.created_at) desc;
