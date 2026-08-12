-- ============================================================================
-- Migration 178: Pre-Hire Inspection — ask about practice, not about this charter
--
-- Section 10 had this charter written into it: charts corrected "for the whole intended
-- route, offshore and river", a passage plan "for the intended route", under-keel
-- clearance "for the river bar and berth", night navigation "on the river". That asks
-- whether the vessel has prepared for one specific job, when what an inspection should
-- establish is whether it does the right thing as a matter of course. A vessel that only
-- corrects the charts it has been told it will need is the finding.
--
-- So: section 10 asks about standing practice, and section 14 — Intended Route & Local
-- Operations — remains the one place where the proposed service is examined. Same for
-- the emergency response plan at 5.5.
--
-- Wording only. No fields added, removed or renumbered.
-- ============================================================================

-- 10.3 — the whole question is whether the charts are current and being kept that way.
UPDATE public.template_fields
   SET label = 'Are charts and publications held and kept corrected?',
       help_text = 'Check the correction state of the charts covering where the vessel actually trades, and the currency of the publications alongside them.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a03';

-- 10.10 — berth to berth, every voyage, not just the one being contemplated.
UPDATE public.template_fields
   SET label = 'Is berth-to-berth passage planning being carried out?',
       help_text = 'Ask to see the plan for the last voyage, not a blank form. Appraisal, planning, execution and monitoring.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a04';

-- 10.11 — a UKC policy is a policy, not a one-off calculation.
UPDATE public.template_fields
   SET label = 'Is an under-keel clearance policy documented and applied?',
       help_text = 'The minimum clearance the company requires, and evidence that it is calculated and recorded for shallow-water passages.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a05';

-- 10.6 — ENC permits, for wherever the vessel trades.
UPDATE public.template_fields
   SET label = 'Are the ENC permits and chart licences current?',
       help_text = 'A licence that expires mid-charter takes the cells with it. Note the expiry in the remarks.'
 WHERE id = 'c41d0000-0000-4000-8000-000000001302';

-- 10.15 — communications in the area the vessel works, not one named route.
UPDATE public.template_fields
   SET label = 'Are satellite or mobile communications available in the vessel''s area of operation?'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a09';

-- 10.16 — whether the vessel navigates at night at all is a practice question; whether
-- THIS service runs at night belongs to section 14.
UPDATE public.template_fields
   SET label = 'Is the vessel routinely navigated at night?',
       help_text = 'If so, note what the bridge relies on where the buoyage is unlit, and whether the manning changes after dark.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a0a';

-- 10.17 — restricted waters generally, rather than one river.
UPDATE public.template_fields
   SET label = 'Bridge manning level in restricted waters',
       help_text = 'Who is on the bridge, and at what point the Master is called.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000a0b';

-- 5.5 — the emergency response plan is the vessel's, not the charter's.
UPDATE public.template_fields
   SET label = 'Is there a documented emergency response plan?',
       help_text = 'Company and vessel contingency arrangements: who is called, and how shore support is reached.'
 WHERE id = 'c41d0000-0000-4000-8000-000000000504';
