-- ============================================================================
-- Migration 202: Pre-Hire Inspection — how the REPORT is rendered.
--
-- Nothing here touches a question, an item number, an option list or a section.
-- The Pre-Hire checklist CONTENT is finished (migrations 170/171, corrected by
-- 197-201). This migration only changes how that content is printed to PDF.
--
-- WHY IT EXISTS
-- Report 26-08-263 (M.V. Navigator) is the first Pre-Hire Inspection to leave the
-- building. At 164 questions it exposes a set of things the generic renderer
-- (src/lib/pdf/JobPDF.tsx) does acceptably on a 12-field checklist and badly at
-- this scale. Each one gets its OWN boolean, so each can be reasoned about — and
-- reverted — on its own.
--
-- WHY FLAGS AND NOT A FORK
-- CLAUDE.md says a template that OUTGROWS the generic renderer gets its own file
-- (BorescopingReportPDF.tsx). Pre-Hire has not outgrown JobPDF — it is the template
-- that DEFINES it: pdf_photos_inline, pdf_balanced_header, pdf_deficiency_summary
-- and the field-level pdf_hide_when_empty were all built for it and all live in the
-- generic renderer. Forking would copy ~1000 of JobPDF's 1176 lines and would split
-- the findings walk away from lib/checklist/review.ts, which must keep agreeing with
-- what the surveyor saw on screen before leaving the vessel. The one fork we do have
-- has already SILENTLY lost four features added to the generic renderer after it was
-- taken (documents, photosInline, deficiencySummary, balancedHeader) — a borescoping
-- job with a PDF attachment loses even the "Attached: <filename>" line, with no error
-- and no failing test. That is the measured cost of forking, not a fear of it.
--
-- BLAST RADIUS
-- Every column below is NOT NULL DEFAULT false and is switched on for the Pre-Hire
-- template ONLY. The other six templates — and the 75 jobs that carry NO template at
-- all, whose entire PDF is the letterhead plus the header block — keep reading false
-- and render byte-for-byte as they do today. In the renderer every one of these is a
-- prop defaulting to false with the changed lines inside an `if (flag)` / ternary.
--
-- THE TRAP THAT MAKES ALL OF THIS DO NOTHING
-- src/app/api/pdf/[jobId]/route.ts selects the template with an EXPLICIT COLUMN LIST.
-- A pdf_* column that is not named there is not fetched, `job.template?.<col>` is
-- `undefined`, `undefined === true` is false, the flag is off and the report renders
-- exactly as before — with no error, no warning and no type error (the service client
-- is not parameterised with a Database generic, so the result is effectively `any`).
-- Adding a flag is always THREE places: this file, src/lib/types/database.ts, and
-- BOTH the select list and the renderToBuffer props in route.ts.
--
-- Idempotent. Paste-runnable in the Supabase SQL Editor.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. The columns
-- ------------------------------------------------------------
ALTER TABLE public.checklist_templates
  ADD COLUMN IF NOT EXISTS pdf_uniform_label_width    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_embed_attachments      BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_show_report_number     BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_hide_empty_repeatables BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_no_hyphenation         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_remark_below           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_sort_choices           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_format_dates           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_sort_by_item_number    BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pdf_finding_detail         BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.checklist_templates.pdf_uniform_label_width IS
  'Print EVERY question row with the same question/value split (question 60%, value 40%) instead of choosing the split from the field type (38% for textarea/multiple-choice/video-link, 64% for everything else). On a report that interleaves 110 yes/no rows with 21 long-answer rows the value column starts at two different x-positions and the table appears to have moving columns. Measured against this template''s own content: at 60% no question needs a third line and the widest one-line answer (208pt) still fits. Default false keeps the historic per-type split. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_embed_attachments IS
  'Append every non-image attachment (a ship''s particulars sheet or a crew list handed over as a PDF) to the END of the report IN FULL, each behind a separator page naming it and the item it belongs to; the in-body line becomes "see Attachment N". Without this a signed report CITES a crew list it does not contain. Default false: every other template keeps naming the document only. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_show_report_number IS
  'Print the REPORT number (jobs.report_number, e.g. 26-08-263) in the header, the page footer, the PDF metadata title and the saved filename, in preference to jobs.job_number. job_number is Taylor Engineering''s internal client-ledger reference ("TEAL C/L #1280") — stamping that on a client''s copy while the number they will quote appears nowhere makes the report unissuable. Default false so every other report keeps the ledger reference it has always carried. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_hide_empty_repeatables IS
  'Leave a repeatable section OUT of the report entirely when not one of its entries carries data, instead of printing a forced page break and one "Entry 1" of em dashes. resolveEntryOrder deliberately floors the list at [0] so the EDITOR always has a first blank entry to type into — that floor stays; this flag only stops the report printing it. Default false. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_no_hyphenation IS
  'Never break a word across lines in this template''s report. @react-pdf hyphenates by default and its guesses are not real syllable breaks ("Safe Man-/ning Document", "individually sight-/ed"), which read as typos in a signed survey report. Implemented with the PER-TEXT hyphenationCallback prop, never the process-global Font.registerHyphenationCallback — a global would leak into a concurrent render of another template. Default false. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_remark_below IS
  'When a yes/no answer carries a LONG remark, print the remark full-width beneath the row instead of in the narrow strip beside the answer badge. The side-by-side layout exists so a short comment never pushes the row onto a second line; at 300 characters it produces a tall ragged ribbon next to a mostly-empty question column. Short remarks are unaffected in both modes. Default false. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_sort_choices IS
  'Print a multiple-choice answer in the order the TEMPLATE lists its options (the deliberate statutory order — Registry, Class, Load Line, Safety Construction…), not the order the surveyor happened to tap them. Free-text "Other" entries, which match no option, keep their stored order at the end. Default false. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_format_dates IS
  'Print date-field values and the header Date as DD.MM.YYYY instead of the raw ISO YYYY-MM-DD the database stores — matching the convention the saved filename already uses. Applied only to values that are exactly an ISO date, so a hand-typed date ("Wk 35 - Aug 2026") is left exactly as the surveyor wrote it. Default false. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_sort_by_item_number IS
  'Order each section''s rows by ITEM NUMBER rather than by the builder''s order_index. On a CMID-derived report the item numbers are the whole navigation scheme, and a conditional detail field stored after its tick-list prints as 7.1, 7.2, 7.1A, 7.3 — which reads as a numbering error and separates a finding from its explanation. A trailing letter sorts immediately after its bare number (7.1, 7.1A, 7.2); rows with no item number keep their position. NO template data is changed. Default false. See migration 202.';

COMMENT ON COLUMN public.checklist_templates.pdf_finding_detail IS
  'In the Summary of Findings, print the answer to a finding''s conditional DETAIL field beside it when the finding''s own remark box is empty. The CMID pattern is a yes/no question (7.1) followed by a detail field (7.1A, "Which item(s), and what was found?") that only appears when the answer is adverse; reviewChecklist walks answer-family types only, so that textarea can never become the finding''s remark and the summary printed "7.1 ... [NO]" bare while the next finding carried a full explanation — reading as though the surveyor did not look. Nothing is borrowed unless the remark is empty, and a finding whose detail field is also blank stays bare. Requires pdf_deficiency_summary. Default false: a template that turns the summary on later must decide about this separately rather than inherit it. See migration 202.';

-- ------------------------------------------------------------
-- 2. Turn them on for Pre-Hire Inspection ONLY
--
--    c41d0000-0000-4000-8000-000000000001 is the Pre-Hire Inspection template
--    seeded in migration 170. DO NOT widen this WHERE clause. If another template
--    ever wants one of these, set it in ITS OWN migration so the change to that
--    checklist's report is on the record.
-- ------------------------------------------------------------
UPDATE public.checklist_templates
   SET pdf_uniform_label_width    = true,
       pdf_embed_attachments      = true,
       pdf_show_report_number     = true,
       pdf_hide_empty_repeatables = true,
       pdf_no_hyphenation         = true,
       pdf_remark_below           = true,
       pdf_sort_choices           = true,
       pdf_format_dates           = true,
       pdf_sort_by_item_number    = true,
       pdf_finding_detail         = true
 WHERE id = 'c41d0000-0000-4000-8000-000000000001';

-- ------------------------------------------------------------
-- 3. Verification — run this after applying and READ it.
--
--    EXPECTED: exactly ONE row (Pre-Hire Inspection) with on_count = 10; every
--    other template 0. If any other template shows a non-zero count the UPDATE
--    above was widened and another checklist's report has changed.
-- ------------------------------------------------------------
SELECT name,
       id,
       status,
       (pdf_uniform_label_width::int + pdf_embed_attachments::int + pdf_show_report_number::int
        + pdf_hide_empty_repeatables::int + pdf_no_hyphenation::int + pdf_remark_below::int
        + pdf_sort_choices::int + pdf_format_dates::int + pdf_sort_by_item_number::int
        + pdf_finding_detail::int) AS on_count
  FROM public.checklist_templates
 ORDER BY on_count DESC, name;
