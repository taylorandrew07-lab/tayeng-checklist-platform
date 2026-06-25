-- ============================================================
-- Migration 092: per-template PDF disclaimer (fixed report boilerplate)
-- Run via the db-migrate runner. Idempotent.
--
-- Some reports must carry fixed legal boilerplate (property/confidentiality/without
-- prejudice) on every generated PDF — text that is NOT an editable survey field. This
-- adds an optional per-template disclaimer that JobPDF prints in a boxed footnote at
-- the end of the report. NULL (every existing template) renders nothing — no change
-- to existing reports.
-- ============================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_disclaimer TEXT;
