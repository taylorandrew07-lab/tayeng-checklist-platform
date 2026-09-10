-- ============================================================
-- Migration 220: a fee can BE time, and a case remembers what a call is worth
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- TWO THINGS, BOTH ASKED FOR AFTER USING IT.
--
-- 1. A PHONE CALL IS A FEE, NOT AN ATTENDANCE. Migration 218 filed the quick blocks in
--    case_attendances, on the reasoning that time is time. That is not how the work reads
--    from the correspondent's side: an attendance is somebody going somewhere, and a call
--    or an email is part of the correspondency service, which is a FEE. So case_charges
--    gains minutes, a clock span and an idempotency key, and the quick buttons write here.
--    The two rows already logged the other way are moved across at the end of this file.
--
-- 2. THE RATE WAS PER LINE, SO IT HAD TO BE TYPED EVERY LINE. cases.rate_defaults holds
--    the standing rate for a kind of work on that case -- "phone call", "email", anything
--    typed -- so a one-tap entry can price itself. A rate is never demanded: an unpriced
--    line is logged and left OUTSTANDING rather than claimed at zero.
--
-- Money stays honest the way it does on an attendance: amount is GENERATED, so an export
-- cannot drift from the screen, and the hourly case divides whole minutes by 60 at the
-- last moment rather than storing 0.17 of an hour six times and arriving at 1.02.
-- ============================================================

-- == 1. A charge can carry time ==============================================
ALTER TABLE public.case_charges
  ADD COLUMN IF NOT EXISTS minutes    INTEGER,
  ADD COLUMN IF NOT EXISTS start_time TIME,
  ADD COLUMN IF NOT EXISTS end_time   TIME,
  ADD COLUMN IF NOT EXISTS client_ref TEXT;

ALTER TABLE public.case_charges DROP CONSTRAINT IF EXISTS cc_minutes_chk;
ALTER TABLE public.case_charges ADD CONSTRAINT cc_minutes_chk
  CHECK (minutes IS NULL OR minutes >= 0);

COMMENT ON COLUMN public.case_charges.minutes IS
  'Whole minutes, when this fee is time rather than a purchase. NULL for a flat cost. Never stored as a decimal of an hour - six ten-minute blocks must come to exactly 60.';
COMMENT ON COLUMN public.case_charges.start_time IS
  'Trinidad wall-clock start, when known. Set by the quick buttons, which work backwards from the tap.';
COMMENT ON COLUMN public.case_charges.client_ref IS
  'One per TAP, replayed on retry. Two taps mean two blocks; one tap replayed over a flaky connection must not. Settled by uq_cc_client_ref.';

-- The money, computed once, by the database.
--   timed  -> the rate is per HOUR and the duration is minutes
--   costed -> qty x unit price, exactly as before
ALTER TABLE public.case_charges
  ADD COLUMN IF NOT EXISTS amount NUMERIC
  GENERATED ALWAYS AS (
    CASE
      WHEN minutes IS NOT NULL THEN round(unit_amount * minutes / 60.0, 2)
      ELSE round(qty * unit_amount, 2)
    END
  ) STORED;

COMMENT ON COLUMN public.case_charges.amount IS
  'GENERATED. A timed fee is rate x minutes / 60; anything else is qty x unit_amount. Read this - never re-multiply on a screen or in an export, which is how two totals come to disagree.';

-- The house idempotency pattern (inventory_movements, migs 190/191). PARTIAL, so every
-- hand-entered charge keeps a NULL client_ref without colliding with the others.
CREATE UNIQUE INDEX IF NOT EXISTS uq_cc_client_ref
  ON public.case_charges (client_ref) WHERE client_ref IS NOT NULL;

-- == 2. What a case pays for a kind of work ==================================
-- Keyed by the kind LOWERCASED, because the kind itself is free text (mig 219):
--   {"phone call": {"rate": 120, "currency": "USD"}, "email": {"rate": 120, ...}}
-- On the case, not in app settings: one principal pays for correspondence at a rate
-- another does not, and the case is where that is known.
ALTER TABLE public.cases
  ADD COLUMN IF NOT EXISTS rate_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.cases.rate_defaults IS
  'Standing hourly rate per kind of work on this case, keyed by the kind lowercased. Used to price a one-tap entry. Advisory only - a line can always be edited, and a missing rate never blocks the entry.';

-- == 3. The quick buttons write a FEE ========================================
DROP FUNCTION IF EXISTS public.case_add_quick_charge(uuid, text, text);
CREATE OR REPLACE FUNCTION public.case_add_quick_charge(
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
  -- Trinidad has no DST, so a fixed offset is exact all year. CURRENT_DATE is the
  -- DATABASE's date, which is UTC, and would file anything after 20:00 local as tomorrow.
  v_now      TIMESTAMP := (now() AT TIME ZONE 'America/Port_of_Spain');
  v_end      TIMESTAMP;
  v_start    TIMESTAMP;
  v_label    TEXT;
  v_rate_txt TEXT;
  v_rate     NUMERIC := 0;
  v_ccy      TEXT;
  v_id       UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Only an administrator can log case time';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.cases c WHERE c.id = p_case) THEN
    RAISE EXCEPTION 'Case % does not exist', p_case;
  END IF;

  v_label := CASE p_kind WHEN 'call' THEN 'Phone call' WHEN 'email' THEN 'Email' ELSE 'Attendance' END;

  -- What this case pays for this kind of work, if anybody has said.
  SELECT NULLIF(c.rate_defaults #>> ARRAY[lower(v_label), 'rate'], ''),
         NULLIF(c.rate_defaults #>> ARRAY[lower(v_label), 'currency'], '')
    INTO v_rate_txt, v_ccy
    FROM public.cases c WHERE c.id = p_case;

  -- Defensive: the column is free-shaped JSON, and a bad value must leave the entry
  -- unpriced rather than abort the tap.
  IF v_rate_txt ~ '^[0-9]+(\.[0-9]+)?$' THEN
    v_rate := v_rate_txt::numeric;
  END IF;
  v_ccy := COALESCE(v_ccy, 'USD');

  -- If this tap is part of a burst, begin where the earliest of that burst began, so the
  -- blocks lie end to end going BACKWARDS: you finish a twenty-minute call, pick the app
  -- up and tap twice. The window is deliberately short -- it catches "tap, tap" for one
  -- call, not two calls hours apart.
  SELECT (c.incurred_on + c.start_time)
    INTO v_end
    FROM public.case_charges c
   WHERE c.case_id = p_case
     AND c.client_ref IS NOT NULL
     AND c.start_time IS NOT NULL
     AND c.created_by = auth.uid()
     AND c.created_at > now() - INTERVAL '5 minutes'
   ORDER BY (c.incurred_on + c.start_time) ASC
   LIMIT 1;

  IF v_end IS NULL THEN
    v_end := v_now;
  END IF;
  v_start := v_end - INTERVAL '10 minutes';

  INSERT INTO public.case_charges
    (case_id, kind, description, incurred_on, start_time, end_time, minutes,
     qty, unit_amount, currency, client_ref, created_by)
  VALUES
    (p_case, v_label,
     -- Blank on purpose: what the call was ABOUT is not known from a tap, and every
     -- screen falls back to the kind. A copy of the label here would print twice.
     '',
     -- Dated by when the work STARTED. A block running back over midnight belongs to the
     -- day it began, which is where a claim cutoff expects to find it.
     v_start::date, v_start::time, v_end::time, 10,
     1, v_rate, v_ccy, p_client_ref, auth.uid())
  -- The predicate is REQUIRED: uq_cc_client_ref is a PARTIAL unique index, and without it
  -- Postgres cannot infer the arbiter and rejects the statement outright.
  ON CONFLICT (client_ref) WHERE client_ref IS NOT NULL DO NOTHING;

  SELECT c.id INTO v_id FROM public.case_charges c WHERE c.client_ref = p_client_ref;
  RETURN v_id;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.case_add_quick_charge(uuid, text, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.case_add_quick_charge(uuid, text, text) TO authenticated;

-- == 4. A claim prices a timed fee, and skips an unpriced one ================
-- Same body as mig 212 with two corrections: charges total from the GENERATED amount
-- instead of re-multiplying, and a timed fee with no rate is left outstanding, exactly as
-- an unpriced attendance already was. Claiming it would mark ten minutes paid at zero.
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
     AND c.incurred_on <= p_cutoff
     AND (c.minutes IS NULL OR c.unit_amount > 0);
  GET DIAGNOSTICS v_chg = ROW_COUNT;

  IF v_att + v_chg = 0 THEN
    -- Roll the empty claim back rather than leave a claim numbered against nothing.
    RAISE EXCEPTION 'Nothing outstanding in % up to %', p_currency, p_cutoff;
  END IF;

  SELECT COALESCE((SELECT sum(a.charge_amount) FROM public.case_attendances a WHERE a.claim_id = v_claim), 0)
       + COALESCE((SELECT sum(c.amount)        FROM public.case_charges c     WHERE c.claim_id = v_claim), 0)
    INTO v_total;

  UPDATE public.case_claims
     SET total = round(v_total, 2), item_count = v_att + v_chg
   WHERE id = v_claim;

  RETURN jsonb_build_object('claim_id', v_claim, 'claim_no', v_no, 'currency', p_currency,
                            'attendances', v_att, 'charges', v_chg,
                            'items', v_att + v_chg, 'total', round(v_total, 2));
END;
$fn$;

-- == 5. Move the blocks already logged the other way =========================
-- Only the quick ones: client_ref IS NOT NULL is exactly the set the buttons wrote. A
-- hand-logged attendance is a real attendance and stays where it is.
--
-- Insert THEN delete in one statement, keyed on the same client_ref, so a row can only be
-- removed once its copy exists. Migration 213 deleted a parent first and a cascade took a
-- charge with it; that is not repeatable here.
WITH moved AS (
  INSERT INTO public.case_charges
    (case_id, kind, description, incurred_on, start_time, end_time, minutes,
     qty, unit_amount, currency, claim_id, client_ref, created_by, created_at)
  SELECT a.case_id,
         COALESCE(NULLIF(btrim(a.description), ''), 'Phone call'),
         '',
         a.attended_on, a.start_time, a.end_time, a.minutes,
         1, COALESCE(a.rate_amount, 0), a.currency,
         a.claim_id, a.client_ref, a.created_by, a.created_at
    FROM public.case_attendances a
   WHERE a.client_ref IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.case_charges c WHERE c.client_ref = a.client_ref)
  RETURNING client_ref
)
DELETE FROM public.case_attendances a
 USING moved m
 WHERE a.client_ref = m.client_ref;

-- == 6. One door ==============================================================
-- Mig 218's function wrote attendances. Nothing calls it now, and leaving it in place
-- would let an old bundle keep filing calls in the wrong table.
DROP FUNCTION IF EXISTS public.case_add_quick_attendance(uuid, text, text);

-- Sanity checks after running:
--   -- two taps must lie end to end, ending about now, IN FEES AND COSTS:
--   -- SELECT kind, incurred_on, start_time, end_time, minutes, unit_amount, amount
--   --   FROM public.case_charges ORDER BY incurred_on DESC, start_time DESC;
--   -- nothing quick left behind in attendances:
--   SELECT count(*) AS should_be_zero FROM public.case_attendances WHERE client_ref IS NOT NULL;
--   -- ten minutes at 120/h is 20.00, and six of them are 120.00, not 122.40:
--   SELECT round(120 * 10 / 60.0, 2) AS one_block, round(120 * 60 / 60.0, 2) AS six_blocks;
