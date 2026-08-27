-- ============================================================================
-- Migration 203: Pre-Hire report — trim 6pt off the page's bottom margin so the
--                disclaimer stops taking a page of its own
--
-- On report 26-08-263 the closing legal paragraph was the ONLY thing on page 7.
-- It is not that the paragraph is large. Measured against the rendered PDF:
--
--   signature image bottom   y = 68.7
--   content floor            y = 44.0   (styles.page paddingBottom)
--   room available               24.7pt
--   disclaimer block needs       ~38pt   (marginTop 6 + border 1 + padding 8
--                                         + three 7.8pt lines of 6pt text)
--
-- Short by about 14pt, and @react-pdf will not split a `wrap={false}` block, so
-- the whole thing moves. The section container's own 6pt marginBottom is what
-- swallowed the near misses: trimming the disclaimer's padding, shrinking the
-- signature to 22pt, even a ONE-LINE disclaimer all still landed on page 7.
--
-- What works is giving the page back 6pt at the foot: paddingBottom 44 -> 38.
-- Nothing else changes — the disclaimer box, its font, the signature size and the
-- footer all stay exactly as designed. The paragraph then sets at y=66/58/50 with
-- ~18pt of clearance above the footer rule, the same gap it had on its own page,
-- and the body goes from 7 pages to 6 (12 with the attachments, not 13).
--
-- ⚠️ THIS BUYS HEADROOM, IT DOES NOT SOLVE IT. The fit depends on where this job's
-- content happens to end on the last page. It clears by ~18pt today; a future
-- pre-hire carrying one more line of remarks at the end can still push the
-- paragraph over. The structural fix would be shortening pdf_disclaimer itself to
-- two lines — it needs to lose roughly 80 characters — and that is legal wording,
-- not a layout decision.
--
-- Off for every other template, so no other checklist's pagination moves. The flag
-- reaches JobPDF as the `tightPageBottom` prop; if it is ever missing from the
-- explicit select list in /api/pdf/[jobId] it arrives undefined and silently does
-- nothing, which is the trap every flag in migration 202 shares.
--
-- Idempotent.
-- ============================================================================

ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_tight_page_bottom BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_templates.pdf_tight_page_bottom IS
  'Set the page bottom margin to 38pt instead of 44pt. Six points of extra content height per page, enough to keep a short closing disclaimer off a page of its own. Leaves ~18pt of clearance above the footer rule. Off by default; changing it re-flows the WHOLE report, so every page break can move.';

-- ------------------------------------------------------------
-- On for the Pre-Hire Inspection template alone (seeded in migration 170).
-- DO NOT widen this WHERE clause — another template wanting it gets its own
-- migration, so the change to that checklist's report is on the record.
-- ------------------------------------------------------------
UPDATE public.checklist_templates
   SET pdf_tight_page_bottom = true
 WHERE id = 'c41d0000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------
-- Verification — run this after applying and READ it.
-- EXPECTED: exactly ONE row, Pre-Hire Inspection, true.
-- ------------------------------------------------------------
SELECT name, id, pdf_tight_page_bottom
  FROM public.checklist_templates
 WHERE pdf_tight_page_bottom
 ORDER BY name;
