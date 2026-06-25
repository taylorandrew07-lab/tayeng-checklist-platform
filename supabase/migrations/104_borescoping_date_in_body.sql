-- ============================================================
-- Migration 104: Daily Borescoping — fold the header into Title/Job Details
-- Run via the db-migrate runner. Idempotent.
--
-- The separate top info block is gone; all job/vessel details now live in the single
-- "Title / Job Details" section (JobPDF renders Vessel, then the spec fields, then
-- Client + Surveyors, then the remaining fields). "Conducted On" becomes "Date" and
-- is no longer a header field, so it prints in the body with Time / Port / Day Number
-- (Inspection Day Number stays last by its order_index).
-- ============================================================

UPDATE public.template_fields
   SET show_in_header = false, label = 'Date'
 WHERE id = 'b0235c09-0000-4000-8000-000000000003'; -- Conducted On
