-- ============================================================
-- Migration 110: clear the auto-assigned report numbers on the June 2026 "N/A" jobs.
-- One-off data fix. Idempotent (matches 0 rows once cleared / on a fresh DB).
--
-- The June survey backlog was imported with report_number = NULL for the jobs the
-- source list marked "N/A". The BEFORE INSERT trigger (set_report_number, mig 042)
-- auto-assigns a number whenever one is NULL, so those jobs got low sequence numbers
-- (26-06-055 … 26-06-071) that don't belong to the real manual scheme (…149–177).
-- Those surveys legitimately carry no report number, so clear them back to NULL.
--
-- report_number is admin-guarded on UPDATE (enforce_job_admin_columns, mig 049), and
-- a migration connection has no auth.uid(), so we disable that guard trigger for the
-- duration of THIS transaction only. DISABLE/ENABLE are transactional and take an
-- ACCESS EXCLUSIVE lock, so no other session ever sees the guard off.
--
-- Scope: June 2026 jobs whose number is in the auto-range 26-06-0XX. All real June
-- numbers start at 1XX (149–177), so this targets exactly the mis-numbered imports.
-- ============================================================

ALTER TABLE public.jobs DISABLE TRIGGER jobs_admin_columns;

UPDATE public.jobs
   SET report_number = NULL
 WHERE scheduled_date >= '2026-06-01' AND scheduled_date <= '2026-06-30'
   AND report_number LIKE '26-06-0%';

ALTER TABLE public.jobs ENABLE TRIGGER jobs_admin_columns;
