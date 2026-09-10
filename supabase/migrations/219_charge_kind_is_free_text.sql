-- ============================================================
-- Migration 219: what a fee or cost IS becomes free text
-- Run via the db-migrate runner, or paste this whole file into the SQL Editor.
-- Idempotent.
--
-- case_charges.kind was CHECK'd against four values — correspondency, third_party,
-- disbursement, other. A club's matters do not fit four boxes: a launch hire, a courier,
-- a police report fee and a diver's invoice are four different things and only one of
-- them is a "disbursement". So the column becomes what the case type above it already is:
-- free text, with suggestions in the UI and nothing enforced here beyond "say something".
--
-- Rows written before today still hold the four lowercase keys. They are LEFT ALONE and
-- given their old labels by chargeKindLabel() in src/lib/cases/chargeKind.ts. Rewriting
-- them would be a one-way edit of live data to gain nothing a lookup does not.
-- ============================================================

ALTER TABLE public.case_charges DROP CONSTRAINT IF EXISTS cc_kind_chk;

-- The only rule left: a charge has to say what it is. NOT NULL is already on the column.
ALTER TABLE public.case_charges ADD CONSTRAINT cc_kind_chk
  CHECK (btrim(kind) <> '');

-- Was 'other', a key. The default is a label now, like everything else written here.
ALTER TABLE public.case_charges ALTER COLUMN kind SET DEFAULT 'Other';

COMMENT ON COLUMN public.case_charges.kind IS
  'What the fee or cost is, as typed - free text since mig 219. Rows written earlier hold one of the four old keys (correspondency, third_party, disbursement, other); chargeKindLabel() maps those and passes anything else through unchanged.';

-- Sanity check after running:
--   SELECT DISTINCT kind FROM public.case_charges ORDER BY 1;
