-- ============================================================
-- Migration 221: an attendance can say which firm the attendee came from
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- A case is worked by several firms at once. "Ian Maxwell" on a line means little to a
-- club six months later; "Ian Maxwell, West Moorings Limited" is who they are paying for.
-- Our own people carry our name for the same reason - the claim should read the same way
-- for every attendee on it, whoever they work for.
--
-- OPTIONAL, deliberately. Nullable, no default, no CHECK: a name typed in a hurry with no
-- firm beside it must still save. The form fills our company in when the attendee is one
-- of ours, and that is a convenience, not a rule the database enforces.
-- ============================================================

ALTER TABLE public.case_attendances
  ADD COLUMN IF NOT EXISTS company TEXT;

COMMENT ON COLUMN public.case_attendances.company IS
  'The firm the attendee came from, as typed. Optional. Filled in with our own company name when the attendee is one of our people, but never required - an attendance with no firm beside it still saves.';

-- Sanity check after running:
--   SELECT attendee_name, company, minutes FROM public.case_attendances ORDER BY attended_on DESC;
