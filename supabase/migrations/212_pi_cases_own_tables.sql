-- ============================================================
-- Migration 212: P&I cases get their own tables
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent. PURELY ADDITIVE — touches no shared function and no column on `jobs`.
--
-- WHY. Migrations 204-209 built a case as a FLAG ON A JOB. That was wrong. A P&I case
-- is not a Taylor Engineering job: we act as correspondent, and TE is merely one
-- contractor among several whose time and costs are recorded against the matter. The
-- invoice that eventually goes out is not a TE invoice and is raised outside this app.
--
-- Three consequences of the old model, all of which this file ends:
--   * ATTENDEES HAD TO BE APP USERS. The chain was
--     job_surveyor_regular -> job_surveyors -> profiles(id) NOT NULL, UNIQUE(job_id,
--     surveyor_id). An external contractor could not be typed by name, and one
--     placeholder profile could have held a single row per case.
--   * CASE HOURS LEAKED INTO TE PAYROLL. job_surveyors carries TE pay rates and two
--     GENERATED pay columns, and mig 210's labour_shift_lines() has no case filter — so
--     case shifts reach the monthly TE pay sheet TODAY. Moving the data (mig 213) fixes
--     that by construction: the case will own no row in any of those tables.
--   * CASES DRAGGED JOB MACHINERY WITH THEM. Eight shared functions gained case
--     predicates, including job_is_open(), called by name from ~9 RLS policies. Those
--     come back out in migs 214/215, after this and the app have shipped.
--
-- WHAT THIS BUYS. job_attendance_billing (mig 208) and guard_attendance_billed_stamp
-- (mig 206/207) are NOT recreated here and are dropped in 215. They existed for exactly
-- one reason: job_surveyor_regular is surveyor-readable, RLS cannot hide a COLUMN, and a
-- rate column there would have shown every surveyor the margin on their own hour. These
-- tables are admin-only, so the rate lives directly on the attendance row — and the
-- guard that fought the ON DELETE SET NULL cascade in mig 207 is designed out rather
-- than defended against.
--
-- ORDER IS LOAD-BEARING: cases -> case_claims -> case_attendances -> case_charges ->
-- case_documents. case_attendances carries an FK to case_claims.
-- ============================================================

-- == 1. The case ==============================================================
-- Deliberately lean. No vessels FK (a P&I vessel is routinely one TE never surveys, and
-- an FK would force a directory row); no case-number series (next_report_number()'s one
-- global series must not gain a sibling — retired parallel counters are a documented
-- scar); no enum on case_type or other_party, because the matters vary too much.
CREATE TABLE IF NOT EXISTS public.cases (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title           TEXT NOT NULL,
  case_type       TEXT,                 -- collision / allision / medical / free text
  our_vessel      TEXT,
  our_vessel_type TEXT,                 -- the M.V./M.T. prefix, so withVesselPrefix() works
  other_party     TEXT,                 -- the opposing vessel OR an injured person's name
  case_ref        TEXT,                 -- the club's claim number, free text, their format
  principal       TEXT,                 -- the club or principal. FREE TEXT on purpose: a
                                        -- P&I principal is not a TE customer and must not
                                        -- appear in TE invoicing, rate cards or /clients.
  status          TEXT NOT NULL DEFAULT 'open',
  opened_on       DATE NOT NULL DEFAULT CURRENT_DATE,
  closed_on       DATE,
  notes           TEXT,
  -- Scaffolding so migration 213 is exactly re-runnable. Dropped in 215.
  legacy_job_id   UUID,
  created_by      UUID REFERENCES public.profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.cases DROP CONSTRAINT IF EXISTS cases_status_chk;
ALTER TABLE public.cases ADD CONSTRAINT cases_status_chk
  CHECK (status IN ('open', 'on_hold', 'concluded'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_cases_legacy_job ON public.cases (legacy_job_id)
  WHERE legacy_job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cases_live ON public.cases (opened_on DESC)
  WHERE status <> 'concluded';

DROP TRIGGER IF EXISTS update_cases_updated_at ON public.cases;
CREATE TRIGGER update_cases_updated_at
  BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- == 2. A claim: the "these were invoiced" record =============================
-- No TE invoice is ever created. A claim is the export + the note that its lines have
-- been billed outside the app, so the next claim skips them.
--
-- UNDO IS A PLAIN DELETE of this row: both claim_id FKs below are ON DELETE SET NULL, so
-- deleting a claim returns every item to unclaimed. There is deliberately NO unclaim RPC
-- and NO BEFORE trigger anywhere near those columns — a guard trigger fighting exactly
-- this cascade is what broke migration 206 and had to be fixed by 207.
CREATE TABLE IF NOT EXISTS public.case_claims (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id    UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  claim_no   INTEGER NOT NULL,          -- 1, 2, 3 … per case. NOT a global series.
  currency   TEXT NOT NULL,
  cutoff_on  DATE NOT NULL,
  total      NUMERIC NOT NULL DEFAULT 0,
  item_count INTEGER NOT NULL DEFAULT 0,
  -- The invoice number raised outside the app. Prompted, never required: no number to
  -- hand must not stop the claim going through.
  reference  TEXT,
  invoiced_on DATE,
  note       TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.case_claims DROP CONSTRAINT IF EXISTS cl_ccy_chk;
ALTER TABLE public.case_claims ADD CONSTRAINT cl_ccy_chk
  CHECK (currency IN ('USD', 'TTD', 'EUR', 'GBP'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_case_claims_no ON public.case_claims (case_id, claim_no);

-- == 3. An attendance =========================================================
-- WHO is either an app user or a typed-in contractor — never both, never neither.
-- TIME IS WHOLE MINUTES. Hours as a 2dp number make a 10-minute block 0.17, and six
-- blocks 1.02h rather than 1.00 — a 2% over-bill that compounds onto a claim. Integer
-- minutes make six clicks exactly one hour.
CREATE TABLE IF NOT EXISTS public.case_attendances (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id             UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,

  attendee_profile_id UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
  attendee_name       TEXT,

  attended_on         DATE NOT NULL DEFAULT CURRENT_DATE,
  minutes             INTEGER NOT NULL DEFAULT 0,
  description         TEXT,
  location            TEXT,
  note                TEXT,

  -- Priced PER ATTENDANCE, because the rate belongs to the WORK: the same person bills a
  -- call-out at one rate and expert-witness testimony at another, and a contractor may
  -- charge a flat fee. hourly | daily | fixed.
  rate_type           TEXT NOT NULL DEFAULT 'hourly',
  rate_amount         NUMERIC,
  days                NUMERIC,          -- only meaningful when rate_type = 'daily'
  currency            TEXT NOT NULL DEFAULT 'USD',

  -- The DATABASE owns the arithmetic, so an export can never drift from the totals on
  -- screen. Rounding is on the MONEY, never on the minutes: six 10-minute blocks at
  -- 300/h are 6 x 50.00 = 300.00 exactly.
  charge_amount NUMERIC GENERATED ALWAYS AS (
    CASE
      WHEN rate_amount IS NULL  THEN NULL
      WHEN rate_type = 'hourly' THEN round(rate_amount * minutes / 60.0, 2)
      WHEN rate_type = 'daily'  THEN round(rate_amount * COALESCE(days, 0), 2)
      ELSE round(rate_amount, 2)
    END) STORED,

  claim_id            UUID REFERENCES public.case_claims(id) ON DELETE SET NULL,

  -- One key per user TAP, replayed on every retry (CLAUDE.md; mig 190 / movements.ts).
  -- Two taps of "Phone call" SHOULD make two rows; a retried tap must not.
  client_ref          TEXT,

  legacy_entry_id     UUID,             -- scaffolding for mig 213; dropped in 215
  created_by          UUID REFERENCES public.profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exactly one attendee. NULLIF(btrim(...)) because a blank text input must not satisfy
-- the XOR — an empty string is not a contractor's name.
ALTER TABLE public.case_attendances DROP CONSTRAINT IF EXISTS ca_attendee_chk;
ALTER TABLE public.case_attendances ADD CONSTRAINT ca_attendee_chk CHECK (
  (attendee_profile_id IS NOT NULL)::int
  + (NULLIF(btrim(COALESCE(attendee_name, '')), '') IS NOT NULL)::int = 1);

ALTER TABLE public.case_attendances DROP CONSTRAINT IF EXISTS ca_rate_type_chk;
ALTER TABLE public.case_attendances ADD CONSTRAINT ca_rate_type_chk
  CHECK (rate_type IN ('hourly', 'daily', 'fixed'));
ALTER TABLE public.case_attendances DROP CONSTRAINT IF EXISTS ca_ccy_chk;
ALTER TABLE public.case_attendances ADD CONSTRAINT ca_ccy_chk
  CHECK (currency IN ('USD', 'TTD', 'EUR', 'GBP'));
ALTER TABLE public.case_attendances DROP CONSTRAINT IF EXISTS ca_minutes_chk;
ALTER TABLE public.case_attendances ADD CONSTRAINT ca_minutes_chk CHECK (minutes >= 0);
ALTER TABLE public.case_attendances DROP CONSTRAINT IF EXISTS ca_rate_nonneg;
ALTER TABLE public.case_attendances ADD CONSTRAINT ca_rate_nonneg
  CHECK (rate_amount IS NULL OR rate_amount >= 0);
ALTER TABLE public.case_attendances DROP CONSTRAINT IF EXISTS ca_days_nonneg;
ALTER TABLE public.case_attendances ADD CONSTRAINT ca_days_nonneg
  CHECK (days IS NULL OR days >= 0);

CREATE INDEX IF NOT EXISTS idx_ca_case ON public.case_attendances (case_id, attended_on DESC);
CREATE INDEX IF NOT EXISTS idx_ca_unclaimed ON public.case_attendances (case_id) WHERE claim_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_ca_claim ON public.case_attendances (claim_id) WHERE claim_id IS NOT NULL;
-- This one is what makes the quick buttons safe under a flaky connection.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ca_client_ref ON public.case_attendances (client_ref) WHERE client_ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_ca_legacy ON public.case_attendances (legacy_entry_id) WHERE legacy_entry_id IS NOT NULL;

DROP TRIGGER IF EXISTS update_case_attendances_updated_at ON public.case_attendances;
CREATE TRIGGER update_case_attendances_updated_at
  BEFORE UPDATE ON public.case_attendances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- == 4. Fees and costs: repointed in place, not recreated =====================
-- case_charges (mig 208) already holds a live row, so it keeps its identity and changes
-- parent. job_id, billed_invoice_id and receipt_path are dropped in 215 — mig 213 still
-- needs job_id to find the rows, and the deployed app must stop selecting them first.
ALTER TABLE public.case_charges
  ADD COLUMN IF NOT EXISTS case_id  UUID REFERENCES public.cases(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS claim_id UUID REFERENCES public.case_claims(id) ON DELETE SET NULL;

-- USD is the primary currency for P&I work.
ALTER TABLE public.case_charges ALTER COLUMN currency SET DEFAULT 'USD';

-- A charge lived on a JOB and was policed by a trigger reading jobs.is_case. Both go:
-- case_id is a real FK and needs no trigger to tell it what its parent is.
DROP TRIGGER  IF EXISTS case_charges_require_case ON public.case_charges;
DROP FUNCTION IF EXISTS public.case_charge_requires_case();

CREATE INDEX IF NOT EXISTS idx_case_charges_case ON public.case_charges (case_id);
CREATE INDEX IF NOT EXISTS idx_case_charges_unclaimed ON public.case_charges (case_id) WHERE claim_id IS NULL;

-- == 5. Documents: case-level AND per-item, one mechanism =====================
-- Column shape copies vessel_documents (mig 029) so uploadDocument()'s compensating
-- storage.remove() transplants verbatim. It fixes two known defects of the
-- invoice-receipt path rather than copying them: `name` is PERSISTED (receipt_name never
-- was, so a reloaded invoice just says "Receipt"), and detaching removes the object
-- instead of orphaning it.
CREATE TABLE IF NOT EXISTS public.case_documents (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  case_id       UUID NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  -- Both NULL = a case-level document. Otherwise a receipt for exactly one item.
  attendance_id UUID REFERENCES public.case_attendances(id) ON DELETE CASCADE,
  charge_id     UUID REFERENCES public.case_charges(id)     ON DELETE CASCADE,
  name          TEXT NOT NULL,
  category      TEXT,
  storage_path  TEXT NOT NULL,
  content_type  TEXT,
  size_bytes    BIGINT,
  uploaded_by   UUID REFERENCES public.profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.case_documents DROP CONSTRAINT IF EXISTS cd_one_parent_chk;
ALTER TABLE public.case_documents ADD CONSTRAINT cd_one_parent_chk
  CHECK ((attendance_id IS NOT NULL)::int + (charge_id IS NOT NULL)::int <= 1);

CREATE INDEX IF NOT EXISTS idx_cd_case ON public.case_documents (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cd_attendance ON public.case_documents (attendance_id) WHERE attendance_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cd_charge ON public.case_documents (charge_id) WHERE charge_id IS NOT NULL;

-- == 6. Storage ===============================================================
-- A private bucket of its own. NOT job-files, whose RLS is can_access_job() and becomes
-- meaningless once a case is not a job. Paths are {case_id}/{uuid}_{name}, so a case's
-- objects are one prefix — unlike invoice-receipts, which is flat.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('case-documents', 'case-documents', false, 26214400,
        ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp',
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
ON CONFLICT (id) DO UPDATE
  SET file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Admins read case documents" ON storage.objects;
CREATE POLICY "Admins read case documents" ON storage.objects
  FOR SELECT USING (bucket_id = 'case-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Admins upload case documents" ON storage.objects;
CREATE POLICY "Admins upload case documents" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'case-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Admins update case documents" ON storage.objects;
CREATE POLICY "Admins update case documents" ON storage.objects
  FOR UPDATE USING (bucket_id = 'case-documents' AND public.is_admin());
DROP POLICY IF EXISTS "Admins delete case documents" ON storage.objects;
CREATE POLICY "Admins delete case documents" ON storage.objects
  FOR DELETE USING (bucket_id = 'case-documents' AND public.is_admin());

-- == 7. RLS: administrators, and nobody else ==================================
-- Every one of these tables carries a rate or an amount, and RLS cannot hide a COLUMN —
-- a surveyor able to read case_attendances would read the rate paid to every contractor
-- on the matter, and the margin on their own hour. There is also no permission machinery
-- to reach for: has_office_permission() is hard-gated to role = 'office' and can never
-- grant an admin anything. So: all admins, no office, no surveyors.
ALTER TABLE public.cases            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_claims      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_attendances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_documents   ENABLE ROW LEVEL SECURITY;
-- case_charges already has RLS enabled (mig 208).

DROP POLICY IF EXISTS "Admins manage cases" ON public.cases;
CREATE POLICY "Admins manage cases" ON public.cases
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage case claims" ON public.case_claims;
CREATE POLICY "Admins manage case claims" ON public.case_claims
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage case attendances" ON public.case_attendances;
CREATE POLICY "Admins manage case attendances" ON public.case_attendances
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Admins manage case documents" ON public.case_documents;
CREATE POLICY "Admins manage case documents" ON public.case_documents
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Mig 208 let anyone with invoicing.view read case_charges. A case is not TE invoicing,
-- so that is the wrong key for it.
DROP POLICY IF EXISTS "Read case charges" ON public.case_charges;

-- == 8. Quick billable block ==================================================
-- One tap = one 10-minute chunk, attributed to the caller, dated today. Two taps make
-- two rows because the client mints a fresh client_ref per TAP; a retry replays the same
-- ref and gets the original row back instead of double-logging.
--
-- RETURNS uuid, not RETURNS TABLE, deliberately: a plpgsql RETURNS TABLE makes every
-- output name a variable for the whole body and a bare column reference then raises
-- 42702, which mig 191 shipped and 192 had to fix. This sidesteps it entirely.
--
-- rate_amount is left NULL. An unpriced item is not claimable (see bill/claim rules), so
-- a quick block can never be billed at zero by accident.
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
  v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can log case time';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = p_case) THEN
    RAISE EXCEPTION 'Case % does not exist', p_case;
  END IF;

  INSERT INTO public.case_attendances
    (case_id, attendee_profile_id, attended_on, minutes, description, client_ref, created_by)
  VALUES
    (p_case, auth.uid(), CURRENT_DATE, 10,
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

-- == 9. Close off a claim =====================================================
-- Stamps every UNCLAIMED, PRICED item in ONE currency up to a cutoff. Three invariants,
-- all enforced here rather than only in the UI, so no future screen can get them wrong:
--   * one claim, one currency — a case with USD and TTD work produces two claims
--   * an unpriced attendance is never claimed (charge_amount IS NULL is skipped)
--   * an item added LATE but dated inside a claimed period stays unclaimed and lands on
--     the next claim, because the predicate is claim_id IS NULL, not a date window alone
DROP FUNCTION IF EXISTS public.case_claim_items(uuid, text, date, text, text);
CREATE OR REPLACE FUNCTION public.case_claim_items(
  p_case      UUID,
  p_currency  TEXT,
  p_cutoff    DATE,
  p_reference TEXT DEFAULT NULL,
  p_note      TEXT DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_claim  UUID;
  v_no     INTEGER;
  v_att    INTEGER := 0;
  v_chg    INTEGER := 0;
  v_total  NUMERIC := 0;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can claim case items';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = p_case) THEN
    RAISE EXCEPTION 'Case % does not exist', p_case;
  END IF;

  SELECT COALESCE(max(c.claim_no), 0) + 1 INTO v_no
    FROM public.case_claims c WHERE c.case_id = p_case;

  INSERT INTO public.case_claims (case_id, claim_no, currency, cutoff_on, reference, note, created_by)
  VALUES (p_case, v_no, p_currency, p_cutoff, NULLIF(btrim(COALESCE(p_reference, '')), ''), p_note, auth.uid())
  RETURNING id INTO v_claim;

  UPDATE public.case_attendances a
     SET claim_id = v_claim
   WHERE a.case_id = p_case
     AND a.claim_id IS NULL
     AND a.charge_amount IS NOT NULL
     AND a.currency = p_currency
     AND a.attended_on <= p_cutoff;
  GET DIAGNOSTICS v_att = ROW_COUNT;

  UPDATE public.case_charges c
     SET claim_id = v_claim
   WHERE c.case_id = p_case
     AND c.claim_id IS NULL
     AND c.currency = p_currency
     AND c.incurred_on <= p_cutoff;
  GET DIAGNOSTICS v_chg = ROW_COUNT;

  IF v_att + v_chg = 0 THEN
    -- Roll the empty claim back rather than leave a claim numbered against nothing.
    RAISE EXCEPTION 'Nothing outstanding in % up to %', p_currency, p_cutoff;
  END IF;

  SELECT COALESCE((SELECT sum(a.charge_amount) FROM public.case_attendances a WHERE a.claim_id = v_claim), 0)
       + COALESCE((SELECT sum(c.qty * c.unit_amount) FROM public.case_charges c WHERE c.claim_id = v_claim), 0)
    INTO v_total;

  UPDATE public.case_claims
     SET total = round(v_total, 2), item_count = v_att + v_chg
   WHERE id = v_claim;

  RETURN jsonb_build_object('claim_id', v_claim, 'claim_no', v_no, 'currency', p_currency,
                            'attendances', v_att, 'charges', v_chg,
                            'items', v_att + v_chg, 'total', round(v_total, 2));
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.case_claim_items(uuid, text, date, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.case_claim_items(uuid, text, date, text, text) TO authenticated;

-- Sanity checks after running:
--   SELECT * FROM public.cases;                       -- empty until mig 213
--   SELECT id FROM storage.buckets WHERE id = 'case-documents';
--   -- six 10-minute blocks must be exactly one hour, not 1.02:
--   -- SELECT sum(minutes)/60.0 FROM public.case_attendances WHERE minutes = 10;
