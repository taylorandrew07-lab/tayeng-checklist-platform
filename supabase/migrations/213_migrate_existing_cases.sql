-- ============================================================
-- Migration 213: move the existing case(s) off `jobs` and onto `cases`
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent: re-running is a no-op, because every insert is keyed on the legacy id.
--
-- ONE-WAY. This deletes the job row at the end. Verified before writing:
--   1 case job ('Collision'), invoice_id NULL, billed_under_job_id NULL
--   0 job_surveyors  ->  0 shift rows, 0 km rows, and no scalar hours to reconcile
--   0 invoice_line_items, 0 job_field_values, 0 job_photos, 0 job_attachments, 0 signatures
--   1 case_charges row (correspondency fee, USD 120, unbilled)
--
-- The attendance loops below are written anyway. They cost nothing on today's data and
-- mean this file is still correct if a case is created between writing and running it.
--
-- WHAT IS DELIBERATELY NOT GUESSED. case_type and other_party stay NULL. The job model
-- had nowhere to hold them: 'Collision' is the title and the opposing vessel is inside
-- the free-text note. Parsing prose to fill structured columns is how you get a database
-- that is confidently wrong. The note is carried across verbatim and the two fields take
-- ten seconds to fill in by hand.
-- ============================================================

DO $mig$
DECLARE
  v_job     RECORD;
  v_case    UUID;
  v_js      RECORD;
  v_moved   INT;
  v_scalar  INT;
BEGIN
  FOR v_job IN SELECT * FROM public.jobs WHERE is_case LOOP

    -- 1. The case itself -----------------------------------------------------
    INSERT INTO public.cases (
      legacy_job_id, title, our_vessel, our_vessel_type, principal,
      status, opened_on, closed_on, notes, created_by, created_at)
    VALUES (
      v_job.id,
      COALESCE(NULLIF(btrim(v_job.title), ''), 'Untitled case'),
      v_job.vessel_name,
      v_job.vessel_type,
      -- The principal was a TE client FK. It becomes free text: a P&I club is not a TE
      -- customer, and the client row itself stays exactly where it is, untouched.
      (SELECT c.name FROM public.clients c WHERE c.id = v_job.client_id),
      COALESCE(v_job.case_status, 'open'),
      COALESCE(v_job.case_opened_on, v_job.scheduled_date, v_job.created_at::date),
      v_job.case_closed_on,
      v_job.notes,
      v_job.created_by,
      v_job.created_at)
    ON CONFLICT (legacy_job_id) WHERE legacy_job_id IS NOT NULL DO NOTHING;

    SELECT id INTO v_case FROM public.cases WHERE legacy_job_id = v_job.id;

    -- 2. Attendances ---------------------------------------------------------
    -- Both logs merge into one list. Overtime was a TE PAY concept and has no meaning on
    -- a case: nobody pays a contractor an overtime multiplier because our payroll week
    -- was long. The distinction is preserved in the note, not in the money.
    --
    -- Minutes come from the CLOCK where both times exist, and fall back to the stored
    -- decimal hours otherwise. That is the whole point of the move: 1.5 h becomes 90
    -- minutes exactly, rather than a decimal that cannot represent a third of an hour.
    FOR v_js IN SELECT * FROM public.job_surveyors WHERE job_id = v_job.id LOOP

      INSERT INTO public.case_attendances (
        case_id, attendee_profile_id, attended_on, minutes, description, location, note,
        rate_type, currency, created_by, created_at, legacy_entry_id)
      SELECT
        v_case, v_js.surveyor_id, r.entry_date,
        COALESCE(
          NULLIF(GREATEST(0,
            (COALESCE(r.end_date, r.entry_date) - r.entry_date) * 1440
            + EXTRACT(hour FROM r.end_time::time)   * 60 + EXTRACT(minute FROM r.end_time::time)
            - EXTRACT(hour FROM r.start_time::time) * 60 - EXTRACT(minute FROM r.start_time::time)
          )::int, 0),
          round(COALESCE(r.hours, 0) * 60)::int),
        NULL, r.location, r.note,
        'hourly', 'USD', r.created_by, r.created_at, r.id
      FROM public.job_surveyor_regular r
      WHERE r.job_surveyor_id = v_js.id
        AND r.start_time IS NOT NULL AND r.end_time IS NOT NULL
      ON CONFLICT (legacy_entry_id) WHERE legacy_entry_id IS NOT NULL DO NOTHING;

      -- Rows with no clock times at all: the decimal is all there is.
      INSERT INTO public.case_attendances (
        case_id, attendee_profile_id, attended_on, minutes, location, note,
        rate_type, currency, created_by, created_at, legacy_entry_id)
      SELECT
        v_case, v_js.surveyor_id, r.entry_date, round(COALESCE(r.hours, 0) * 60)::int,
        r.location, r.note, 'hourly', 'USD', r.created_by, r.created_at, r.id
      FROM public.job_surveyor_regular r
      WHERE r.job_surveyor_id = v_js.id
        AND (r.start_time IS NULL OR r.end_time IS NULL)
      ON CONFLICT (legacy_entry_id) WHERE legacy_entry_id IS NOT NULL DO NOTHING;

      INSERT INTO public.case_attendances (
        case_id, attendee_profile_id, attended_on, minutes, location, note,
        rate_type, currency, created_by, created_at, legacy_entry_id)
      SELECT
        v_case, v_js.surveyor_id, o.entry_date, round(COALESCE(o.hours, 0) * 60)::int,
        o.location,
        CASE WHEN COALESCE(btrim(o.note), '') = '' THEN 'Logged as overtime'
             ELSE 'Logged as overtime — ' || o.note END,
        'hourly', 'USD', o.created_by, o.created_at, o.id
      FROM public.job_surveyor_overtime o
      WHERE o.job_surveyor_id = v_js.id
      ON CONFLICT (legacy_entry_id) WHERE legacy_entry_id IS NOT NULL DO NOTHING;

      -- 3. The residual ------------------------------------------------------
      -- job_surveyors.regular_hours is a SCALAR the shift log never had to account for:
      -- an admin can type "1.5" without logging a single shift. Migration 210's own
      -- residual line exists for the same gap. Without this, hours entered that way
      -- would arrive as zero minutes and simply vanish.
      SELECT COALESCE(sum(a.minutes), 0) INTO v_moved
        FROM public.case_attendances a
       WHERE a.case_id = v_case AND a.attendee_profile_id = v_js.surveyor_id;

      v_scalar := round(COALESCE(v_js.regular_hours, 0) * 60)::int
                + round(COALESCE(v_js.overtime_hours, 0) * 60)::int;

      IF v_scalar > v_moved THEN
        INSERT INTO public.case_attendances (
          case_id, attendee_profile_id, attended_on, minutes, note,
          rate_type, currency, created_by, legacy_entry_id)
        VALUES (
          v_case, v_js.surveyor_id,
          COALESCE(v_job.scheduled_date, v_job.case_opened_on, v_job.created_at::date),
          v_scalar - v_moved,
          'Migrated: hours were recorded without a shift log',
          'hourly', 'USD', v_job.created_by, v_js.id)
        ON CONFLICT (legacy_entry_id) WHERE legacy_entry_id IS NOT NULL DO NOTHING;
      END IF;
    END LOOP;

    -- 4. Fees and costs ------------------------------------------------------
    UPDATE public.case_charges SET case_id = v_case WHERE job_id = v_job.id AND case_id IS NULL;

    -- 5. Remove the job ------------------------------------------------------
    -- Children explicitly, in order, rather than trusting cascade ordering.
    DELETE FROM public.job_surveyor_regular  r USING public.job_surveyors js
      WHERE js.id = r.job_surveyor_id AND js.job_id = v_job.id;
    DELETE FROM public.job_surveyor_overtime o USING public.job_surveyors js
      WHERE js.id = o.job_surveyor_id AND js.job_id = v_job.id;
    DELETE FROM public.job_surveyor_km      k USING public.job_surveyors js
      WHERE js.id = k.job_surveyor_id AND js.job_id = v_job.id;
    DELETE FROM public.job_surveyors WHERE job_id = v_job.id;
    DELETE FROM public.activity_log WHERE entity = 'job' AND entity_id = v_job.id;
    DELETE FROM public.jobs WHERE id = v_job.id;

    RAISE NOTICE 'Migrated case % (%) to cases.%', v_job.title, v_job.id, v_case;
  END LOOP;
END;
$mig$;

-- Sanity checks after running:
--   SELECT count(*) FROM public.jobs WHERE is_case;                    -- expect 0
--   SELECT id, title, our_vessel, principal, status, opened_on, notes FROM public.cases;
--   SELECT sum(minutes) FROM public.case_attendances;                  -- expect 0 today
--   SELECT id, description, currency, unit_amount, case_id FROM public.case_charges;
--   -- the live bug this closes: no case line may appear on the TE labour sheet
--   SELECT count(*) FROM public.labour_shift_lines(NULL, NULL);
