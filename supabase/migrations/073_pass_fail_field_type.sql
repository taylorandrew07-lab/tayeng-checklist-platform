-- ============================================================
-- Migration 073: add 'pass_fail' to the field_type enum
-- Idempotent. MUST be its own migration: Postgres allows ALTER TYPE ... ADD VALUE
-- inside a transaction (PG12+) but the new value cannot be USED until the
-- transaction commits — so the field that uses it lives in migration 074.
-- ============================================================

ALTER TYPE public.field_type ADD VALUE IF NOT EXISTS 'pass_fail';
