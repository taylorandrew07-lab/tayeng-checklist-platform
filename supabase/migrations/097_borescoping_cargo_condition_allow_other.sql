-- ============================================================
-- Migration 097: allow "Other" free-text on the Borescoping Cargo Line Condition
-- Run via the db-migrate runner. Idempotent.
--
-- The multiple_choice "Cargo Line Condition" field should let the surveyor add a
-- condition that isn't one of the 12 preset options. This sets validation.allow_other
-- on that field so it works immediately (the builder also exposes the toggle now).
-- Custom answers are stored in value_array alongside the chosen option values.
-- ============================================================

UPDATE public.template_fields
   SET validation = jsonb_set(COALESCE(validation, '{}'::jsonb), '{allow_other}', 'true'::jsonb)
 WHERE id = 'b0235c09-0000-4000-8000-000000000012';
