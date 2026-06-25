-- ============================================================
-- Migration 101: Daily Borescoping "Distance" in metres
-- Run via the db-migrate runner. Idempotent.
--
-- The Cargo Line Inspection "Distance" field is in metres — label it "Distance (m)"
-- and give it the unit "m" so the value prints as e.g. "35.5 m".
-- ============================================================

UPDATE public.template_fields
   SET label = 'Distance (m)', unit = 'm'
 WHERE id = 'b0235c09-0000-4000-8000-000000000015';
