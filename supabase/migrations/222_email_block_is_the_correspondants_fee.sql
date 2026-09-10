-- ============================================================
-- Migration 222: a tapped Email says what it is being charged as
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- The quick buttons wrote a blank description, on the reasoning that a tap cannot know
-- what the call was about. True of a call. An EMAIL is different: writing to the club is
-- the correspondent's service itself, and the owner bills it under one name, so the line
-- should say that name without anybody typing it.
--
-- Only the wording of a new row changes. The kind stays 'Email' — that is what the rate
-- card is keyed on (cases.rate_defaults) and what tells you how the ten minutes were
-- spent — and existing rows are left exactly as they are.
--
-- The apostrophe is DOUBLED. A single one ends the string early and rolls the whole file
-- back, which is how migration 210 failed on its own COMMENT.
-- ============================================================

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
  v_detail   TEXT;
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

  -- An email IS the correspondent's service and is billed under that name. A call is a
  -- call: what it was about is not known from a tap, and every screen falls back to the
  -- kind, so a blank stays blank rather than printing the label twice.
  v_detail := CASE p_kind WHEN 'email' THEN 'Correspondant''s Fee' ELSE '' END;

  -- What this case pays for this kind of work, if anybody has said.
  SELECT NULLIF(c.rate_defaults #>> ARRAY[lower(v_label), 'rate'], ''),
         NULLIF(c.rate_defaults #>> ARRAY[lower(v_label), 'currency'], '')
    INTO v_rate_txt, v_ccy
    FROM public.cases c WHERE c.id = p_case;

  -- Fall back to what the case charges for anything else before giving up on a rate.
  IF v_rate_txt IS NULL THEN
    SELECT NULLIF(c.rate_defaults #>> ARRAY['*', 'rate'], ''),
           COALESCE(v_ccy, NULLIF(c.rate_defaults #>> ARRAY['*', 'currency'], ''))
      INTO v_rate_txt, v_ccy
      FROM public.cases c WHERE c.id = p_case;
  END IF;

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
    (p_case, v_label, v_detail,
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

-- Sanity checks after running:
--   -- an emailed block names the fee, a call does not:
--   -- SELECT kind, description, unit_amount FROM public.case_charges
--   --  WHERE client_ref IS NOT NULL ORDER BY created_at DESC LIMIT 4;
--   -- and a case with only a default rate still prices its taps:
--   -- SELECT rate_defaults FROM public.cases;
