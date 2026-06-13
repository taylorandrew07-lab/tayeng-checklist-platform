-- ============================================================
-- Migration 045: Invoice follow-up reminders
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Tracks when an overdue invoice was last chased, so staff can follow up
-- systematically. Overdue itself stays derived (a sent invoice past its due
-- date) — this only records the follow-up timestamp.
-- ============================================================

ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;
