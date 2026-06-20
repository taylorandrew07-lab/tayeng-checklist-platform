-- ============================================================
-- Migration 071: Server-side upload caps on the cargo-photos bucket
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent. Safe.
--
-- The cargo-photos bucket (migration 027) was created without a file_size_limit
-- or allowed_mime_types, unlike the other buckets which got caps in migration 049
-- (personal-documents, job-files). This brings it in line: images only, with a
-- size cap. Supabase Storage enforces these at the API regardless of what the
-- browser claims, so it's defense-in-depth on top of the existing "active staff
-- only" write policy.
--
-- Image-only on purpose (these are camera photos): jpeg/png/webp, and SVG is
-- deliberately excluded (SVG can carry script). Cargo photos are compressed
-- client-side before upload, so 15 MB is a generous ceiling.
--
-- ROLLBACK (restore no caps):
--   UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
--   WHERE id = 'cargo-photos';
-- ============================================================

UPDATE storage.buckets
  SET file_size_limit = 15728640,  -- 15 MB
      allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp']
  WHERE id = 'cargo-photos';
