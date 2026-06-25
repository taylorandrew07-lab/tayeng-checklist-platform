-- ============================================================
-- Migration 087: add 'video_link' to the field_type enum
-- Idempotent. MUST be its own migration: Postgres allows ALTER TYPE ... ADD VALUE
-- inside a transaction (PG12+) but the new value cannot be USED until the
-- transaction commits — so any template field that uses it lives in a later
-- migration (same pattern as 073 → 074 for pass_fail).
--
-- A Video Link field stores one or more pasted external URLs (videos are hosted
-- on Taylor Engineering's own NAS — nothing is uploaded to / streamed from
-- Supabase). Stored in job_field_values.value_array (JSONB) like multiple_choice;
-- no schema change beyond the enum value.
-- ============================================================

ALTER TYPE public.field_type ADD VALUE IF NOT EXISTS 'video_link';
