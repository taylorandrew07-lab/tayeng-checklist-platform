-- ============================================================
-- Migration 091: link the OVID "Commissioning company" field to clients
-- Run via the db-migrate runner. Idempotent. Depends on 090 (client_select enum).
--
-- The commissioning company is usually one of our existing clients, so switch that
-- field from plain text to the client-linked picker (datalist of clients, still
-- free-text). Existing stored values are plain names and keep rendering unchanged.
--
-- (The surveyed CLIENT itself isn't a checklist field — it comes from the job
-- record and now prints in the report header, so it's no longer "missing".)
-- ============================================================

UPDATE public.template_fields
   SET field_type = 'client_select'
 WHERE id = '0a1d0000-0000-4000-8000-000000000005';
