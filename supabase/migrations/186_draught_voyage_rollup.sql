-- ============================================================
-- Migration 186 — Draught-survey voyage grouping + roll-up billing.
--
-- A draught survey is not one job, it is a SEQUENCE on one vessel voyage:
--   Initial (no report) -> Interim* (no report) -> exactly one Final (carries the report).
-- Each leg is a separate job today, so each becomes its own invoice line. The client
-- must instead see ONE line, anchored on the Final, whose amount is the roll-up of the
-- whole voyage — and every leg it absorbed must close with it so nothing dangles as
-- uninvoiced.
--
-- SCOPE: Draught Survey only. No other job type's billing changes.
--
-- WHY A COLUMN AND NOT A JUNCTION TABLE: InvoiceEditModal autosaves through
-- updateInvoice, which DELETEs and re-INSERTs every invoice_line_items row. A junction
-- keyed on line_item_id would be destroyed and rebuilt on every debounced keystroke,
-- and any interruption would strand an absorbed job — closed, stamped, on no line, and
-- invisible to reconciliation. A column on jobs is immune to line churn.
--
-- TRIGGER SAFETY: every UPDATE in this file writes only voyage_number, vessel_name and
-- report_not_required. None touches workflow_status, report_number, closed_at/closed_by
-- or invoice_id, so enforce_job_admin_columns and enforce_admin_paid_closed see NEW
-- unchanged for the migration runner (which has no auth.uid(), so is_admin() is FALSE).
-- enforce_surveyor_job_update is gated on get_my_role() = 'surveyor' and so is inert.
-- propagate_vessel_type (mig 167) is AFTER UPDATE OF vessel_type only.
--
-- No function here reads a table created later in this file, so check_function_bodies
-- does not need disabling.
-- ============================================================

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS voyage_number TEXT;
COMMENT ON COLUMN public.jobs.voyage_number IS
  'Vessel voyage reference (canonical form V-###) as DATA. Surveyors used to type it
   into vessel_name ("Chaconia (V086)"), which polluted the vessels directory through
   findOrCreateVessel. Rendered NEXT TO the vessel name, never inside it, and never
   baked into jobs.title. Groups a draught-survey voyage (Initial? + Interim* + exactly
   one Final) into one billable roll-up. Deliberately surveyor-writable, same reasoning
   as port_location (mig 153): enforce_surveyor_job_update blacklists only
   template_id/client_id/job_number/created_by/labour_unit/assigned_to/billing_mode.';

ALTER TABLE public.jobs ADD COLUMN IF NOT EXISTS billed_under_job_id UUID
  REFERENCES public.jobs(id) ON DELETE SET NULL;
COMMENT ON COLUMN public.jobs.billed_under_job_id IS
  'This job was ABSORBED into another job''s single invoice line — the Final draught
   survey of the same voyage. Set at invoice creation alongside invoice_id /
   workflow_status=closed / closed_at / closed_by; cleared on release. NULL on every
   ordinary job INCLUDING the standalone report-only job that
   createConsolidatedInvoice.new_job creates — which is exactly what keeps that job out
   of updateInvoice''s release set (see the comment at invoicing.ts:586-589).';

-- The dead mig-072 column, one word away from the real one. Two free-text voyage
-- columns on a table whose every select is a hand-written string is how the wrong one
-- gets picked. Dropped in a later migration once nothing references it.
COMMENT ON COLUMN public.jobs.cargo_voyage_ref IS
  'DEPRECATED (mig 186) — never read or written anywhere in the app. Use
   jobs.voyage_number. Retained only so this migration stays non-destructive.';

CREATE INDEX IF NOT EXISTS idx_jobs_voyage
  ON public.jobs (vessel_id, voyage_number) WHERE voyage_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_billed_under
  ON public.jobs (billed_under_job_id) WHERE billed_under_job_id IS NOT NULL;

ALTER TABLE public.jobs DROP CONSTRAINT IF EXISTS jobs_billed_under_not_self_chk;
ALTER TABLE public.jobs ADD CONSTRAINT jobs_billed_under_not_self_chk
  CHECK (billed_under_job_id IS NULL OR billed_under_job_id <> id);

-- ── 2. Voyage normalisation, shared by the backfill and any future query ────
-- Canonical form is 'V-' + at least three digits, zero-padded: V-086, V-140, V-1204.
-- NOTE lpad() TRUNCATES when the input is longer than the target width
-- (lpad('1204',3,'0') = '120'), so the pad is guarded by a length test. Getting this
-- wrong would silently renumber every voyage above 999.
CREATE OR REPLACE FUNCTION public.normalise_voyage(p_raw TEXT)
RETURNS TEXT AS $$
DECLARE d TEXT;
BEGIN
  IF p_raw IS NULL THEN RETURN NULL; END IF;
  -- Digits of a leading V/VOY/VOYAGE token, or of a bare number.
  d := substring(upper(btrim(p_raw)) from '^(?:V(?:OYAGE|OY)?)?[-._ ]?0*([0-9]+)$');
  IF d IS NULL OR d = '' THEN RETURN NULL; END IF;
  RETURN 'V-' || CASE WHEN length(d) >= 3 THEN d ELSE lpad(d, 3, '0') END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ── 3. enforce_job_admin_columns — body copied from mig 162:183-215 ─────────
-- IMPORTANT: 148 and 162 both redefined this since 145. This body is 162's, with two
-- columns added. Pasting from 145 would silently drop the labour_unit and
-- reminder_hours clauses.
--
-- invoice_id was NEVER guarded — any surveyor could null it, leaving a job closed,
-- frozen and unbilled with no trace. billed_under_job_id is guarded for the same
-- reason. voyage_number stays freely writable: surveyors set it dockside.
CREATE OR REPLACE FUNCTION public.enforce_job_admin_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF public.is_admin() THEN RETURN NEW; END IF;

  -- A non-admin may not move a job out of the locked financial state.
  IF OLD.workflow_status = 'closed'
     AND NEW.workflow_status IS DISTINCT FROM OLD.workflow_status THEN
    RAISE EXCEPTION 'Only an administrator can re-open a closed job';
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

-- ── 4. enforce_surveyor_job_update — body from mig 148, plus a freeze ───────
-- New: once a job is closed or absorbed, a surveyor may not change the fields that
-- decide which voyage it belongs to. Without this, offline sync's alreadyCreated diff
-- (which patches job_stage with no status guard) can retro-change an absorbed leg from
-- Interim to Final days after it was rolled up and billed.
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
      IF OLD.workflow_status = 'closed' THEN
        RAISE EXCEPTION 'This job has been invoiced and closed — billing can no longer be changed';
      END IF;
      IF NEW.billing_mode = 'fixed' OR OLD.billing_mode = 'fixed' THEN
        RAISE EXCEPTION 'Only admins may set fixed-price billing';
      END IF;
    END IF;
    -- The grouping identity of a billed survey is frozen (mig 186).
    IF (OLD.workflow_status = 'closed' OR OLD.billed_under_job_id IS NOT NULL) THEN
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

-- ── 5. The absorbed state has exactly two exits: release, or delete ─────────
-- Applies to ADMINS TOO, on purpose. The jobs-grid status dropdown is a bare <select>
-- over all four workflow values with no confirmation; without this an admin can reopen
-- a billed leg while it stays stamped, which unfreezes surveyor writes on billed work
-- and is invisible to BOTH listInvoiceableJobs (it filters invoice_id IS NULL) and
-- reconciliation (it returns null the moment invoice_id resolves a live invoice).
--
-- Both release paths null invoice_id / billed_under_job_id in the SAME statement that
-- moves the status, so they pass. Only a bare status change is refused.
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
     AND OLD.workflow_status = 'closed'
     AND NEW.workflow_status IS DISTINCT FROM 'closed' THEN
    RAISE EXCEPTION 'This job is billed on an invoice — delete or edit the invoice to reopen it';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS jobs_enforce_absorbed_immutable ON public.jobs;
CREATE TRIGGER jobs_enforce_absorbed_immutable
  BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_absorbed_job_immutable();

-- A job that is billed, absorbed, or is somebody's parent must not vanish. The FK is
-- ON DELETE SET NULL so this migration cannot fail on existing data; this trigger is
-- what actually prevents the orphan.
CREATE OR REPLACE FUNCTION public.enforce_billed_job_undeletable()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.invoice_id IS NOT NULL OR OLD.billed_under_job_id IS NOT NULL THEN
    RAISE EXCEPTION 'This job is billed — delete its invoice first';
  END IF;
  IF EXISTS (SELECT 1 FROM public.jobs WHERE billed_under_job_id = OLD.id) THEN
    RAISE EXCEPTION 'Other surveys are billed under this job — delete its invoice first';
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS jobs_enforce_billed_undeletable ON public.jobs;
CREATE TRIGGER jobs_enforce_billed_undeletable
  BEFORE DELETE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.enforce_billed_job_undeletable();

-- ── 6. Interim draught surveys never carry a report number ─────────────────
-- Andrew, 2026-08-13: neither the Initial nor the Interim has a report — they do not
-- have all the information yet. Only the Final does. Until now only 'Initial' was
-- exempt (reportPolicy.ts:32 and the mig-136 backfill), so every Interim burned a
-- number out of the single global running series (next_report_number(), mig 158).
--
-- This predicate lives in the TRIGGER, not only in TypeScript, because offline sync
-- sends `report_not_required: j.report_not_required ?? false` — an explicit false that
-- defeats createDraftJob's rule. Every Interim draft already sitting on a phone would
-- otherwise still burn a number when it syncs. The DB is the real safety net, and it
-- also covers service-role paths, the SQL editor and any future AI intake.
CREATE OR REPLACE FUNCTION public.set_report_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.report_number IS NULL
     AND NOT COALESCE(NEW.report_not_required, false)
     AND NOT (NEW.job_type = 'Draught Survey'
              AND NEW.job_stage IN ('Initial', 'Interim')) THEN
    NEW.report_number := public.next_report_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Flag-only backfill. Guarded on report_number IS NULL so a number that was genuinely
-- issued is NEVER withdrawn — Andrew's explicit decision: historic Interims keep
-- theirs, so any report already sent to a client still matches the app. The resulting
-- gaps in the series are harmless; next_report_number() is max+1 (mig 158), not a
-- gapless counter.
UPDATE public.jobs
   SET report_not_required = true
 WHERE report_number IS NULL
   AND report_not_required = false
   AND job_type = 'Draught Survey'
   AND job_stage IN ('Initial', 'Interim');

-- ── 7. Lift the voyage out of the vessel name ──────────────────────────────
-- "Chaconia (V086)" was stored literally in jobs.vessel_name AND pushed into
-- vessels.name by findOrCreateVessel, so the vessels directory has been accumulating
-- one bogus vessel per voyage.
--
-- The pattern is anchored to a parenthetical at the END of the name containing ONLY a
-- V-token and digits, so "(Final)", "(Hull 4)" and "Ocean Star 7" never match, and the
-- cargo-style "(V-2026-014)" is deliberately left alone rather than half-parsed.
--
-- jobs.title is deliberately NOT rewritten here. It is a denormalised historic label
-- that nothing recomputes, and leaving the token in it keeps global search working for
-- "V086" until the rendering step lands. Titles stop carrying the voyage going forward.
UPDATE public.jobs
   SET voyage_number = public.normalise_voyage(
         substring(vessel_name from '\(\s*([Vv][-._ ]?[0-9]+)\s*\)\s*$')),
       vessel_name = btrim(regexp_replace(vessel_name, '\s*\(\s*[Vv][-._ ]?[0-9]+\s*\)\s*$', ''))
 WHERE voyage_number IS NULL
   AND vessel_name ~ '\(\s*[Vv][-._ ]?[0-9]+\s*\)\s*$';

-- Jobs whose voyage only ever made it into the title (the name was cleaned by hand at
-- some point). Read-only on the title, as above.
UPDATE public.jobs
   SET voyage_number = public.normalise_voyage(
         substring(title from '\(\s*([Vv][-._ ]?[0-9]+)\s*\)'))
 WHERE voyage_number IS NULL
   AND title ~ '\(\s*[Vv][-._ ]?[0-9]+\s*\)';

-- ── 8. Billing a voyage onto an invoice, atomically ────────────────────────
-- Replaces the multi-request stamp in createConsolidatedInvoice, whose only failure
-- handling was to delete the invoice again.
--
-- THE PRECONDITIONS ARE THE POINT. Without `invoice_id IS NULL AND workflow_status IN
-- (...)`, a job already billed on invoice A is silently re-stamped onto invoice B and
-- the row-count assertion still passes, because nothing was filtered out. Absorbed
-- legs are chosen by the grouper and never appear in the picker, so an admin cannot
-- see the collision themselves. With the preconditions, "billed exactly once" is a
-- database property rather than a UI hope.
--
-- p_absorbed maps absorbed job id -> the parent (Final) job id it is billed under:
--   '{"<initial-uuid>": "<final-uuid>", "<interim-uuid>": "<final-uuid>"}'::jsonb
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
       SET invoice_id = p_invoice_id, workflow_status = 'closed',
           closed_at = v_now, closed_by = v_uid
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

-- ── 9. Releasing a voyage from an invoice, atomically ──────────────────────
-- One function behind delete, void, and the removal half of edit. Children are pulled
-- in THROUGH their parent (billed_under_job_id), never by raw invoice_id — that is
-- what preserves the carve-out for the standalone report-only job that
-- createConsolidatedInvoice creates, which is stamped but was never line-linked.
--
-- The restored status is conditional: a leg that was only report_ready when it was
-- absorbed must not be silently promoted to invoice_ready (which means "an admin has
-- approved this report"). report_approved_at is the record of that approval.
CREATE OR REPLACE FUNCTION public.release_jobs_from_invoice(
  p_invoice_id   UUID,
  p_keep_job_ids UUID[] DEFAULT '{}'::uuid[]
)
RETURNS TABLE (released_job_id UUID) AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can release jobs from an invoice';
  END IF;

  RETURN QUERY
  WITH parents AS (
    SELECT id FROM public.jobs
     WHERE invoice_id = p_invoice_id
       AND billed_under_job_id IS NULL
       AND NOT (id = ANY (p_keep_job_ids))
  ),
  targets AS (
    SELECT id FROM parents
    UNION
    SELECT j.id FROM public.jobs j
      JOIN parents p ON j.billed_under_job_id = p.id
     WHERE j.invoice_id = p_invoice_id
  )
  UPDATE public.jobs j
     SET workflow_status = CASE WHEN j.report_approved_at IS NOT NULL
                                THEN 'invoice_ready' ELSE 'report_ready' END,
         invoice_id = NULL, closed_at = NULL, closed_by = NULL, paid_at = NULL,
         billed_under_job_id = NULL
    FROM targets t
   WHERE j.id = t.id
  RETURNING j.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE ALL ON FUNCTION public.release_jobs_from_invoice(UUID, UUID[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_jobs_from_invoice(UUID, UUID[]) TO authenticated;

-- ── 10. Verify (run by hand in the SQL editor; CI green ≠ migration applied) ─
-- SELECT count(*) FILTER (WHERE voyage_number IS NOT NULL) AS with_voyage,
--        count(*) FILTER (WHERE vessel_name ~ '\(\s*[Vv][-._ ]?[0-9]+\s*\)\s*$') AS still_dirty
--   FROM public.jobs;                                  -- still_dirty must be 0
--
-- SELECT count(*) FROM public.jobs
--  WHERE job_type = 'Draught Survey' AND job_stage IN ('Initial','Interim')
--    AND report_number IS NULL AND report_not_required = false;   -- must be 0
--
-- SELECT count(*) FROM public.jobs
--  WHERE job_type = 'Draught Survey' AND job_stage = 'Interim'
--    AND report_number IS NOT NULL;      -- historic numbers deliberately RETAINED
--
-- -- Parent and child must always sit on the same invoice.
-- SELECT c.id FROM public.jobs c JOIN public.jobs p ON c.billed_under_job_id = p.id
--  WHERE c.invoice_id IS DISTINCT FROM p.invoice_id;              -- must be empty
--
-- SELECT to_regclass('public.jobs') IS NOT NULL,
--        (SELECT count(*) FROM information_schema.columns
--          WHERE table_name='jobs' AND column_name IN ('voyage_number','billed_under_job_id'));  -- 2
