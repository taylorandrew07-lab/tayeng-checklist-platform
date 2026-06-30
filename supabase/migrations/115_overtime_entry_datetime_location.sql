-- ============================================================
-- Migration 115: overtime entries become a true start→stop record. Idempotent.
--
-- A surveyor's overtime can begin on one day and finish on the next (or run over
-- several days). Until now an entry stored a single date + start/end time and leaned
-- on a "roll past midnight" trick, which forced the guys to split one shift into two
-- (e.g. 27/06 08:00–23:59 + 28/06 00:01–02:00). Each entry now records:
--   - entry_date  : the START date (unchanged)
--   - start_time  : the START time
--   - end_date    : the STOP date  (NEW — may be a later day than entry_date)
--   - end_time    : the STOP time
--   - location    : where the surveyor was (Vessel / Shore / Jetty / free text) (NEW)
-- hours is recomputed from the full start→stop span, so a shift that crosses midnight
-- is one entry. The per-surveyor total still rolls into job_surveyors.overtime_hours,
-- so billing and the overtime report are unchanged.
-- ============================================================

ALTER TABLE public.job_surveyor_overtime ADD COLUMN IF NOT EXISTS end_date DATE;
ALTER TABLE public.job_surveyor_overtime ADD COLUMN IF NOT EXISTS location TEXT;

-- Backfill end_date for rows created under the old single-date model so their hours
-- still read correctly: a shift whose end_time was <= start_time crossed midnight, so
-- the stop fell on the next day; otherwise the stop was the same day.
UPDATE public.job_surveyor_overtime
   SET end_date = CASE
     WHEN start_time IS NOT NULL AND end_time IS NOT NULL AND end_time <= start_time
       THEN (entry_date + INTERVAL '1 day')::date
     ELSE entry_date
   END
 WHERE end_date IS NULL AND entry_date IS NOT NULL;
