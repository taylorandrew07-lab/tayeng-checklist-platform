-- ============================================================
-- Migration 103: rename the Borescoping "Video Link" field to "Photos & Video Link"
-- Run via the db-migrate runner. Idempotent.
--
-- The per-line link can point to BOTH photos and video on the Synology NAS, so a
-- surveyor can choose to link the media instead of embedding photos in the report
-- (saving Supabase storage). Label/help reflect that.
-- ============================================================

UPDATE public.template_fields
   SET label = 'Photos & Video Link',
       help_text = 'Paste the Synology link to this line''s photos / video (use this instead of uploading photos to save storage, or in addition).'
 WHERE id = 'b0235c09-0000-4000-8000-000000000019';
