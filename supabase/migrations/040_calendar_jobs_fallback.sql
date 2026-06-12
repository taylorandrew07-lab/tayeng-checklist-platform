-- ============================================================
-- Migration 040: Calendar shows ALL jobs, not just ones with a scheduled_date
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- get_calendar_jobs previously required scheduled_date IS NOT NULL, so jobs that
-- were created but never given a schedule date never appeared on the calendar.
-- Fall back to the creation date when scheduled_date is unset, so every job
-- shows up (on its scheduled day if set, otherwise the day it was created).
-- Archived jobs are excluded to keep the grid clean.
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_calendar_jobs(p_start DATE, p_end DATE)
RETURNS TABLE (
  id UUID, title TEXT, job_number TEXT, status TEXT, scheduled_date DATE,
  vessel_name TEXT, surveyor_name TEXT, client_name TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT j.id, j.title, j.job_number, j.status::text,
         COALESCE(j.scheduled_date, j.created_at::date) AS scheduled_date,
         j.vessel_name, j.surveyor_name, c.name
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  WHERE COALESCE(j.scheduled_date, j.created_at::date) BETWEEN p_start AND p_end
    AND j.status::text <> 'archived'
    AND (public.is_active_staff() OR public.has_office_permission('calendar.view'));
$$;
GRANT EXECUTE ON FUNCTION public.get_calendar_jobs(DATE, DATE) TO authenticated;
