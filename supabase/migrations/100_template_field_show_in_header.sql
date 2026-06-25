-- ============================================================
-- Migration 100: per-field "show in report header" flag
-- Run via the db-migrate runner. Idempotent.
--
-- Generic, cross-template-safe mechanism (modelled on is_billable_hours / mig 089):
-- a field flagged show_in_header is promoted to the report's top info block and
-- suppressed from the section body. Default false, so every other template (OVID,
-- UHT, bunker, …) has zero flagged fields and keeps its existing header byte-for-byte.
--
-- For the Daily Borescoping report the vessel-identity fields move to the header:
-- Vessel Name, Port of Registry, Gross Tonnes, Surveyor, Client — leaving the body
-- "Title / Job Details" showing only Conducted On, Time, Port/Location, Inspection
-- Day Number. NO field is deleted (Port of Registry & Gross Tonnes have no job-record
-- home, so they must stay as inputs; deleting would strand data + wipe answers).
-- ============================================================

ALTER TABLE public.template_fields
  ADD COLUMN IF NOT EXISTS show_in_header BOOLEAN NOT NULL DEFAULT false;

UPDATE public.template_fields SET show_in_header = true WHERE id IN (
  'b0235c09-0000-4000-8000-000000000005', -- Vessel Name
  'b0235c09-0000-4000-8000-000000000006', -- Port of Registry
  'b0235c09-0000-4000-8000-000000000007', -- Gross Tonnes
  'b0235c09-0000-4000-8000-000000000009', -- Surveyor
  'b0235c09-0000-4000-8000-00000000000a'  -- Client
);
