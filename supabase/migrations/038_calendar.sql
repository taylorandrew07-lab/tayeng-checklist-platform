-- ============================================================
-- Migration 038: Permission-based shared calendar
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- The calendar aggregates TWO sources:
--   1. Jobs (read live from the jobs table via get_calendar_jobs — never copied).
--      Per the product decision, every active staff member (and office with the
--      calendar permission) can see the WHOLE job schedule, but only the safe
--      scheduling fields — NOT internal_notes or other sensitive columns.
--   2. calendar_events — leave requests + admin-created general events.
--
-- Visibility (enforced in RLS, never the client):
--   * leave   : the requester (owner_id) + admins ONLY. Other surveyors see
--               nothing. Surveyors create their own as 'pending'; admins approve.
--   * general : admins create them and choose the audience —
--                 'everyone' | 'roles' (visible_roles) | 'users' (visible_user_ids)
-- ============================================================

-- ------------------------------------------------------------
-- 1. calendar_events
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.calendar_events (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_type       TEXT NOT NULL CHECK (event_type IN ('leave','general')),
  title            TEXT NOT NULL,
  description      TEXT,
  start_date       DATE NOT NULL,
  end_date         DATE NOT NULL,
  owner_id         UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status           TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected')),
  visibility       TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private','everyone','roles','users')),
  visible_roles    TEXT[] NOT NULL DEFAULT '{}',
  visible_user_ids UUID[] NOT NULL DEFAULT '{}',
  color            TEXT,
  reviewer_id      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  review_comment   TEXT,
  reviewed_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_calendar_events_dates ON public.calendar_events (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_calendar_events_owner ON public.calendar_events (owner_id);

DROP TRIGGER IF EXISTS update_calendar_events_updated_at ON public.calendar_events;
CREATE TRIGGER update_calendar_events_updated_at
  BEFORE UPDATE ON public.calendar_events
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ------------------------------------------------------------
-- 2. RLS
-- ------------------------------------------------------------
ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

-- SELECT: admins see all; you always see your own; general events follow their
-- audience. Leave is never visible to anyone but its owner + admins.
DROP POLICY IF EXISTS "Read calendar events by visibility" ON public.calendar_events;
CREATE POLICY "Read calendar events by visibility" ON public.calendar_events
  FOR SELECT USING (
    public.is_admin()
    OR owner_id = auth.uid()
    OR (event_type = 'general' AND (
         visibility = 'everyone'
         OR (visibility = 'roles' AND public.get_my_role() = ANY(visible_roles))
         OR (visibility = 'users' AND auth.uid() = ANY(visible_user_ids))
       ))
  );

-- INSERT: admins create anything; active staff may file their OWN leave as pending.
DROP POLICY IF EXISTS "Create calendar events" ON public.calendar_events;
CREATE POLICY "Create calendar events" ON public.calendar_events
  FOR INSERT WITH CHECK (
    public.is_admin()
    OR (
      event_type = 'leave' AND status = 'pending'
      AND owner_id = auth.uid() AND created_by = auth.uid()
      AND public.is_active_staff()
    )
  );

-- UPDATE: admins edit/approve anything; an owner may edit their OWN leave only
-- while it is still pending (and cannot self-approve — status must stay pending).
DROP POLICY IF EXISTS "Admins update calendar events" ON public.calendar_events;
CREATE POLICY "Admins update calendar events" ON public.calendar_events
  FOR UPDATE USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Owners update own pending leave" ON public.calendar_events;
CREATE POLICY "Owners update own pending leave" ON public.calendar_events
  FOR UPDATE
  USING (owner_id = auth.uid() AND event_type = 'leave' AND status = 'pending')
  WITH CHECK (owner_id = auth.uid() AND event_type = 'leave' AND status = 'pending');

-- DELETE: admins delete anything; an owner may cancel their own pending leave.
DROP POLICY IF EXISTS "Delete calendar events" ON public.calendar_events;
CREATE POLICY "Delete calendar events" ON public.calendar_events
  FOR DELETE USING (
    public.is_admin()
    OR (owner_id = auth.uid() AND event_type = 'leave' AND status = 'pending')
  );

-- ------------------------------------------------------------
-- 3. Job feed — safe scheduling fields for the whole team. SECURITY DEFINER so
--    it can read across all jobs, but it only returns non-sensitive columns and
--    only to active staff or office users holding calendar.view.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_calendar_jobs(p_start DATE, p_end DATE)
RETURNS TABLE (
  id UUID, title TEXT, job_number TEXT, status TEXT, scheduled_date DATE,
  vessel_name TEXT, surveyor_name TEXT, client_name TEXT
)
LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public AS $$
  SELECT j.id, j.title, j.job_number, j.status::text, j.scheduled_date,
         j.vessel_name, j.surveyor_name, c.name
  FROM public.jobs j
  LEFT JOIN public.clients c ON c.id = j.client_id
  WHERE j.scheduled_date IS NOT NULL
    AND j.scheduled_date BETWEEN p_start AND p_end
    AND (public.is_active_staff() OR public.has_office_permission('calendar.view'));
$$;
GRANT EXECUTE ON FUNCTION public.get_calendar_jobs(DATE, DATE) TO authenticated;

-- ------------------------------------------------------------
-- 4. Office permission key: view the calendar (read-only).
-- ------------------------------------------------------------
INSERT INTO public.office_permission_catalog (key, label, description, category) VALUES
  ('calendar.view', 'View calendar', 'View the shared team calendar (jobs + visible events). Read-only.', 'calendar')
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description, category = EXCLUDED.category;
