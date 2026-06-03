-- ============================================================
-- Migration 022: Client logos
-- Run in Supabase SQL Editor. Idempotent.
--
-- Adds a logo to clients and a public storage bucket to hold the images.
-- ============================================================

-- Column to store the logo's storage path (e.g. '<uuid>-logo.png').
ALTER TABLE clients ADD COLUMN IF NOT EXISTS logo_path TEXT;

-- Public bucket for client logos (small images, served via public URL on
-- reports and the client portal). 2 MB limit; common image types incl. SVG.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'client-logos', 'client-logos', true, 2097152,
  ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = true,
  file_size_limit = 2097152,
  allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];

-- Read: public bucket, so anyone may read the objects.
DROP POLICY IF EXISTS "Public can read client logos" ON storage.objects;
CREATE POLICY "Public can read client logos"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'client-logos');

-- Write/delete: active admins only.
DROP POLICY IF EXISTS "Admins manage client logos" ON storage.objects;
CREATE POLICY "Admins manage client logos"
  ON storage.objects FOR ALL
  USING (
    bucket_id = 'client-logos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  )
  WITH CHECK (
    bucket_id = 'client-logos'
    AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );
