-- ============================================================
-- Migration 030: Enable Supabase Realtime on jobs (live dashboards)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Lets dashboards receive live INSERT/UPDATE/DELETE events for jobs so a newly
-- started (in-progress) checklist appears on other entitled users' screens within
-- seconds. RLS still governs which rows each user receives — Realtime respects the
-- existing jobs policies, so nobody sees a job they couldn't see when submitted.
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'jobs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.jobs;
  END IF;
END $$;
