-- ============================================================
-- Migration 158: report numbers — one source of truth (max + 1)
-- Run in Supabase SQL Editor (paste the WHOLE file). Idempotent.
--
-- THE BUG. New jobs were auto-numbered from public.report_counters.last_seq — a
-- per-fiscal-year counter incremented by next_report_number(). But the manual
-- "Number reports" fill tool (lib/jobs/tracker.ts → highestReportSeq/fillReportNumbers)
-- assigns numbers as ONE PAST THE HIGHEST EXISTING trailing NNN, straight off the
-- jobs table, and never touches the counter. So every number issued by the fill
-- tool (or typed in by hand) advanced the real series WITHOUT advancing the counter,
-- and the counter drifted far behind: with the real max at 26-07-220 the trigger
-- was still handing out 26-07-129. Mig 110 patched one symptom of the same drift.
--
-- THE FIX. Make the trigger use the SAME rule as the manual tool — one past the
-- highest trailing number across every issued report number — so auto-assign and
-- manual-fill can never diverge again. The report_counters sequence is retired for
-- report numbers (kept + realigned below so nothing that still reads it is stale).
--
-- Concurrency: two simultaneous inserts could otherwise read the same MAX and collide
-- on the uq_jobs_report_number unique index. A transaction-scoped advisory lock
-- serializes generation so the second insert re-reads the new max and gets the next
-- number cleanly.
-- ============================================================

CREATE OR REPLACE FUNCTION public.next_report_number()
RETURNS TEXT AS $$
DECLARE seq INTEGER;
BEGIN
  -- Serialize concurrent report-number generation (auto-released on commit).
  PERFORM pg_advisory_xact_lock(hashtext('jobs_report_number'));

  -- One past the highest trailing NNN across every issued report number (any
  -- format — dash 26-07-220 or legacy slash 26/03/050). Mirrors highestReportSeq()
  -- in lib/jobs/tracker.ts exactly, incl. tolerating trailing whitespace.
  SELECT COALESCE(MAX((substring(report_number FROM '(\d+)\s*$'))::int), 0) + 1
    INTO seq
    FROM public.jobs
   WHERE report_number ~ '\d\s*$';

  -- YY-MM from today (the issue month), NNN from the running series.
  RETURN to_char(NOW(), 'YY-MM-') || lpad(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Realign the (now-unused) counter to the real max so any lingering reader can't
-- hand out a stale low number. GREATEST keeps it monotonic; only ever raises it.
UPDATE public.report_counters c
   SET last_seq = GREATEST(
         c.last_seq,
         (SELECT COALESCE(MAX((substring(report_number FROM '(\d+)\s*$'))::int), 0)
            FROM public.jobs
           WHERE report_number ~ '\d\s*$')
       ),
       updated_at = NOW();
