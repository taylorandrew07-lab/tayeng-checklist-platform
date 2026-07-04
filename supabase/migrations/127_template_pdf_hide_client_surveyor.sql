-- ============================================================
-- Migration 127: per-template "hide Client / Surveyor in the report header" flags.
-- Run via the db-migrate runner. Idempotent.
--
-- The report's top Job-Details block always printed Vessel, Client, Date, Surveyor,
-- Port and Method of Delivery. For checklists whose CLIENT is already named in the
-- report title (e.g. "BPTT LLC - Fuel Transfer Checklist") the Client row is pure
-- duplication, and some of these checklists don't want the surveyor printed either.
--
-- These two opt-in flags let a template drop those header rows independently. Both
-- default false, so every existing report is untouched. Same family as pdf_hide_logo
-- (mig 118): name-matched seed for the fuel-transfer / loadout / cargo checklists,
-- and admins can toggle any template from the editor.
-- ============================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_hide_client   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_hide_surveyor BOOLEAN NOT NULL DEFAULT false;

UPDATE public.checklist_templates
SET pdf_hide_client = true,
    pdf_hide_surveyor = true
WHERE name ILIKE '%fuel transfer%'
   OR name ILIKE '%loadout%'
   OR name ILIKE '%cargo loading%'
   OR name ILIKE '%cargo discharg%';
