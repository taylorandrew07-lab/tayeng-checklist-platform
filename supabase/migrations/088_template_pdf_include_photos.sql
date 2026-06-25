-- ============================================================
-- Migration 088: per-template "include photos in the PDF" flag
-- Run via the db-migrate runner. Idempotent.
--
-- Historically the checklist PDF deliberately EXCLUDED photos (it printed only a
-- "N photos stored internally" note). This adds an opt-in flag so a template can
-- render its photos into the report as a captioned grid, WITHOUT changing any
-- existing report (defaults to false). The Daily Borescoping template turns it on.
-- ============================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_include_photos BOOLEAN NOT NULL DEFAULT false;
