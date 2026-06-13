-- ============================================================
-- Migration 048: "Overtime job" flag
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Marks a job as an overtime job (e.g. a Shell call-out). It's a per-job toggle;
-- the actual split still lives per surveyor (regular_hours = billed to client,
-- overtime_hours = paid to the surveyor as OT), so a job can mix both. This flag
-- just surfaces "this is an overtime job" at a glance and guides hour entry.
-- ============================================================

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS is_overtime BOOLEAN NOT NULL DEFAULT false;
