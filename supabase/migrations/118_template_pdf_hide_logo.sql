-- ============================================================
-- Migration 118: per-template "hide the logo on the PDF report" flag. Idempotent.
--
-- The report letterhead always printed the graphic Taylor Engineering logo. This adds
-- an opt-in flag so a template can suppress the logo image (the report falls back to
-- the company name + tagline text header; the address/contact line is unchanged).
-- Defaults to false so every existing report is untouched.
--
-- Seeds it TRUE for the Fuel Transfer + loadout checklists (which were never meant to
-- carry the logo). Name-matched so a rename won't error; admins can toggle any template.
-- ============================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_hide_logo BOOLEAN NOT NULL DEFAULT false;

UPDATE public.checklist_templates
SET pdf_hide_logo = true
WHERE name ILIKE '%fuel transfer%'
   OR name ILIKE '%loadout%'
   OR name ILIKE '%cargo loading%'
   OR name ILIKE '%cargo discharg%';
