-- ============================================================
-- Migration 145: collapse the 9-state job workflow to 4. Idempotent.
-- Run in Supabase SQL Editor (paste the WHOLE file), or let the db-migrate
-- Action apply it on push.
--
--   new / assigned          -> in_progress    (set at job CREATION)
--   report_ready            -> report_ready   (surveyor SUBMIT; unchanged)
--   approved                -> invoice_ready  (admin FINISHES the report)
--   invoiced / sent / paid  -> closed         (an INVOICE was CREATED; this is
--                                              the state that LOCKS surveyor
--                                              edits via public.job_is_open)
--
-- Deleting an invoice reverts the job to invoice_ready, which unlocks surveyor
-- edits again (deliberate: it is the correction flow).
--
-- jobs.paid_at is retired — nothing writes it after this migration. Payment
-- state is not tracked on the job at all.
--
-- DEPLOY ORDER — this migration MUST land. The normalizer trigger in section 3
-- protects one direction only: an OLD client writing a retired value ('assigned',
-- 'invoiced') against the NEW constraint. It canNOT protect the NEW app writing
-- 'invoice_ready' against the OLD constraint — if the app ships and this migration
-- does not, every transition to Invoice ready fails with
-- 'violates check constraint "jobs_workflow_status_chk"'. That is exactly what
-- happened on the first attempt (the remap tripped the admin guards and the whole
-- migration rolled back). If you see that error in the app, check the db-migrate
-- Action first — the fix is to get this migration applied, not to change the app.
-- ============================================================

-- ── 0. Audit snapshot so the collapse is reversible ─────────────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS workflow_status_legacy TEXT;

-- The row remap below writes workflow_status ('invoice_ready'/'closed') and
-- closed_at, all of which are admin-guarded on UPDATE by enforce_job_admin_columns
-- (049/129) and enforce_admin_paid_closed (042). The migration runner is NOT an
-- admin session — is_admin() is false — so those guards raise "Only an
-- administrator can set this workflow status" and abort the whole migration.
-- Same transactional DISABLE TRIGGER pattern as migration 110. Re-enabled at the
-- end of section 2; each migration runs in its own transaction, so a failure
-- rolls the disable back with it and never leaves the guards off.
ALTER TABLE public.jobs DISABLE TRIGGER jobs_admin_columns;
ALTER TABLE public.jobs DISABLE TRIGGER jobs_admin_paid_closed;

UPDATE public.jobs
   SET workflow_status_legacy = workflow_status
 WHERE workflow_status_legacy IS NULL
   AND workflow_status IN ('new','assigned','approved','invoiced','sent','paid',
                           'report_uploaded','report_approved');

-- ── 1. Drop the CHECK first so the remap can't trip the old constraint ──────
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_workflow_status_chk;

-- ── 2. Row remap ────────────────────────────────────────────────────────────
UPDATE public.jobs SET workflow_status = 'in_progress'
 WHERE workflow_status IN ('new','assigned');

UPDATE public.jobs SET workflow_status = 'report_ready'
 WHERE workflow_status = 'report_uploaded';          -- pre-047 stragglers

UPDATE public.jobs SET workflow_status = 'invoice_ready'
 WHERE workflow_status IN ('approved','report_approved');

-- Stamp closed_at for the rows that become 'closed' here so the new lock state
-- has a coherent timestamp (best available: existing closed_at, else paid_at,
-- else updated_at, else created_at). closed_by stays NULL — never captured.
UPDATE public.jobs
   SET closed_at = COALESCE(closed_at, paid_at, updated_at, created_at)
 WHERE workflow_status IN ('invoiced','sent','paid');

UPDATE public.jobs SET workflow_status = 'closed'
 WHERE workflow_status IN ('invoiced','sent','paid');

-- Safety net: anything unexpected (hand-edited row, a value from the future)
-- falls back to the earliest state rather than blocking the ADD CONSTRAINT.
UPDATE public.jobs SET workflow_status = 'in_progress'
 WHERE workflow_status IS NULL
    OR workflow_status NOT IN ('in_progress','report_ready','invoice_ready','closed');

ALTER TABLE public.jobs ENABLE TRIGGER jobs_admin_columns;
ALTER TABLE public.jobs ENABLE TRIGGER jobs_admin_paid_closed;

-- ── 3. Normalizer: a stale client writing a retired value must not 500 ──────
CREATE OR REPLACE FUNCTION public.normalize_workflow_status(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'new'             THEN 'in_progress'
    WHEN 'assigned'        THEN 'in_progress'
    WHEN 'report_uploaded' THEN 'report_ready'
    WHEN 'approved'        THEN 'invoice_ready'
    WHEN 'report_approved' THEN 'invoice_ready'
    WHEN 'invoiced'        THEN 'closed'
    WHEN 'sent'            THEN 'closed'
    WHEN 'paid'            THEN 'closed'
    ELSE p
  END;
$$;

CREATE OR REPLACE FUNCTION public.jobs_normalize_workflow_status()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  NEW.workflow_status := COALESCE(public.normalize_workflow_status(NEW.workflow_status), 'in_progress');
  RETURN NEW;
END;
$$;

-- Postgres fires BEFORE row triggers in NAME order. This name sorts ahead of
-- jobs_admin_columns / jobs_admin_paid_closed / trg_enforce_surveyor_job_update
-- so those guards see the NORMALIZED value — otherwise a surveyor's stale bundle
-- writing 'assigned' would trip "Only an administrator can set this workflow
-- status" instead of landing harmlessly on the permitted 'in_progress'.
DROP TRIGGER IF EXISTS jobs_aa_normalize_workflow ON public.jobs;
CREATE TRIGGER jobs_aa_normalize_workflow
  BEFORE INSERT OR UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.jobs_normalize_workflow_status();

-- ── 4. The 4-state CHECK + the new default ─────────────────────────────────
ALTER TABLE public.jobs ADD CONSTRAINT jobs_workflow_status_chk
  CHECK (workflow_status IN ('in_progress','report_ready','invoice_ready','closed'));

ALTER TABLE public.jobs ALTER COLUMN workflow_status SET DEFAULT 'in_progress';

-- ── 5. RLS lock helper: 'paid' is no longer a job state (supersedes 117 + 134)
-- 'closed' is now stamped at INVOICE CREATION, so the surveyor-write lock lands
-- one step earlier than before. No gap is reintroduced — everything that used to
-- sit at invoiced/sent/paid is now 'closed'. A missing job still returns TRUE so
-- brand-new inserts are never wrongly blocked.
--
-- Every policy that AND-s public.job_is_open(...) calls it BY NAME (mig 117:
-- job_surveyors, job_surveyor_overtime, job_surveyor_km, job_field_values,
-- job_photos, job_signatures, job_attachments INSERT, storage.objects INSERT),
-- so replacing the function re-keys all of them. No policy rewrite needed.
CREATE OR REPLACE FUNCTION public.job_is_open(p_job UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.jobs j WHERE j.id = p_job AND j.workflow_status = 'closed'
  );
$$;

-- ── 6. Surveyor update guard (mig-134 body, 'paid' predicate dropped) ───────
CREATE OR REPLACE FUNCTION public.enforce_surveyor_job_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF get_my_role() = 'surveyor' THEN
    -- A surveyor working an unassigned job becomes its assignee (and name).
    IF OLD.assigned_to IS NULL AND NEW.workflow_status IN ('in_progress', 'report_ready') THEN
      NEW.assigned_to := auth.uid();
      IF NEW.surveyor_name IS NULL THEN
        NEW.surveyor_name := (SELECT full_name FROM public.profiles WHERE id = auth.uid());
      END IF;
    END IF;
    IF NEW.template_id IS DISTINCT FROM OLD.template_id
       OR NEW.client_id  IS DISTINCT FROM OLD.client_id
       OR NEW.job_number IS DISTINCT FROM OLD.job_number
       OR NEW.created_by IS DISTINCT FROM OLD.created_by
       OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           AND NOT (OLD.assigned_to IS NULL AND NEW.assigned_to = auth.uid())) THEN
      RAISE EXCEPTION 'Surveyors may not modify protected job fields';
    END IF;
    -- Billing mode: only while the job is open (not yet invoiced/closed), and
    -- never to/from 'fixed'.
    IF (NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
        OR NEW.is_overtime IS DISTINCT FROM OLD.is_overtime) THEN
      IF OLD.workflow_status = 'closed' THEN
        RAISE EXCEPTION 'This job has been invoiced and closed — billing can no longer be changed';
      END IF;
      IF NEW.billing_mode = 'fixed' OR OLD.billing_mode = 'fixed' THEN
        RAISE EXCEPTION 'Only admins may set fixed-price billing';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 7. Reopen guard (mig-129 body, 'paid' dropped from the locked set) ──────
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
     OR NEW.closed_by          IS DISTINCT FROM OLD.closed_by THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 8. Admin-only close guard (mig-042 body; 'paid' retired) ───────────────
-- Invoice creation now stamps 'closed'. Invoices are admin-only (RLS "Admins
-- manage invoices", mig 043) and the office Finance page renders InvoicesTable
-- read-only, so this guard does not block the invoicing path today. If office
-- users are ever granted invoice MANAGE, this guard and the §7 reopen guard must
-- be widened, or the close/revert routed through a SECURITY DEFINER RPC.
CREATE OR REPLACE FUNCTION public.enforce_admin_paid_closed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_status = 'closed'
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can close a job';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 9. Surveyor INSERT policy: 'new'/'assigned' no longer exist (was mig 059)
DROP POLICY IF EXISTS "Surveyors can create jobs from approved templates" ON public.jobs;
CREATE POLICY "Surveyors can create jobs from approved templates" ON public.jobs FOR INSERT
  WITH CHECK (
    public.get_my_role() = 'surveyor'
    AND created_by = (select auth.uid())
    AND assigned_to = (select auth.uid())
    AND workflow_status IN ('in_progress', 'report_ready')
    AND EXISTS (
      SELECT 1 FROM public.checklist_templates
      WHERE id = template_id AND allow_surveyor_start = true AND status = 'active'
    )
  );

-- ── 10. Analytics RPC (mig 107 body): 'approved' -> 'invoice_ready' ────────
-- Only the two job-status FILTER clauses change; every other clause (byType,
-- byMonth, topClients, overdueCount) is the mig-107 original verbatim.
CREATE OR REPLACE FUNCTION public.metrics_analytics(p_months_back int DEFAULT 12)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
WITH
j AS (
  SELECT id, job_type, client_id, workflow_status, is_overtime,
         COALESCE(scheduled_date, (created_at AT TIME ZONE 'America/Port_of_Spain')::date) AS eff_date
  FROM public.jobs
),
cur AS (SELECT date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain')::date)::date AS m),
kpis AS (
  SELECT jsonb_build_object(
    'totalJobs',       count(*),
    'openJobs',        count(*) FILTER (WHERE workflow_status <> 'closed'),
    'thisMonth',       count(*) FILTER (WHERE date_trunc('month', eff_date)::date = (SELECT m FROM cur)),
    'awaitingInvoice', count(*) FILTER (WHERE workflow_status = 'invoice_ready'
                          AND NOT EXISTS (SELECT 1 FROM public.invoices i WHERE i.job_id = j.id)),
    'otJobs',          count(*) FILTER (WHERE is_overtime),
    'overdueCount',    (SELECT count(*) FROM public.invoices i
                          WHERE i.status = 'overdue' OR (i.status = 'sent' AND i.due_date < current_date))
  ) AS data FROM j
),
by_type AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', t, 'count', c) ORDER BY c DESC, t), '[]'::jsonb) AS data
  FROM (SELECT COALESCE(NULLIF(job_type, ''), 'Unspecified') AS t, count(*) AS c FROM j GROUP BY 1) x
),
by_month AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('ym', to_char(m, 'YYYY-MM'), 'count', c) ORDER BY m), '[]'::jsonb) AS data
  FROM (
    SELECT date_trunc('month', eff_date)::date AS m, count(*) AS c
    FROM j
    WHERE eff_date >= (date_trunc('month', (now() AT TIME ZONE 'America/Port_of_Spain')::date)
                       - make_interval(months => GREATEST(p_months_back, 1) - 1))::date
    GROUP BY 1
  ) mm
),
jc AS (SELECT client_id, count(*) AS jobs FROM j WHERE client_id IS NOT NULL GROUP BY client_id),
rev AS (SELECT client_id, currency::text AS currency, sum(total) AS amount
        FROM public.invoices WHERE status <> 'void' AND client_id IS NOT NULL GROUP BY client_id, currency),
top_clients AS (
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'client_id', jc.client_id,
    'name',      COALESCE(c.name, 'Unknown'),
    'jobs',      jc.jobs,
    'revenue',   COALESCE((SELECT jsonb_agg(jsonb_build_object('currency', r.currency, 'amount', r.amount))
                           FROM rev r WHERE r.client_id = jc.client_id), '[]'::jsonb)
  ) ORDER BY jc.jobs DESC), '[]'::jsonb) AS data
  FROM jc LEFT JOIN public.clients c ON c.id = jc.client_id
)
SELECT jsonb_build_object(
  'kpis',       (SELECT data FROM kpis),
  'byType',     (SELECT data FROM by_type),
  'byMonth',    (SELECT data FROM by_month),
  'topClients', (SELECT data FROM top_clients)
);
$$;

REVOKE EXECUTE ON FUNCTION public.metrics_analytics(int) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.metrics_analytics(int) TO authenticated;

-- ── 11. Verify (run these after) ───────────────────────────────────────────
-- SELECT workflow_status, count(*) FROM public.jobs GROUP BY 1 ORDER BY 1;
--   -> only in_progress / report_ready / invoice_ready / closed
-- SELECT count(*) FROM public.jobs WHERE workflow_status_legacy IS NOT NULL;
--   -> how many rows the collapse touched (audit trail)
-- SELECT id, report_number FROM public.jobs
--  WHERE workflow_status = 'closed' AND invoice_id IS NULL;
--   -> closed jobs with NO invoice: legacy rows + any manual close. This is the
--      ongoing "did someone close a job without billing it" audit.
