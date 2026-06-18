-- ============================================================
-- Migration 070: Colour key for clients + checklist templates
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent. Safe.
--
-- Stores a curated PALETTE KEY (e.g. 'teal') — never raw hex — used to colour-code
-- job rows by client or by job type. Nullable; null = no colour (renders neutral).
-- The keys map to colours in src/lib/jobs/colors.ts (JOB_PALETTE).
--
-- RLS: no change needed. Postgres RLS is row-level, not column-level, and no
-- column privileges are set on these tables, so the existing admin UPDATE policies
-- ("Admins can manage clients" / template management) already permit writing the
-- new column. (Verified: clients + checklist_templates use row-scoped admin
-- policies, not GRANT ... (column) restrictions.)
--
-- ROLLBACK:
--   ALTER TABLE public.clients DROP COLUMN IF EXISTS color;
--   ALTER TABLE public.checklist_templates DROP COLUMN IF EXISTS color;
-- ============================================================

ALTER TABLE public.clients             ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE public.checklist_templates ADD COLUMN IF NOT EXISTS color TEXT;
