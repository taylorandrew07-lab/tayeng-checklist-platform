-- ============================================================================
-- 162 — Job report reminders
--
-- WHY: a report often can't be written the moment the survey ends — fuel-loadout
-- samples incubate for ~72h (plus travel), and other job types have their own
-- lag. Until now nothing tracked that, so a job could sit finished-but-unwritten
-- indefinitely and the only safeguard was Andrew remembering.
--
-- WHAT: a generic, per-job "report due" reminder.
--   * job_types.reminder_hours  — the DEFAULT delay for that type (NULL = never).
--   * jobs.reminder_hours       — the delay for THIS job. Copied from the type at
--                                 creation, then independently editable. NULL = off.
--   * jobs.reminder_base_at     — trigger-computed clock start.
--   * jobs.reminder_due_at      — trigger-computed base + hours (RAW: the
--                                 office-hours window is applied by the app, not here).
--   * jobs.reminder_sent_at     — idempotency latch. Set once; never re-fires.
--
-- The delay is COPIED onto the job at creation rather than resolved by a live
-- join, for two reasons: jobs.job_type is plain TEXT and not an FK, and copying
-- means editing a job type's default can never silently re-arm historical jobs.
-- It also makes "off" unambiguous — jobs.reminder_hours IS NULL means off, with
-- no inherit-vs-override ambiguity to resolve at read time.
--
-- Idempotent; safe to re-run in the Supabase SQL Editor.
-- ============================================================================

-- Guards against the forward-reference abort documented in CLAUDE.md.
--
-- LOCAL IS REQUIRED, not stylistic. scripts/db-migrate.mjs opens ONE pg.Client and
-- loops begin/<file>/commit over every pending migration on that same session
-- (scripts/db-migrate.mjs:68-92), so a bare SET is session-scoped and SURVIVES the
-- COMMIT — silently disabling body validation for every migration applied after it
-- in the same run. Migration 159 has that latent bug; do not copy it.
SET LOCAL check_function_bodies = off;

-- ── 1. Per-job-type default delay ───────────────────────────────────────────
ALTER TABLE public.job_types
  ADD COLUMN IF NOT EXISTS reminder_hours INTEGER;

COMMENT ON COLUMN public.job_types.reminder_hours IS
  'Default hours after the clock starts before a "report due" reminder fires for jobs of this type. NULL = this type never reminds. Copied onto each new job; changing it does not affect existing jobs.';

ALTER TABLE public.job_types DROP CONSTRAINT IF EXISTS job_types_reminder_hours_chk;
ALTER TABLE public.job_types ADD CONSTRAINT job_types_reminder_hours_chk
  CHECK (reminder_hours IS NULL OR (reminder_hours > 0 AND reminder_hours <= 8760));

-- ── 1b. A surveyor may add a job type, but not set its reminder policy ──────
-- Migration 150 added "Staff add job types" (FOR INSERT WITH CHECK is_active_staff())
-- so the surveyor New Job form's "+ Add job type" works. RLS cannot gate a COLUMN
-- (the standing rule in CLAUDE.md), so without this a surveyor could create a type
-- carrying any reminder default. Forced silently to NULL rather than raised, so
-- that form keeps working exactly as it does today.
CREATE OR REPLACE FUNCTION public.job_types_guard_reminder_default()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (public.is_admin() OR public.is_super_admin()) THEN
    NEW.reminder_hours := CASE WHEN TG_OP = 'UPDATE' THEN OLD.reminder_hours ELSE NULL END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS job_types_guard_reminder ON public.job_types;
CREATE TRIGGER job_types_guard_reminder
  BEFORE INSERT OR UPDATE ON public.job_types
  FOR EACH ROW EXECUTE FUNCTION public.job_types_guard_reminder_default();

-- ── 2. Per-job reminder state ───────────────────────────────────────────────
ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS reminder_hours   INTEGER,
  ADD COLUMN IF NOT EXISTS reminder_base_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_due_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.jobs.reminder_hours   IS 'Hours after reminder_base_at before this job''s report reminder fires. NULL = no reminder. Seeded from job_types.reminder_hours at creation; admin-editable per job.';
COMMENT ON COLUMN public.jobs.reminder_base_at IS 'Trigger-computed clock start: the EARLIER of submitted_at (marked complete) and 17:00 Trinidad local on end_date/scheduled_date.';
COMMENT ON COLUMN public.jobs.reminder_due_at  IS 'Trigger-computed reminder_base_at + reminder_hours. RAW — the Mon-Fri office-hours window is applied by the app (lib/jobs/reminderWindow.ts), not stored here.';
COMMENT ON COLUMN public.jobs.reminder_sent_at IS 'Set when the reminder was delivered to the inbox. Idempotency latch — a job is never reminded twice. Cleared automatically if reminder_hours is changed.';

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_reminder_hours_chk;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_reminder_hours_chk
  CHECK (reminder_hours IS NULL OR (reminder_hours > 0 AND reminder_hours <= 8760));

-- ── 3. Derive base + due on every write ─────────────────────────────────────
-- NOTE ON LEAST(): Postgres LEAST/GREATEST IGNORE nulls (unlike the SQL standard
-- aggregates), returning NULL only when every argument is NULL. That is exactly
-- the "whichever comes first, if either exists" semantics wanted here, so no
-- COALESCE-to-infinity dance is needed.
--
-- The end-date branch needs a time of day (end_date is a DATE). It uses the END of
-- that day, 23:59 Trinidad local, NOT an earlier "end of survey day" guess. That
-- matters because of LEAST(): with an earlier assumption like 17:00, a job
-- completed at 20:00 on its own end date would take 17:00 as its base and start
-- the clock three hours BEFORE the surveyor actually finished. Using end-of-day
-- means a real completion almost always wins, and the end_date branch does what it
-- is actually there for — catching a job nobody ever marked complete.
-- America/Port_of_Spain is UTC-4 fixed with no DST, so this is stable year-round.
CREATE OR REPLACE FUNCTION public.jobs_set_reminder_due()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_end_local TIMESTAMPTZ;
BEGIN
  -- Changing the delay re-arms the job: the old "already told you" latch no
  -- longer describes the new schedule.
  IF TG_OP = 'UPDATE' AND NEW.reminder_hours IS DISTINCT FROM OLD.reminder_hours THEN
    NEW.reminder_sent_at := NULL;
  END IF;

  IF NEW.reminder_hours IS NULL THEN
    NEW.reminder_base_at := NULL;
    NEW.reminder_due_at  := NULL;
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.end_date, NEW.scheduled_date) IS NOT NULL THEN
    v_end_local := (COALESCE(NEW.end_date, NEW.scheduled_date)::timestamp + TIME '23:59')
                     AT TIME ZONE 'America/Port_of_Spain';
  END IF;

  NEW.reminder_base_at := LEAST(NEW.submitted_at, v_end_local);

  IF NEW.reminder_base_at IS NULL THEN
    NEW.reminder_due_at := NULL;           -- nothing to count from yet
  ELSE
    NEW.reminder_due_at := NEW.reminder_base_at + make_interval(hours => NEW.reminder_hours);
  END IF;

  RETURN NEW;
END;
$$;

-- TRIGGER NAME IS LOAD-BEARING. Postgres fires BEFORE row triggers in NAME order.
-- Migration 145 relies on this: jobs_aa_normalize_workflow sorts ahead of
-- jobs_admin_columns / jobs_admin_paid_closed / trg_enforce_surveyor_job_update so
-- those guards see a normalized status. 'jobs_ab_' sorts after 'jobs_aa_' and
-- before 'jobs_admin_', so this trigger runs on a normalized row and the guards
-- below see the columns it just wrote — which is why reminder_base_at /
-- reminder_due_at / reminder_sent_at must NOT be added to the admin denylist in
-- section 5 (a surveyor completing their own job legitimately moves all three).
DROP TRIGGER IF EXISTS jobs_ab_reminder_due ON public.jobs;
CREATE TRIGGER jobs_ab_reminder_due
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_set_reminder_due();

-- Backfill the derived columns for any row that already carries a delay. On a
-- fresh apply this matches nothing (no job has reminder_hours yet), which is the
-- deliberate first-run flood guard: no historical job can suddenly come due.
UPDATE public.jobs SET reminder_hours = reminder_hours WHERE reminder_hours IS NOT NULL;

-- ── 4. Index for the cron's exact predicate ─────────────────────────────────
CREATE INDEX IF NOT EXISTS jobs_reminder_due_idx
  ON public.jobs (reminder_due_at)
  WHERE reminder_sent_at IS NULL AND reminder_due_at IS NOT NULL;

-- ── 5. Let the app itself send an inbox message ─────────────────────────────
-- The reminder comes from the system, not from a person, so it has no sender.
-- messages.sender_id was NOT NULL (mig 037) — which was already inconsistent with
-- its own ON DELETE SET NULL. Dropping NOT NULL makes a senderless system message
-- possible; lib/messages/api.ts already types sender_id as nullable and falls back
-- when the join misses, so nothing downstream changes. A NULL sender also keeps
-- these out of every user's Sent folder (listSent filters on sender_id = me),
-- which is why the cron does NOT just address the message from Andrew to himself.
ALTER TABLE public.messages ALTER COLUMN sender_id DROP NOT NULL;

-- ── 6. Surveyors may not change the delay ───────────────────────────────────
-- Re-issued from the migration-148 body (which added labour_unit) with
-- reminder_hours appended. This guard is a DENYLIST: it raises only on the
-- columns it names, so simply ADDING columns to jobs never breaks surveyor
-- writes. Deliberately NOT listed here:
--   * reminder_base_at / reminder_due_at — written by the section-3 trigger on a
--     surveyor's own "mark complete" update; listing them would break completeJob().
--   * reminder_sent_at — written by the reminder cron, which runs as the SERVICE
--     ROLE. Service role bypasses RLS but NOT triggers, and auth.uid() is NULL
--     there so public.is_admin() is FALSE — listing it would make the cron's own
--     write raise. Worst case a surveyor clears it and one extra nudge is sent.
CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- A non-admin may not move a job out of the locked financial state.
  IF OLD.workflow_status = 'closed'
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    RAISE EXCEPTION 'Only an administrator can re-open a closed job';
  END IF;

  IF NEW.report_number      IS DISTINCT FROM OLD.report_number
     OR NEW.report_approved_at IS DISTINCT FROM OLD.report_approved_at
     OR NEW.report_approved_by IS DISTINCT FROM OLD.report_approved_by
     OR NEW.paid_at            IS DISTINCT FROM OLD.paid_at
     OR NEW.closed_at          IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by          IS DISTINCT FROM OLD.closed_by
     OR NEW.labour_unit        IS DISTINCT FROM OLD.labour_unit
     OR NEW.reminder_hours     IS DISTINCT FROM OLD.reminder_hours THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
