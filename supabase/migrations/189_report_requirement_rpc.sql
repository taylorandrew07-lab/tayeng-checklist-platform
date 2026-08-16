-- ============================================================
-- Migration 189 — flipping "no report required" back ON must ISSUE a number.
--
-- THE BUG (two halves, both of them silent).
--
-- 1. UI: the "No report required" tick exists only on the two New Job forms, i.e.
--    at creation time. Once the job exists there is no report-number control on
--    the admin job page at all — the number is printed in the header subtitle and
--    an N/A job shows nothing whatsoever, so a job a surveyor accidentally marked
--    "no report" looks identical to one that simply has not been numbered yet, and
--    there is no visible way to undo it. (The mig-154 comment claiming the toggle
--    "already exists on both the New Job form and the job page" was wrong; the
--    only post-creation control is the #/N/A <select> in the jobs-grid Report #
--    column, which is easy to miss and does not fix half 2.)
--
-- 2. DATA: set_report_number (mig 042, last rewritten by mig 186) is BEFORE
--    INSERT ONLY. So clearing report_not_required on an existing job does NOT
--    issue a number — it merely moves the job into the "missing a report number"
--    bucket. The number then has to come from the bulk "Number reports" modal,
--    which formats YY-MM-NNN off the JOB's date via fillReportNumbers(), while the
--    trigger formats off TODAY's date via next_report_number(). Two formatters for
--    one series is exactly the drift mig 158 was written to end.
--
-- THE FIX: one admin-only RPC that owns both directions of the flag and, when a
-- report becomes required, issues the number from the single source
-- (next_report_number(), mig 158) inside the same transaction — so it holds that
-- function's advisory lock and cannot collide on uq_jobs_report_number.
--
-- Deliberately an RPC rather than a plain UPDATE from the client: mig 049 revoked
-- EXECUTE on next_report_number() from authenticated, and the read-max/write-number
-- pair must be atomic.
-- ============================================================

-- Mirrors typeSkipsReportNumber() in lib/jobs/reportPolicy.ts and the predicate
-- inside set_report_number() (mig 186 §6). Change one, change all three.
CREATE OR REPLACE FUNCTION public.type_skips_report_number(p_job_type TEXT, p_job_stage TEXT)
RETURNS BOOLEAN AS $$
  SELECT p_job_type = 'Ultrasonic Hatch Testing'
      OR (p_job_type = 'Draught Survey' AND p_job_stage IN ('Initial', 'Interim'));
$$ LANGUAGE sql IMMUTABLE;

-- p_required = true  -> report_not_required := false, and issue a number if none.
-- p_required = false -> report_not_required := true, dropping the number.
--
-- p_release_number is the deliberate-act gate on that second direction: a number
-- that was actually ISSUED is never withdrawn by accident (Andrew's rule, mig 186
-- §6 — reports already sent to clients must keep matching the app), so a caller
-- has to say out loud that it means to give the number back. The callers ask the
-- admin to confirm, naming the number, before passing true.
--
-- Returns the job's resulting report_number (NULL when it is now N/A).
--
-- Not gated on job_is_open(): an admin fixing a mis-flagged job after it was
-- invoiced is precisely the case this exists for, and the lock in mig 117 freezes
-- SURVEYOR writes, not admin ones.
CREATE OR REPLACE FUNCTION public.set_job_report_requirement(
  p_job_id         UUID,
  p_required       BOOLEAN,
  p_release_number BOOLEAN DEFAULT false
)
RETURNS TEXT AS $$
DECLARE
  v_job  public.jobs%ROWTYPE;
  v_num  TEXT;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can change whether a job carries a report number';
  END IF;

  SELECT * INTO v_job FROM public.jobs WHERE id = p_job_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Job % does not exist', p_job_id;
  END IF;

  IF NOT p_required THEN
    IF v_job.report_number IS NOT NULL AND NOT p_release_number THEN
      RAISE EXCEPTION 'Job % already carries report number % — releasing it has to be confirmed',
        p_job_id, v_job.report_number;
    END IF;
    -- report_number back to NULL, not a literal 'N/A': the flag is what the app
    -- reads, and uq_jobs_report_number would collide on the second such job.
    UPDATE public.jobs
       SET report_not_required = true, report_number = NULL
     WHERE id = p_job_id;
    RETURN NULL;
  END IF;

  -- Going to "report required".
  IF public.type_skips_report_number(v_job.job_type, v_job.job_stage) THEN
    RAISE EXCEPTION
      'A % % never carries a report number — only the Final of a draught-survey voyage does',
      COALESCE(v_job.job_stage, ''), COALESCE(v_job.job_type, 'job');
  END IF;

  v_num := v_job.report_number;
  IF v_num IS NULL THEN
    v_num := public.next_report_number();   -- advisory-locked for this transaction
  END IF;

  UPDATE public.jobs
     SET report_not_required = false,
         report_number       = v_num
   WHERE id = p_job_id;

  RETURN v_num;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- An earlier draft of this file shipped the two-argument form; drop it so the
-- default-argument overload can never be ambiguous.
DROP FUNCTION IF EXISTS public.set_job_report_requirement(UUID, BOOLEAN);

REVOKE ALL ON FUNCTION public.set_job_report_requirement(UUID, BOOLEAN, BOOLEAN) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_job_report_requirement(UUID, BOOLEAN, BOOLEAN) TO authenticated;

-- ── Verify (run by hand in the SQL editor; CI green /= migration applied) ──────
-- SELECT public.type_skips_report_number('Draught Survey','Interim');   -- true
-- SELECT public.type_skips_report_number('Hire Survey','Off-hire');     -- false
--
-- -- Jobs sitting on N/A that arguably should not be:
-- SELECT id, title, job_type, job_stage, scheduled_date
--   FROM public.jobs
--  WHERE report_not_required
--    AND report_number IS NULL
--    AND NOT public.type_skips_report_number(job_type, job_stage)
--  ORDER BY scheduled_date DESC;
