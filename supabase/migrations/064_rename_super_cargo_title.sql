-- ============================================================
-- Migration 064: Rename the cosmetic "Super-Cargo" title to "Cargo Technician"
-- Run in Supabase SQL Editor. Idempotent.
--
-- display_title is purely cosmetic (no permissions); this just updates the label
-- on any existing staff who signed up as Super-Cargo.
-- ============================================================

UPDATE public.profiles
  SET display_title = 'Cargo Technician'
  WHERE display_title IN ('Super-Cargo', 'Super Cargo', 'Supercargo');
