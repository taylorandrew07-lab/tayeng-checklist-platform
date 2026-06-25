-- ============================================================
-- Migration 095: activate the Daily Borescoping template
-- Run via the db-migrate runner. Idempotent.
--
-- Repeatable sections (mig 094) are live, so the template is fully functional —
-- flip it from draft to active so surveyors can start Daily Borescoping jobs.
-- ============================================================

UPDATE public.checklist_templates
   SET status = 'active'
 WHERE id = 'b0235c09-0000-4000-8000-000000000001'
   AND status = 'draft';
