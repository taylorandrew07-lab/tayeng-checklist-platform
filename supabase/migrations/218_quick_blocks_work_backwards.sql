-- ============================================================
-- Migration 218: a quick block records the time it actually covers, working backwards
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- THE BEHAVIOUR. You finish a twenty-minute call, pick up the app and tap "Phone call"
-- twice. Those twenty minutes are in the PAST, so the blocks are laid backwards from the
-- moment of the first tap: the first covers [now-10, now], the second [now-20, now-10].
-- Two taps therefore describe one contiguous twenty-minute call that ended when you
-- reached for the phone — not two shapeless ten-minute entries dated "today".
--
-- HOW THE CHAIN KNOWS. Each tap looks for the EARLIEST quick block on this case created
-- in the last few minutes and starts where that one started. Outside that window it
-- begins again from now, so a call at 09:00 and another at 16:00 do not join up.
--
-- AND A BUG FOUND ON THE WAY. The old body used CURRENT_DATE, which is the DATABASE's
-- date — UTC. Trinidad is UTC-4, so anything tapped after 20:00 local was already being
-- dated TOMORROW, silently, and would then fall outside a claim whose cutoff was today.
-- Every timestamp below is Trinidad wall-clock, the same fixed-offset trick
-- lib/cargo/voyageDate.ts and lib/jobs/reminderWindow.ts use.
-- ============================================================

-- == 1. An attendance can carry the clock ====================================
-- Nullable: an attendance logged by hand is a duration ("two hours on Tuesday") and has
-- no clock times to record. minutes stays authoritative for every total either way.
ALTER TABLE public.case_attendances
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME;

COMMENT ON COLUMN public.case_attendances.start_time IS
  'Trinidad wall-clock start, when known. Set by the quick blocks, which work backwards from the tap. NULL for an attendance entered as a plain duration.';
COMMENT ON COLUMN public.case_attendances.end_time IS
  'Trinidad wall-clock end. May be EARLIER than start_time when a block runs back over midnight; minutes is the authority, not the clock arithmetic.';

-- == 2. The quick block ======================================================
DROP FUNCTION IF EXISTS public.case_add_quick_attendance(uuid, text, text);
CREATE OR REPLACE FUNCTION public.case_add_quick_attendance(
  p_case       UUID,
  p_kind       TEXT,
  p_client_ref TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  -- Trinidad has no DST, so a fixed offset is exact all year.
  v_now    TIMESTAMP := (now() AT TIME ZONE 'America/Port_of_Spain');
  v_end    TIMESTAMP;
  v_start  TIMESTAMP;
  v_id     UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can log case time';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = p_case) THEN
    RAISE EXCEPTION 'Case % does not exist', p_case;
  END IF;

  -- If this tap is part of a burst, begin where the earliest of that burst began, so the
  -- blocks lie end to end going backwards. The window is deliberately short: it is meant
  -- to catch "tap, tap, tap" for one call, not to join up two calls hours apart.
  SELECT (a.attended_on + a.start_time)
    INTO v_end
    FROM public.case_attendances a
   WHERE a.case_id = p_case
     AND a.client_ref IS NOT NULL
     AND a.start_time IS NOT NULL
     AND a.created_by = auth.uid()
     AND a.created_at > now() - INTERVAL '5 minutes'
   ORDER BY (a.attended_on + a.start_time) ASC
   LIMIT 1;

  IF v_end IS NULL THEN
    v_end := v_now;
  END IF;
  v_start := v_end - INTERVAL '10 minutes';

  INSERT INTO public.case_attendances
    (case_id, attendee_profile_id, attended_on, start_time, end_time, minutes,
     description, client_ref, created_by)
  VALUES
    (p_case, auth.uid(),
     -- Dated by when the work STARTED. A block that runs back over midnight belongs to
     -- the day it began, which is also the day a claim cutoff would expect to find it.
     v_start::date, v_start::time, v_end::time, 10,
     CASE p_kind WHEN 'call' THEN 'Phone call' WHEN 'email' THEN 'Email' ELSE 'Attendance' END,
     p_client_ref, auth.uid())
  -- The predicate is REQUIRED: uq_ca_client_ref is a PARTIAL unique index, and without
  -- it Postgres cannot infer the arbiter and rejects the statement outright.
  ON CONFLICT (client_ref) WHERE client_ref IS NOT NULL DO NOTHING;

  -- Whether we inserted or lost the race, the row for THIS tap is the one to return.
  SELECT a.id INTO v_id FROM public.case_attendances a WHERE a.client_ref = p_client_ref;
  RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.case_add_quick_attendance(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.case_add_quick_attendance(uuid, text, text) TO authenticated;

-- Sanity checks after running:
--   -- two taps in a row must lie end to end, ending about now (Trinidad):
--   -- SELECT attended_on, start_time, end_time, minutes FROM public.case_attendances
--   --  WHERE case_id = '<case>' ORDER BY attended_on DESC, start_time DESC;
--   -- expect e.g. 14:22-14:32 and 14:12-14:22, not two rows with no times at all.
--   SELECT (now() AT TIME ZONE 'America/Port_of_Spain')::date AS trinidad_today, CURRENT_DATE AS db_today;
