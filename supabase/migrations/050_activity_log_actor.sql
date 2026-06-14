-- ============================================================
-- Migration 050: Trustworthy activity-log actor (audit finding #8, partial)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- The activity log was forgeable: a staff member could insert a row claiming any
-- actor_id. This forces actor_id to the REAL authenticated user on insert, so
-- "who did it" can be trusted. (Service-role/cron inserts, where auth.uid() is
-- null, keep whatever actor they pass.) Full action/entity validation is a larger
-- change tracked separately.
-- ============================================================

CREATE OR REPLACE FUNCTION public.enforce_activity_actor()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    NEW.actor_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS activity_log_actor ON public.activity_log;
CREATE TRIGGER activity_log_actor BEFORE INSERT ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.enforce_activity_actor();
