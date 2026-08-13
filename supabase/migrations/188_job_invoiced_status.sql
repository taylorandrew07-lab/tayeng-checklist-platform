-- 188_job_invoiced_status.sql
--
-- A fifth workflow stage, 'invoiced', between 'invoice_ready' and 'closed'.
--
--   in_progress -> report_ready -> invoice_ready -> invoiced -> closed
--
-- WHY. Since mig 145, creating an invoice stamped the job straight to 'closed',
-- which is what freezes every surveyor write via job_is_open(). That conflated two
-- different events: "we have billed this" and "we are finished with this". There was
-- no stage for a job that is billed but still being chased, so closing was a side
-- effect of invoicing rather than a decision anyone made.
--
-- Now invoicing lands on 'invoiced' and an admin closes the job by hand afterwards.
--
-- 'invoiced' LOCKS surveyor writes exactly as 'closed' does — the freeze still starts
-- at invoice creation, so no window is reopened for editing billed work. What changes
-- is only which label the job wears while frozen, and that closing is now deliberate.
--
-- DEPLOY ORDER. This migration is deliberately PERMISSIVE: it only widens what is
-- allowed, and changes no app-visible behaviour on its own except where invoicing
-- writes the status (§6). Old app code keeps working against the new schema, so the
-- db-migrate/Vercel race on a single push is safe in either order. Mig 145:19-27
-- documents the opposite case, which is the one that breaks.
--
-- Idempotent; paste-runnable in the Supabase SQL Editor.

-- ── 0. Sanity: no live row should still carry the retired pre-145 slug ──────
-- Mig 145 §2 remapped every historical 'invoiced'/'sent'/'paid' row to 'closed', and
-- its CHECK has forbidden the value ever since, so this must be 0 on a first run.
--
-- GATED ON THE OLD CONSTRAINT STILL BEING IN PLACE. Once §1 has run, rows legitimately
-- sit at 'invoiced' and an ungated check would abort every re-run — turning the one
-- guard in this file into the thing that breaks it. Only the first run is inspected.
DO $$
DECLARE v_stale INT;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'jobs_workflow_status_chk'
       AND pg_get_constraintdef(oid) NOT LIKE '%''invoiced''%'
  ) THEN
    SELECT count(*) INTO v_stale FROM public.jobs WHERE workflow_status = 'invoiced';
    IF v_stale > 0 THEN
      RAISE EXCEPTION
        'Found % job(s) still at the retired pre-145 status ''invoiced''. Migration 145 should have remapped these to ''closed''; resolve them before adding the new stage.',
        v_stale;
    END IF;
  END IF;
END $$;

-- ── 1. The 5-state CHECK ───────────────────────────────────────────────────
-- Mig 145:117 added this constraint with no IF NOT EXISTS, so drop then re-add.
ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_workflow_status_chk;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_workflow_status_chk
  CHECK (workflow_status IN ('in_progress','report_ready','invoice_ready','invoiced','closed'));

-- Default is unchanged; restated so this file stands alone.
ALTER TABLE public.jobs ALTER COLUMN workflow_status SET DEFAULT 'in_progress';

-- ── 2. THE LANDMINE: stop normalising 'invoiced' away ──────────────────────
-- 'invoiced' was a RETIRED pre-145 slug that mig 145:91 folded into 'closed'. That
-- CASE runs inside jobs_aa_normalize_workflow, a BEFORE INSERT OR UPDATE trigger on
-- every write. Left in place, every attempt to write the NEW status would be silently
-- rewritten to 'closed' before the CHECK ever saw it — no error, no clue, the feature
-- simply would not exist.
--
-- The word now means the live stage. Every other pre-145 alias stays: 'sent' and
-- 'paid' were payment states, retired for good by mig 146, and still fold to 'closed'.
CREATE OR REPLACE FUNCTION public.normalize_workflow_status(p TEXT)
RETURNS TEXT LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p
    WHEN 'new'             THEN 'in_progress'
    WHEN 'assigned'        THEN 'in_progress'
    WHEN 'report_uploaded' THEN 'report_ready'
    WHEN 'approved'        THEN 'invoice_ready'
    WHEN 'report_approved' THEN 'invoice_ready'
    WHEN 'sent'            THEN 'closed'
    WHEN 'paid'            THEN 'closed'
    ELSE p
  END;
$$;

-- ── 3. RLS lock helper: 'invoiced' freezes surveyors too ───────────────────
-- The lock still begins at invoice creation — it is the LABEL that changed, not the
-- moment. If this predicate were left keyed on 'closed' alone, invoicing would stop
-- freezing anything and surveyors could edit hours, answers and photos on billed work.
--
-- A missing job still returns TRUE so brand-new inserts are never wrongly blocked.
--
-- Every policy that AND-s public.job_is_open(...) calls it BY NAME (mig 117:
-- job_surveyors, job_surveyor_overtime, job_surveyor_km, job_field_values,
-- job_photos, job_signatures, job_attachments INSERT, storage.objects INSERT; plus
-- migs 150, 152, 157), so replacing the function re-keys all of them. No policy
-- rewrite needed — and nothing announces it if this is wrong, hence `npm run smoke`.
CREATE OR REPLACE FUNCTION public.job_is_open(p_job UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM public.jobs j
     WHERE j.id = p_job AND j.workflow_status IN ('invoiced', 'closed')
  );
$$;

-- ── 4. The billed job may move WITHIN {invoiced, closed}, never out of it ──
-- Body from mig 186:191. The second block previously refused any move off 'closed'
-- while the job was still stamped onto an invoice — which, under the new model, is
-- exactly what the admin's manual close is. Widened to a set predicate: the two
-- billed stages are interchangeable by hand; LEAVING them still requires editing or
-- deleting the invoice.
--
-- Both release paths null invoice_id in the SAME statement that moves the status, so
-- they pass. Only a bare status change out of the billed set is refused.
--
-- The absorbed-leg block is UNCHANGED: legs are billed under a parent's line, go
-- straight to 'closed' (§6b), and have nothing further to do.
CREATE OR REPLACE FUNCTION public.enforce_absorbed_job_immutable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.billed_under_job_id IS NOT NULL
     AND NEW.billed_under_job_id IS NOT NULL
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    RAISE EXCEPTION 'This survey is billed under another job — edit or delete its invoice instead';
  END IF;

  IF OLD.invoice_id IS NOT NULL
     AND NEW.invoice_id IS NOT NULL
     AND OLD.workflow_status IN ('invoiced', 'closed')
     AND NEW.workflow_status NOT IN ('invoiced', 'closed') THEN
    RAISE EXCEPTION 'This job is billed on an invoice — delete or edit the invoice to reopen it';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- ── 5. Admin-only gates widened to cover the new stage ─────────────────────

-- 5a. Only an admin may mark a job invoiced or closed (body from mig 145:216).
CREATE OR REPLACE FUNCTION public.enforce_admin_paid_closed()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.workflow_status IN ('invoiced', 'closed')
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can invoice or close a job';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5b. Non-admin reopen guard + protected columns (body from mig 186:92).
-- Only the reopen predicate changes: the locked financial state is now either of the
-- two billed stages. The allow-list at the foot already excludes both.
CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- A non-admin may not move a job out of the locked financial state.
  IF OLD.workflow_status IN ('invoiced', 'closed')
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    RAISE EXCEPTION 'Only an administrator can re-open a billed job';
  END IF;

  IF NEW.report_number         IS DISTINCT FROM OLD.report_number
     OR NEW.report_approved_at IS DISTINCT FROM OLD.report_approved_at
     OR NEW.report_approved_by IS DISTINCT FROM OLD.report_approved_by
     OR NEW.paid_at            IS DISTINCT FROM OLD.paid_at
     OR NEW.closed_at          IS DISTINCT FROM OLD.closed_at
     OR NEW.closed_by          IS DISTINCT FROM OLD.closed_by
     OR NEW.labour_unit        IS DISTINCT FROM OLD.labour_unit
     OR NEW.reminder_hours     IS DISTINCT FROM OLD.reminder_hours
     OR NEW.invoice_id         IS DISTINCT FROM OLD.invoice_id
     OR NEW.billed_under_job_id IS DISTINCT FROM OLD.billed_under_job_id THEN
    RAISE EXCEPTION 'Only an administrator can change this job field';
  END IF;

  IF NEW.workflow_status IS DISTINCT FROM OLD.workflow_status
     AND NEW.workflow_status NOT IN ('in_progress', 'report_ready') THEN
    RAISE EXCEPTION 'Only an administrator can set this workflow status';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- 5c. Surveyor update guard (body from mig 186:130). The two freezes that keyed on
-- 'closed' now key on the billed set — billing mode and the grouping identity of a
-- billed survey must not become editable again just because 'closed' arrives later.
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
       OR NEW.labour_unit IS DISTINCT FROM OLD.labour_unit
       OR (NEW.assigned_to IS DISTINCT FROM OLD.assigned_to
           AND NOT (OLD.assigned_to IS NULL AND NEW.assigned_to = auth.uid())) THEN
      RAISE EXCEPTION 'Surveyors may not modify protected job fields';
    END IF;
    -- Billing mode: only while the job is open (not yet invoiced/closed), and
    -- never to/from 'fixed'.
    IF (NEW.billing_mode IS DISTINCT FROM OLD.billing_mode
        OR NEW.is_overtime IS DISTINCT FROM OLD.is_overtime) THEN
      IF OLD.workflow_status IN ('invoiced', 'closed') THEN
        RAISE EXCEPTION 'This job has been invoiced — billing can no longer be changed';
      END IF;
      IF NEW.billing_mode = 'fixed' OR OLD.billing_mode = 'fixed' THEN
        RAISE EXCEPTION 'Only admins may set fixed-price billing';
      END IF;
    END IF;
    -- The grouping identity of a billed survey is frozen (mig 186).
    IF (OLD.workflow_status IN ('invoiced', 'closed') OR OLD.billed_under_job_id IS NOT NULL) THEN
      IF NEW.vessel_name    IS DISTINCT FROM OLD.vessel_name
         OR NEW.vessel_id   IS DISTINCT FROM OLD.vessel_id
         OR NEW.job_stage   IS DISTINCT FROM OLD.job_stage
         OR NEW.job_type    IS DISTINCT FROM OLD.job_type
         OR NEW.scheduled_date IS DISTINCT FROM OLD.scheduled_date
         OR NEW.end_date    IS DISTINCT FROM OLD.end_date
         OR NEW.voyage_number IS DISTINCT FROM OLD.voyage_number THEN
        RAISE EXCEPTION 'This survey has been billed — its vessel, stage, dates and voyage can no longer be changed';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- ── 6. Invoicing lands on 'invoiced', not 'closed' ─────────────────────────
-- Body from mig 186:313. This RPC — not the app — is where invoicing sets the status
-- (createConsolidatedInvoice calls it at invoicing.ts:693 and :895).
--
-- 6a. A job that OWNS an invoice line becomes 'invoiced' and is NOT stamped closed:
--     closed_at/closed_by are the record of a decision nobody has made yet. They are
--     stamped when the admin closes the job (setWorkflowStatus does it).
-- 6b. An ABSORBED leg goes straight to 'closed'. It carries no line of its own, its
--     money belongs to the Final it is billed under, and the mig-186 immutability
--     trigger freezes its status permanently — so there is no later close to make.
--     Leaving legs at 'invoiced' would strand them there forever.
--
-- The preconditions and row-count assertions are UNCHANGED and remain the point:
-- without them a job already on invoice A is silently re-stamped onto invoice B.
CREATE OR REPLACE FUNCTION public.bill_jobs_onto_invoice(
  p_invoice_id  UUID,
  p_line_job_ids UUID[],
  p_absorbed    JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (billed_job_id UUID) AS $$
DECLARE
  v_expected INT;
  v_actual   INT;
  v_now      TIMESTAMPTZ := now();
  v_uid      UUID := auth.uid();
  v_orphan   UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can bill jobs onto an invoice';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.invoices WHERE id = p_invoice_id) THEN
    RAISE EXCEPTION 'Invoice % does not exist', p_invoice_id;
  END IF;

  -- Every absorbed job's parent must itself be a line on this invoice, or the child
  -- would be closed with nothing on the invoice accounting for it.
  SELECT (value #>> '{}')::uuid INTO v_orphan
    FROM jsonb_each(p_absorbed)
   WHERE NOT ((value #>> '{}')::uuid = ANY (p_line_job_ids))
   LIMIT 1;
  IF v_orphan IS NOT NULL THEN
    RAISE EXCEPTION 'Absorbed survey points at job % which is not a line on this invoice', v_orphan;
  END IF;

  -- 8a. The jobs that own a line.
  v_expected := COALESCE(array_length(p_line_job_ids, 1), 0);
  IF v_expected > 0 THEN
    UPDATE public.jobs
       SET invoice_id = p_invoice_id, workflow_status = 'invoiced'
     WHERE id = ANY (p_line_job_ids)
       AND invoice_id IS NULL
       AND workflow_status IN ('report_ready', 'invoice_ready');
    GET DIAGNOSTICS v_actual = ROW_COUNT;
    IF v_actual <> v_expected THEN
      RAISE EXCEPTION
        'Could not bill every job (% of % eligible). A job is already invoiced, still in progress, or already closed: %',
        v_actual, v_expected,
        (SELECT string_agg(COALESCE(report_number, job_number, id::text), ', ')
           FROM public.jobs
          WHERE id = ANY (p_line_job_ids)
            AND (invoice_id IS NOT NULL OR workflow_status NOT IN ('report_ready', 'invoice_ready')));
    END IF;
  END IF;

  -- 8b. The absorbed legs, stamped with the parent they are billed under.
  v_expected := (SELECT count(*)::int FROM jsonb_each(p_absorbed));
  IF v_expected > 0 THEN
    UPDATE public.jobs j
       SET invoice_id = p_invoice_id, workflow_status = 'closed',
           closed_at = v_now, closed_by = v_uid,
           billed_under_job_id = (a.value #>> '{}')::uuid
      FROM jsonb_each(p_absorbed) AS a
     WHERE j.id = a.key::uuid
       AND j.invoice_id IS NULL
       AND j.workflow_status IN ('report_ready', 'invoice_ready');
    GET DIAGNOSTICS v_actual = ROW_COUNT;
    IF v_actual <> v_expected THEN
      RAISE EXCEPTION
        'Could not absorb every survey on this voyage (% of %). One is already invoiced, still in progress, or already closed.',
        v_actual, v_expected;
    END IF;
  END IF;

  RETURN QUERY
    SELECT id FROM public.jobs WHERE invoice_id = p_invoice_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.bill_jobs_onto_invoice(UUID, UUID[], JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bill_jobs_onto_invoice(UUID, UUID[], JSONB) TO authenticated;

-- ── 7. Deliberately NOT changed ────────────────────────────────────────────
-- release_jobs_from_invoice (mig 186:400) selects its targets by invoice_id with NO
-- status filter and restores invoice_ready/report_ready from report_approved_at. It
-- already handles an 'invoiced' job correctly. Verified, not edited.
--
-- metrics_analytics (mig 146:118) counts openJobs as workflow_status <> 'closed', and
-- get_calendar_jobs (mig 059:45) shows the same set. An invoiced job therefore still
-- reads as OPEN in dashboards and still appears on the calendar. THAT IS INTENTIONAL:
-- until someone closes it, it is outstanding work for the office. Do not "fix" these
-- to exclude 'invoiced' — the RLS write-lock (§3) and the dashboard notion of "open"
-- are two different questions and are meant to disagree here.
