-- ============================================================================
-- Migration 171: name the Pre-Hire Inspection drill-down boxes per section
--
-- Data only. Migration 170 gave all six "what went wrong" boxes the same two labels
-- ("Which certificate(s)…" ×2, "Which item(s)…" ×4). Correct in place — each prints
-- under its own section heading with its own item number — but ambiguous the moment a
-- Findings entry cites one, and e2e/checklist-audit.mjs flags duplicate labels because
-- in most templates they mean a copy-paste error. Name them for what they ask about.
--
-- Idempotent: keyed on the fixed field ids from 170.
-- ============================================================================

UPDATE public.template_fields SET label = 'Which crew certificate(s), and what was found?'
  WHERE id = 'c41d0000-0000-4000-8000-000000000404';

UPDATE public.template_fields SET label = 'Which life-saving appliance(s), and what was found?'
  WHERE id = 'c41d0000-0000-4000-8000-000000000602';

UPDATE public.template_fields SET label = 'Which fire-fighting appliance(s), and what was found?'
  WHERE id = 'c41d0000-0000-4000-8000-000000000702';

UPDATE public.template_fields SET label = 'Which item(s) of navigational equipment, and what was found?'
  WHERE id = 'c41d0000-0000-4000-8000-000000000a02';

UPDATE public.template_fields SET label = 'Which pollution-prevention item(s), and what was found?'
  WHERE id = 'c41d0000-0000-4000-8000-000000000d02';
