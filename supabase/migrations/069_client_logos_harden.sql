-- ============================================================
-- Migration 069: Harden client-logos storage (no API listing, no SVG)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent. Safe.
--
-- The app reads client logos ONLY via the public object URL
-- (${SUPABASE_URL}/storage/v1/object/public/client-logos/<path> — see
-- src/app/(dashboard)/**/clients*), which works because the bucket is public and
-- does NOT depend on an RLS SELECT policy. So:
--
-- 1. Drop the broad "anyone may SELECT" policy on client-logos objects. Public URLs
--    keep serving images; what this removes is authenticated/anon API ENUMERATION
--    of the bucket's object rows (storage.objects listing).
-- 2. Remove image/svg+xml from the allowed MIME types — SVG can carry scripts and
--    is an XSS vector when opened directly from a public URL. Raster only.
--    (Existing SVG objects, if any, remain; no NEW svg can be uploaded. Re-encode
--     any current SVG logos to PNG via the admin clients UI.)
--
-- The admin write/delete policy and bucket publicness are unchanged.
--
-- ROLLBACK:
--   CREATE POLICY "Public can read client logos" ON storage.objects
--     FOR SELECT USING (bucket_id = 'client-logos');
--   UPDATE storage.buckets SET allowed_mime_types =
--     ARRAY['image/png','image/jpeg','image/svg+xml','image/webp'] WHERE id='client-logos';
-- ============================================================

DROP POLICY IF EXISTS "Public can read client logos" ON storage.objects;

UPDATE storage.buckets
  SET allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']
  WHERE id = 'client-logos';
