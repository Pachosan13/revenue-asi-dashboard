-- Grant access to lead_hunter schema + RPCs for app roles.
-- Fixes: permission denied for schema lead_hunter when calling enqueue_enc24_reveal_tasks via PostgREST.

begin;

-- Schema usage so PostgREST roles can reference lead_hunter.rpc(...)
grant usage on schema lead_hunter to anon, authenticated, service_role, authenticator;

-- Allow calling RPCs in this schema (safe for local/dev; tighten later with SECURITY DEFINER + internal checks)
grant execute on all functions in schema lead_hunter to anon, authenticated, service_role, authenticator;

-- Ensure future functions also get execute granted by default (optional but helpful)
alter default privileges in schema lead_hunter grant execute on functions to anon, authenticated, service_role, authenticator;

notify pgrst, 'reload schema';

commit;


