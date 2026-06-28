-- ============================================================
-- Migration 112: Ultrasonic Hatch Testing — one bilge per hold. Idempotent.
--
-- A hold and its bilge are inspected together and BILLED per bilge, so the number of
-- bilges must track the number of holds. The template had a single "Bilges clean &
-- dry" field; this turns it into Bilge 1..9, each gated on "Number of holds" exactly
-- like Hold 1..9 (so 5 holds shows 5 bilges).
--
-- Data-safe: the old single bilges field (…019) becomes "Bilge 1" with the SAME id,
-- so the one live job keeps its bilge value. Bilge 2..9 are new fixed ids (…065–072).
-- "Further re-test required?" (…020) keeps its id (and value) and just moves below
-- the bilges.
-- ============================================================

-- Single bilges field → Bilge 1, gated like Hold 1 (Number of holds > 0).
UPDATE public.template_fields
   SET label = 'Bilge 1',
       order_index = 12,
       conditional_logic = '{"operator":"and","conditions":[{"value":"0","field_id":"75480000-0000-4000-8000-000000000004","operator":"greater_than"}]}'::jsonb
 WHERE id = '75480000-0000-4000-8000-000000000019';

-- Move "Further re-test required?" below the bilges (frees order_index 13..20).
UPDATE public.template_fields SET order_index = 21
 WHERE id = '75480000-0000-4000-8000-000000000020';

-- Bilge 2..9 — new fixed ids, gated like Hold 2..9 (Number of holds > n-1).
INSERT INTO public.template_fields (id, template_id, section_id, label, field_type, order_index, is_required, conditional_logic)
  SELECT v.id::uuid,
         '75480000-0000-4000-8000-000000000001'::uuid,
         '75480000-0000-4000-8000-000000000006'::uuid,
         v.label, 'pass_fail', v.oi, false,
         json_build_object('operator','and','conditions',
           json_build_array(json_build_object('value', v.cond, 'field_id','75480000-0000-4000-8000-000000000004','operator','greater_than')))::jsonb
    FROM (VALUES
      ('75480000-0000-4000-8000-000000000065','Bilge 2',13,'1'),
      ('75480000-0000-4000-8000-000000000066','Bilge 3',14,'2'),
      ('75480000-0000-4000-8000-000000000067','Bilge 4',15,'3'),
      ('75480000-0000-4000-8000-000000000068','Bilge 5',16,'4'),
      ('75480000-0000-4000-8000-000000000069','Bilge 6',17,'5'),
      ('75480000-0000-4000-8000-000000000070','Bilge 7',18,'6'),
      ('75480000-0000-4000-8000-000000000071','Bilge 8',19,'7'),
      ('75480000-0000-4000-8000-000000000072','Bilge 9',20,'8')
    ) AS v(id, label, oi, cond)
   WHERE NOT EXISTS (SELECT 1 FROM public.template_fields tf WHERE tf.id = v.id::uuid);
