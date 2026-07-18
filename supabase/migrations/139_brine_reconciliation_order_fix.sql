-- ============================================================
-- Migration 139: fix the Brine reconciliation block's field order.
--
-- 138 added a "convert to barrels" heading at order_index 0 and moved the existing
-- "Final calculation of liquid bulk delivered" heading to 1 — but Ship's figure was
-- ALREADY at 1. Tied order_index values sort arbitrarily, so the section rendered as:
--
--     ‹heading› Convert both figures to barrels (BBLS) before entering them below.
--     Ship's figure
--     ‹heading› Final calculation of liquid bulk delivered      <- stranded
--     Shore figure
--
-- Two headings was clumsy regardless, so the unit note folds into the original heading
-- and the extra one is removed. Order is then restated explicitly for the whole section.
--
-- Idempotent: safe to re-run.
-- ============================================================

-- Fold the unit instruction into the existing heading.
UPDATE public.template_fields
   SET label = 'Final calculation of liquid bulk delivered — enter both figures in barrels (BBLS)'
 WHERE id = 'b21e0000-0000-4000-8000-000000000190';

-- Drop the heading 138 added.
DELETE FROM public.template_fields
 WHERE id = 'b21e0000-0000-4000-8000-000000000202';

-- Restate the whole section's order so no two rows can tie.
UPDATE public.template_fields AS f SET order_index = v.idx
FROM (VALUES
  ('b21e0000-0000-4000-8000-000000000190', 0),  -- heading
  ('b21e0000-0000-4000-8000-000000000191', 1),  -- Ship's figure
  ('b21e0000-0000-4000-8000-000000000192', 2),  -- Shore figure
  ('b21e0000-0000-4000-8000-000000000193', 3),  -- Difference (Ship − Shore)
  ('b21e0000-0000-4000-8000-000000000194', 4),  -- % Variance vs shore figure
  ('b21e0000-0000-4000-8000-000000000195', 5)   -- item 32, cargo certificate
) AS v(id, idx)
WHERE f.id = v.id::uuid;
