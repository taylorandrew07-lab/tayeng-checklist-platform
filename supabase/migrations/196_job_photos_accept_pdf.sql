-- ============================================================================
-- Migration 196: the job-photos bucket must accept a PDF
--
-- Since migration 184 the Pre-Hire Inspection asks the surveyor to ATTACH the
-- ship's particulars and the crew list (items 2.11 and 4.x) rather than
-- transcribe them, and the vessel almost always hands those over as a PDF. The
-- attachment input has said `accept="image/*,application/pdf"` ever since.
--
-- The bucket never agreed. Its allowed_mime_types was narrowed to the three
-- raster types by hand in the Supabase dashboard (migration 019 recommended it;
-- no migration ever recorded it), so Storage answered every PDF with
--
--     415 invalid_mime_type — "mime type application/pdf is not supported"
--
-- and the client, which cannot tell a refusal from a dropped request on a vessel,
-- queued the file on the device. It then sat there badged "Pending" — a state it
-- could never leave, because every retry hit the same 415.
--
-- HEIC/HEIF are deliberately still NOT accepted. The browser converts an iPhone
-- photo to JPEG before upload (lib/files/downscaleImage.ts), and letting a raw
-- HEIC into the bucket would hand one to the report renderer, which cannot embed
-- it. A conversion that fails is now reported to the surveyor instead of being
-- queued forever (JobChecklistEditor: permanentUploadRejection).
--
-- Size cap is unchanged at 25 MB.
-- Idempotent: a plain UPDATE of the bucket row.
-- ============================================================================

UPDATE storage.buckets
   SET allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
 WHERE id = 'job-photos';
