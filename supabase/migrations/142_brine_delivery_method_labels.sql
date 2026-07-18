-- ============================================================
-- Migration 142: Brine — every delivery-side question follows Method of Delivery.
--
-- The template was written assuming the cargo always comes from a shore tank. It can also
-- come from a road tanker wagon or another vessel, so "shore tank" / "shore flow meter" /
-- "shore loading lines" are wrong for two of the three delivery methods.
--
-- Labels support a {field-uuid} token that resolves to that field's selected option label,
-- in BOTH the app (JobChecklistEditor.resolveLabel) and the report
-- (JobPDF.resolvePdfLabel). Until the method is picked, the app shows a readable
-- "[Method of Delivery]" placeholder rather than a raw token. So every delivery-side
-- question now interpolates the Method of Delivery field
-- (b21e0000-0000-4000-8000-000000000212) and reads correctly for all three methods.
--
-- Only the DELIVERY side changes. Questions about the receiving ship — its tanks, manifold,
-- flow meter, sounding tubes, loading lines (13, 14, 15, 16, 17, 20, 23, 24, 27, 28, 29,
-- 29A, Ship's figure) — are untouched, as is "shipper" (the cargo's owner, not the source).
--
-- Option labels become "Shore Tank" / "Road Tanker Wagon" / "Delivery Vessel". "Vessel"
-- alone would be ambiguous once interpolated, because the checklist already calls the
-- receiving ship "the vessel" — "Delivery Vessel flow meter" is unambiguous.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Disambiguate the delivery-vessel option
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET options = '[{"value":"shore_tank","label":"Shore Tank"},{"value":"road_tanker_wagon","label":"Road Tanker Wagon"},{"value":"vessel","label":"Delivery Vessel"}]'::jsonb
 WHERE id = 'b21e0000-0000-4000-8000-000000000212';

-- ------------------------------------------------------------
-- 2. Delivery-side question labels
-- ------------------------------------------------------------
UPDATE public.template_fields AS f SET label = v.label
FROM (VALUES
  -- INITIAL — delivery side
  ('b21e0000-0000-4000-8000-000000000131',
   'Has an initial manual sounding/ullage of the {b21e0000-0000-4000-8000-000000000212} been carried out by the surveyor using a calibrated sounding tape?'),
  ('b21e0000-0000-4000-8000-000000000132',
   'Has an initial photograph of the {b21e0000-0000-4000-8000-000000000212} flow meter been taken?'),
  ('b21e0000-0000-4000-8000-000000000133',
   'Is the shipper''s {b21e0000-0000-4000-8000-000000000212} flow meter calibration certificate up to date and calibrated for the cargo''s specific gravity?'),
  ('b21e0000-0000-4000-8000-000000000134',
   'Have the {b21e0000-0000-4000-8000-000000000212} loading lines been inspected, serial numbers verified against certificates, and pressure tested within the last 12 months?'),

  -- INITIAL — agreements
  ('b21e0000-0000-4000-8000-000000000142',
   'Has the transfer rate been agreed between the ship and the {b21e0000-0000-4000-8000-000000000212}, including the initial slow start-up procedure?'),

  -- PRE-LOADING — spill response
  ('b21e0000-0000-4000-8000-000000000126',
   'Are spill kits (including containment booms) available and ready to deploy on the ship and at the {b21e0000-0000-4000-8000-000000000212} for oil-based cargoes?'),

  -- MID LOADING — rate increase
  ('b21e0000-0000-4000-8000-000000000161',
   'Has the increased loading rate been agreed between the ship and the {b21e0000-0000-4000-8000-000000000212}, and the {b21e0000-0000-4000-8000-000000000212} loading lines and connections inspected immediately on ramp-up?'),

  -- HOURLY repeatable entry
  ('b21e0000-0000-4000-8000-000000000171',
   '{b21e0000-0000-4000-8000-000000000212} loading line inspected and found satisfactory?'),

  -- FINAL — delivery side
  ('b21e0000-0000-4000-8000-000000000187',
   'Has a final manual sounding/ullage of the {b21e0000-0000-4000-8000-000000000212} been carried out by the surveyor using a calibrated sounding tape?'),
  ('b21e0000-0000-4000-8000-000000000188',
   'Has a final photograph of the shipper''s {b21e0000-0000-4000-8000-000000000212} flow meter been taken?'),
  ('b21e0000-0000-4000-8000-000000000189',
   'What is the volume from the shipper''s {b21e0000-0000-4000-8000-000000000212} flow meter?'),
  ('b21e0000-0000-4000-8000-000000000201',
   '{b21e0000-0000-4000-8000-000000000212} flow meter — unit'),

  -- RECONCILIATION
  ('b21e0000-0000-4000-8000-000000000192',
   '{b21e0000-0000-4000-8000-000000000212} figure'),
  ('b21e0000-0000-4000-8000-000000000193',
   'Difference (Ship − {b21e0000-0000-4000-8000-000000000212})')
) AS v(id, label)
WHERE f.id = v.id::uuid;

-- ------------------------------------------------------------
-- 3. The repeatable section's TITLE is not interpolated (only field labels are),
--    so give it a method-neutral name.
-- ------------------------------------------------------------
UPDATE public.template_sections
   SET title = 'Hourly Loading Line Inspection',
       description = 'Item 25 — add one entry per hourly inspection of the loading line.'
 WHERE id = 'b21e0000-0000-4000-8000-000000000014';

-- ------------------------------------------------------------
-- 4. Method of Delivery must be answered before the questions that quote it, so it is
--    required and sits in Job Details (order 4) ahead of every section that uses it.
-- ------------------------------------------------------------
UPDATE public.template_fields
   SET is_required = true,
       help_text = 'Where the cargo is delivered from. The questions below name this source, so set it first.'
 WHERE id = 'b21e0000-0000-4000-8000-000000000212';
