-- Placeholder migration to match remote history.
-- The remote database has migration version 20251228060000 marked as applied,
-- but this repo did not contain the corresponding file.
--
-- This file is intentionally a NO-OP to unblock `supabase db push` while keeping
-- local migration history aligned with the remote project.

begin;
-- no-op
commit;


