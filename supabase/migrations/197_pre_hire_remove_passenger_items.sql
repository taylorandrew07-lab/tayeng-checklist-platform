-- ============================================================================
-- Migration 197: Pre-Hire Inspection — remove five questions and close the gaps
--
-- Removed, at Andrew's direction:
--
--   3.4  Under what endorsement may people other than crew be carried?
--   3.5  Maximum number of passengers permitted, in addition to crew
--   5.6  Is a crew member designated to muster and marshal the passengers?
--   8.1  Number of passengers to be carried on the intended service
--   8.2  Is the number of passengers to be carried within the certified maximum?
--
-- Everything below each removal moves up, so the printed numbering stays a clean
-- run with no holes in it. 3.7A follows its parent from 3.7 to 3.5A; the other
-- lettered follow-ups (3.1A) hang off questions that did not move.
--
-- Checked before writing this: no field's conditional_logic references any of the
-- five, so nothing is orphaned by their removal.
--
-- Existing answers. Only 3.4 held one — a single empty string on an in-progress
-- survey, i.e. a touched-but-unanswered dropdown. Answers on NOT-submitted jobs are
-- cleared first (the migration 184 pattern) so the guarded DELETE below can proceed;
-- a submitted survey is never touched, and its data still blocks the delete.
--
-- Idempotent: DELETE is guarded on remaining answers/photos, and every renumber is
-- an absolute value keyed by field id. The final check fails loudly rather than
-- leaving two questions wearing the same number.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Clear answers on unsubmitted jobs so the removal can proceed
-- ------------------------------------------------------------
DELETE FROM public.job_field_values v
 USING public.jobs j
 WHERE v.job_id = j.id
   AND j.submitted_at IS NULL
   AND v.field_id IN (
         'c41d0000-0000-4000-8000-000000000305',   -- 3.4 endorsement for non-crew
         'c41d0000-0000-4000-8000-000000000306',   -- 3.5 max passengers
         'c41d0000-0000-4000-8000-000000001701',   -- 5.6 crew member to marshal passengers
         'c41d0000-0000-4000-8000-000000000800',   -- 8.1 passengers on intended service
         'c41d0000-0000-4000-8000-000000000801'    -- 8.2 within the certified maximum
       );

-- ------------------------------------------------------------
-- 2. Remove the questions
-- ------------------------------------------------------------
DELETE FROM public.template_fields tf
 WHERE tf.id IN (
         'c41d0000-0000-4000-8000-000000000305',
         'c41d0000-0000-4000-8000-000000000306',
         'c41d0000-0000-4000-8000-000000001701',
         'c41d0000-0000-4000-8000-000000000800',
         'c41d0000-0000-4000-8000-000000000801'
       )
   AND NOT EXISTS (SELECT 1 FROM public.job_field_values v WHERE v.field_id = tf.id)
   AND NOT EXISTS (SELECT 1 FROM public.job_photos p      WHERE p.field_id = tf.id);

-- ------------------------------------------------------------
-- 3. Section 3 — Certification, Class & Ship's Documentation
--    3.1, 3.2, 3.1A and 3.3 keep their places; everything after closes up by two.
-- ------------------------------------------------------------
UPDATE public.template_fields SET item_number = '3.4',  order_index = 4
  WHERE id = 'c41d0000-0000-4000-8000-000000000307';   -- was 3.6  trading area
UPDATE public.template_fields SET item_number = '3.5',  order_index = 5
  WHERE id = 'c41d0000-0000-4000-8000-000000000308';   -- was 3.7  outstanding conditions of class
UPDATE public.template_fields SET item_number = '3.5A', order_index = 6
  WHERE id = 'c41d0000-0000-4000-8000-000000000309';   -- was 3.7A details (child of the above)
UPDATE public.template_fields SET item_number = '3.6',  order_index = 7
  WHERE id = 'c41d0000-0000-4000-8000-000000001212';   -- was 3.8  class surveys up to date
UPDATE public.template_fields SET item_number = '3.7',  order_index = 8
  WHERE id = 'c41d0000-0000-4000-8000-00000000030a';   -- was 3.9  last drydocking
UPDATE public.template_fields SET item_number = '3.8',  order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-000000001b03';   -- was 3.10 next drydocking due
UPDATE public.template_fields SET item_number = '3.9',  order_index = 10
  WHERE id = 'c41d0000-0000-4000-8000-00000000030b';   -- was 3.11 PSC / flag deficiencies
UPDATE public.template_fields SET item_number = '3.10', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-00000000030c';   -- was 3.12 previous CMID / OVID / OVPQ
UPDATE public.template_fields SET item_number = '3.11', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-000000001a01';   -- was 3.13 environmental plans held
UPDATE public.template_fields SET item_number = '3.12', order_index = 13
  WHERE id = 'c41d0000-0000-4000-8000-000000001a02';   -- was 3.14 environmental docs sighted
UPDATE public.template_fields SET item_number = '3.13', order_index = 14
  WHERE id = 'c41d0000-0000-4000-8000-000000000c08';   -- was 3.15 stability book
UPDATE public.template_fields SET item_number = '3.14', order_index = 15
  WHERE id = 'c41d0000-0000-4000-8000-000000001223';   -- was 3.16 general arrangement plan

-- ------------------------------------------------------------
-- 4. Section 5 — Emergency Preparedness & Drills
--    5.1 to 5.5 keep their places; everything after closes up by one.
-- ------------------------------------------------------------
UPDATE public.template_fields SET item_number = '5.6',  order_index = 5
  WHERE id = 'c41d0000-0000-4000-8000-000000001400';   -- was 5.7  MOB manoeuvre displayed
UPDATE public.template_fields SET item_number = '5.7',  order_index = 6
  WHERE id = 'c41d0000-0000-4000-8000-000000001401';   -- was 5.8  written MOB procedure
UPDATE public.template_fields SET item_number = '5.8',  order_index = 7
  WHERE id = 'c41d0000-0000-4000-8000-000000000505';   -- was 5.9  medical locker
UPDATE public.template_fields SET item_number = '5.9',  order_index = 8
  WHERE id = 'c41d0000-0000-4000-8000-000000000506';   -- was 5.10 24-hour medical support
UPDATE public.template_fields SET item_number = '5.10', order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-00000000080f';   -- was 5.11 stretcher route
UPDATE public.template_fields SET item_number = '5.11', order_index = 10
  WHERE id = 'c41d0000-0000-4000-8000-000000000708';   -- was 5.12 general alarm heard
UPDATE public.template_fields SET item_number = '5.12', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-000000001200';   -- was 5.13 last abandon-ship drill
UPDATE public.template_fields SET item_number = '5.13', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-000000001201';   -- was 5.14 last fire drill
UPDATE public.template_fields SET item_number = '5.14', order_index = 13
  WHERE id = 'c41d0000-0000-4000-8000-000000001202';   -- was 5.15 last MOB drill
UPDATE public.template_fields SET item_number = '5.15', order_index = 14
  WHERE id = 'c41d0000-0000-4000-8000-000000000d07';   -- was 5.16 security drills
UPDATE public.template_fields SET item_number = '5.16', order_index = 15
  WHERE id = 'c41d0000-0000-4000-8000-000000001203';   -- was 5.17 drill frequency
UPDATE public.template_fields SET item_number = '5.17', order_index = 16
  WHERE id = 'c41d0000-0000-4000-8000-000000001204';   -- was 5.18 passengers take part in drills

-- ------------------------------------------------------------
-- 5. Section 8 — Accommodation & Passenger Spaces
--    Both removals were at the top, so the whole section closes up by two.
-- ------------------------------------------------------------
UPDATE public.template_fields SET item_number = '8.1',  order_index = 0
  WHERE id = 'c41d0000-0000-4000-8000-000000000802';   -- was 8.3  dedicated seating
UPDATE public.template_fields SET item_number = '8.2',  order_index = 1
  WHERE id = 'c41d0000-0000-4000-8000-000000000804';   -- was 8.4  belts or harnesses
UPDATE public.template_fields SET item_number = '8.3',  order_index = 2
  WHERE id = 'c41d0000-0000-4000-8000-000000000805';   -- was 8.5  seat condition
UPDATE public.template_fields SET item_number = '8.4',  order_index = 3
  WHERE id = 'c41d0000-0000-4000-8000-000000000806';   -- was 8.6  space enclosed
UPDATE public.template_fields SET item_number = '8.5',  order_index = 4
  WHERE id = 'c41d0000-0000-4000-8000-000000000807';   -- was 8.7  two means of escape
UPDATE public.template_fields SET item_number = '8.6',  order_index = 5
  WHERE id = 'c41d0000-0000-4000-8000-000000000808';   -- was 8.8  escape routes marked
UPDATE public.template_fields SET item_number = '8.7',  order_index = 6
  WHERE id = 'c41d0000-0000-4000-8000-00000000080a';   -- was 8.9  number of toilets
UPDATE public.template_fields SET item_number = '8.8',  order_index = 7
  WHERE id = 'c41d0000-0000-4000-8000-00000000080b';   -- was 8.10 drinking water
UPDATE public.template_fields SET item_number = '8.9',  order_index = 8
  WHERE id = 'c41d0000-0000-4000-8000-00000000080c';   -- was 8.11 safety briefing material
UPDATE public.template_fields SET item_number = '8.10', order_index = 9
  WHERE id = 'c41d0000-0000-4000-8000-00000000080d';   -- was 8.12 manifest sent ashore
UPDATE public.template_fields SET item_number = '8.11', order_index = 10
  WHERE id = 'c41d0000-0000-4000-8000-00000000080e';   -- was 8.13 baggage stowage
UPDATE public.template_fields SET item_number = '8.12', order_index = 11
  WHERE id = 'c41d0000-0000-4000-8000-000000001c05';   -- was 8.14 public address
UPDATE public.template_fields SET item_number = '8.13', order_index = 12
  WHERE id = 'c41d0000-0000-4000-8000-000000000c0a';   -- was 8.15 accommodation and galley clean

-- ------------------------------------------------------------
-- 6. Refuse to leave the template with two questions on one number
--
-- If a removal was blocked (a submitted survey holds an answer), the old question
-- keeps its number while its replacement takes the same one. Better to fail the
-- migration than to print a report with two 3.4s.
-- ------------------------------------------------------------
DO $$
DECLARE survivors TEXT;
BEGIN
  SELECT string_agg(item_number || ' (' || id || ')', ', ')
    INTO survivors
    FROM public.template_fields
   WHERE id IN ('c41d0000-0000-4000-8000-000000000305',
                'c41d0000-0000-4000-8000-000000000306',
                'c41d0000-0000-4000-8000-000000001701',
                'c41d0000-0000-4000-8000-000000000800',
                'c41d0000-0000-4000-8000-000000000801');
  IF survivors IS NOT NULL THEN
    RAISE EXCEPTION 'Pre-hire removal blocked — these still hold survey data: %', survivors;
  END IF;
END $$;
