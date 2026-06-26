-- ============================================================
-- Migration 106: per-job display order for repeatable-section entries
-- Run via the db-migrate runner. Idempotent.
--
-- Repeatable sections (migration 094) store one row per (job_id, field_id,
-- instance). The `instance` is a STABLE id. This column records the ORDER those
-- instances are displayed in the editor and printed in the report, so entries can
-- be inserted between others and drag-reordered WITHOUT renumbering or moving any
-- stored answer/photo/signature — the data stays put, only the order list changes.
--
-- Shape: { "<section_id>": [<instance>, <instance>, ...] }
-- Absent or missing a section → natural ascending instance order, i.e. exactly the
-- current behaviour. Every existing job and report is therefore unchanged until an
-- entry is explicitly inserted or reordered.
--
-- Lives on `jobs`, so the existing jobs RLS (admins; active surveyors via mig 056)
-- already governs who can read/write it — no new policy needed.
-- ============================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS repeatable_order jsonb NOT NULL DEFAULT '{}'::jsonb;
