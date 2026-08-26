-- ============================================================================
-- Migration 198: Pre-Hire Inspection — 3.10 stops reporting a good answer as a defect
--
-- 3.10 "Is a previous CMID, OVID or OVPQ report available on board?" carried
-- yes=amber, which put every vessel that HAS a previous inspection report onto the
-- Summary of Findings — the good answer printed as a defect.
--
-- Migration 185 applied the reversed palette across a run of section-3 questions.
-- It is right for its neighbours — outstanding conditions of class, PSC deficiencies,
-- overdue maintenance — where YES is the problem and No is green. It is wrong here,
-- because here Yes is the reassuring answer.
--
-- The question is informational, so no answer on it is a finding now: yes green, no
-- green, N/A and N/I grey. The defect list is built from red and amber only
-- (lib/checklist/review.ts), so this takes 3.10 off it however it is answered. The
-- remark still carries the date and the inspecting body, which is the point of asking.
--
-- Idempotent: one absolute UPDATE keyed by field id.
-- ============================================================================

UPDATE public.template_fields
   SET options = '[{"value":"yes","label":"Yes","color":"green"},{"value":"no","label":"No","color":"green"},{"value":"na","label":"N/A","color":"gray"},{"value":"ni","label":"N/I","color":"gray"}]'::jsonb
 WHERE id = 'c41d0000-0000-4000-8000-00000000030c';   -- 3.10 previous CMID / OVID / OVPQ report
