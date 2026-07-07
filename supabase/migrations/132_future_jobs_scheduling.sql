-- ============================================================
-- Migration 132: Future Jobs — scheduling times, provenance, double-booking guard
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- Adds optional time-of-day to jobs (start_time/end_time) so a job describes a
-- real window, not just a day, plus a `source` provenance field (manual today;
-- whatsapp/email/ai when the AI intake seam lands later). Introduces
-- surveyor_job_conflicts() to detect when the same surveyor is booked on two
-- overlapping jobs (warn-but-allow in the UI), and extends get_calendar_jobs()
-- to carry end_date + times so the calendar can span multi-day jobs and label
-- their hours.
--
-- Time model: start_time/end_time are bare wall-clock TIME, compared naively.
-- Correct because Trinidad (America/Port_of_Spain) has no DST — matches the
-- existing timezone-free string math in lib/jobs/tracker.ts (shiftHours). Do NOT
-- switch these to timestamptz.
-- ============================================================

-- 1. Additive columns on jobs -------------------------------------------------
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME,
  ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

-- Guard the CHECK so re-running the file doesn't error.
DO $$ BEGIN
  ALTER TABLE public.jobs
    ADD CONSTRAINT jobs_source_check CHECK (source IN ('manual','whatsapp','email','ai'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. Double-booking detection -------------------------------------------------
-- Returns the caller-surveyor's OTHER live jobs whose [start,end] window overlaps
-- the probe window. Composes a timestamp range from date + time, defaulting a
-- missing start to 00:00 and a missing end to 23:59 (a time-less job spans the
-- whole day(s) — an all-day booking). Joins job_surveyors so it also catches
-- SECONDARY surveyors, not just jobs.assigned_to. SECURITY DEFINER so an admin
-- assigning surveyor X can see X's clashing jobs regardless of row visibility;
-- staff-gated internally.
DROP FUNCTION IF EXISTS public.surveyor_job_conflicts(uuid, date, date, time, time, uuid);
CREATE OR REPLACE FUNCTION public.surveyor_job_conflicts(
  p_surveyor    uuid,
  p_date        date,
  p_end_date    date,
  p_start_time  time,
  p_end_time    time,
  p_exclude_job uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid, title text, job_number text, vessel_name text,
  scheduled_date date, end_date date, start_time time, end_time time,
  workflow_status text
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  WITH probe AS (
    SELECT tsrange(
      p_date + COALESCE(p_start_time, time '00:00'),
      COALESCE(p_end_date, p_date) + COALESCE(p_end_time, time '23:59'),
      '[]') AS r
  )
  SELECT j.id, j.title, j.job_number, j.vessel_name,
         j.scheduled_date, j.end_date, j.start_time, j.end_time,
         j.workflow_status::text
  FROM public.jobs j
  JOIN public.job_surveyors js ON js.job_id = j.id AND js.surveyor_id = p_surveyor
  CROSS JOIN probe
  WHERE j.scheduled_date IS NOT NULL
    AND (p_exclude_job IS NULL OR j.id <> p_exclude_job)
    AND j.workflow_status <> 'closed'
    AND tsrange(
          j.scheduled_date + COALESCE(j.start_time, time '00:00'),
          COALESCE(j.end_date, j.scheduled_date) + COALESCE(j.end_time, time '23:59'),
          '[]') && probe.r
    AND public.is_active_staff();
$$;
REVOKE EXECUTE ON FUNCTION public.surveyor_job_conflicts(uuid,date,date,time,time,uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.surveyor_job_conflicts(uuid,date,date,time,time,uuid) TO authenticated;

-- 3. Calendar feed — carry end_date + times so the grid can span and label -----
-- The RETURNS TABLE column list changes, so CREATE OR REPLACE won't work
-- ("cannot change return type"); drop first, then recreate. Carries forward the
-- mig-059 body (workflow_status returned as `status`, created_at fallback,
-- exclude closed, staff-or-calendar.view gate).
DROP FUNCTION IF EXISTS public.get_calendar_jobs(date, date);
CREATE OR REPLACE FUNCTION public.get_calendar_jobs(p_start DATE, p_end DATE)
RETURNS TABLE (
  id UUID, title TEXT, job_number TEXT, status TEXT, scheduled_date DATE,
  end_date DATE, start_time TIME, end_time TIME,
  vessel_name TEXT, surveyor_name TEXT, client_name TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT j.id, j.title, j.job_number, j.workflow_status::text,
         COALESCE(j.scheduled_date, j.created_at::date) AS scheduled_date,
         j.end_date, j.start_time, j.end_time,
         j.vessel_name, j.surveyor_name, c.name
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  -- A job overlaps the visible window if its span [start, end] intersects it.
  WHERE COALESCE(j.end_date, COALESCE(j.scheduled_date, j.created_at::date)) >= p_start
    AND COALESCE(j.scheduled_date, j.created_at::date) <= p_end
    AND j.workflow_status <> 'closed'
    AND (public.is_active_staff() OR public.has_office_permission('calendar.view'));
$$;
REVOKE EXECUTE ON FUNCTION public.get_calendar_jobs(date, date) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_calendar_jobs(date, date) TO authenticated;

-- 4. Keep the conflict join cheap as the table grows --------------------------
CREATE INDEX IF NOT EXISTS idx_jobs_scheduled_date ON public.jobs (scheduled_date);
