-- ============================================================
-- Migration 024: Per-user UI preferences
-- Run in Supabase SQL Editor. Idempotent.
--
-- Stores per-user UI preferences (currently the sidebar nav order) as JSONB on
-- the profile. No new RLS needed: the "Users can update safe own profile fields"
-- policy (migration 004) already lets a user update their own non-sensitive
-- columns while locking role / is_active / is_super_admin / email.
-- ============================================================

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ui_prefs JSONB NOT NULL DEFAULT '{}'::jsonb;
