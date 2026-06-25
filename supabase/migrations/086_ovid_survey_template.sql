-- ============================================================
-- Migration 086: OVID Survey template (+ job type)
-- Run in Supabase SQL Editor or via the db-migrate runner. Idempotent.
--
-- A lightweight job/billing record for OVID (Offshore Vessel Inspection
-- Database) surveys. It captures the survey date, location, commissioning
-- company, and the four base-to-base times that drive BILLABLE hours:
--   depart base → arrive on location → depart location → arrive back at base.
-- Calculated fields turn those times into hours (the calc engine reads HH:MM as
-- decimal hours — see evaluateCalculation). Total hours = arrive base − depart base.
--
-- These hours are NOT overtime: enter the calculated "Total hours" as the
-- surveyor's REGULAR hours on the job (Surveyors & hours panel) so they bill to
-- the client. Vessel + client come from the JOB record; the job auto-gets a
-- report number. Set a per-client hourly rate under Clients → Rates for the
-- "OVID Survey" job type.
--
-- Fixed ids (prefix 0a1d0000-…) so the calculated-field formulas reference stable
-- field ids regardless of label edits.
-- ============================================================

-- Tracker job-type filter + a rate key for per-client hourly rates.
INSERT INTO public.job_types (name)
  SELECT 'OVID Survey'
  WHERE NOT EXISTS (SELECT 1 FROM public.job_types WHERE name = 'OVID Survey');

-- Template (created_by = an active admin, falling back to any profile).
INSERT INTO public.checklist_templates (id, name, description, status, allow_surveyor_start, created_by)
SELECT '0a1d0000-0000-4000-8000-000000000001', 'OVID Survey',
       'OVID (Offshore Vessel Inspection Database) survey job/billing record: survey date, location, commissioning company, and the base-to-base times that drive billable hours. Vessel + client come from the job; the job auto-gets a report number. Enter the calculated Total hours as the surveyor''s regular hours to bill the client (not overtime).',
       'active'::template_status, true,
       COALESCE((SELECT id FROM public.profiles WHERE role = 'admin' AND is_active ORDER BY created_at LIMIT 1),
                (SELECT id FROM public.profiles ORDER BY created_at LIMIT 1))
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.template_sections (id, template_id, title, description, order_index, conditional_logic) VALUES
  ('0a1d0000-0000-4000-8000-000000000002','0a1d0000-0000-4000-8000-000000000001','Survey & billing details','Times are base-to-base and drive the billable hours below.',0,null)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.template_fields
  (id, template_id, section_id, label, field_type, order_index, is_required, calculation_formula, unit, help_text, default_value) VALUES
  -- Details
  ('0a1d0000-0000-4000-8000-000000000003','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Date of survey','date',0,true,null,null,null,null),
  ('0a1d0000-0000-4000-8000-000000000004','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Location of survey','text',1,true,null,null,'Port / anchorage / terminal where the survey took place.',null),
  ('0a1d0000-0000-4000-8000-000000000005','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Commissioning company','text',2,false,null,null,'Who commissioned the survey, if different from the client.',null),
  -- Billing times (base to base)
  ('0a1d0000-0000-4000-8000-000000000006','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Time departed base','time',3,true,null,null,null,null),
  ('0a1d0000-0000-4000-8000-000000000007','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Time arrived on location','time',4,true,null,null,null,null),
  ('0a1d0000-0000-4000-8000-000000000008','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Time departed location','time',5,true,null,null,null,null),
  ('0a1d0000-0000-4000-8000-000000000009','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Time arrived back at base','time',6,true,null,null,null,null),
  -- Calculated hours (HH:MM read as decimal hours)
  ('0a1d0000-0000-4000-8000-00000000000a','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Total hours (base to base)','calculated',7,false,
     '{0a1d0000-0000-4000-8000-000000000009} - {0a1d0000-0000-4000-8000-000000000006}','hrs',
     'Billable hours: arrived back at base − departed base. Enter this as the surveyor''s regular hours on the job.',null),
  ('0a1d0000-0000-4000-8000-00000000000b','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Time on location','calculated',8,false,
     '{0a1d0000-0000-4000-8000-000000000008} - {0a1d0000-0000-4000-8000-000000000007}','hrs',
     'Departed location − arrived on location.',null),
  ('0a1d0000-0000-4000-8000-00000000000c','0a1d0000-0000-4000-8000-000000000001','0a1d0000-0000-4000-8000-000000000002','Travel time','calculated',9,false,
     '{0a1d0000-0000-4000-8000-000000000007} - {0a1d0000-0000-4000-8000-000000000006} + {0a1d0000-0000-4000-8000-000000000009} - {0a1d0000-0000-4000-8000-000000000008}','hrs',
     'Travel out + travel back (total − time on location).',null)
ON CONFLICT (id) DO NOTHING;
