-- ============================================================
-- Migration 009: Optional cleanup of seeded bootstrap data
--
-- This migration is INFORMATIONAL by default — it only reports counts.
-- To actually remove rows, uncomment the DELETE statements below
-- after confirming they are not linked to real production jobs.
-- ============================================================

DO $$
DECLARE
  v_count INT;
BEGIN
  -- Seeded clients (added in migration 003) with no linked jobs
  SELECT COUNT(*) INTO v_count FROM clients
  WHERE name IN (
    'BPTT LLC',
    'ExxonMobil Guyana Limited',
    'Shell Trinidad and Tobago Limited',
    'Ramps Logistics Limited'
  )
  AND NOT EXISTS (
    SELECT 1 FROM jobs j WHERE j.client_id = clients.id
  );
  RAISE NOTICE 'Seeded clients with no linked jobs: %', v_count;

  -- Seeded surveyor names (added in migration 003)
  SELECT COUNT(*) INTO v_count FROM surveyor_names
  WHERE name IN (
    'Captain Andrew Taylor', 'Paul Taylor', 'Robert Taylor',
    'Anil Rawlin', 'Ryan Rawlin', 'Jared Persad', 'Shane Jagoo', 'Neil Sookram'
  );
  RAISE NOTICE 'Seeded surveyor names: %', v_count;
END $$;

-- ── Uncomment below to remove seeded clients with no jobs: ──────────────────
-- DELETE FROM clients
-- WHERE name IN (
--   'BPTT LLC','ExxonMobil Guyana Limited',
--   'Shell Trinidad and Tobago Limited','Ramps Logistics Limited'
-- )
-- AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.client_id = clients.id);

-- ── Uncomment below to remove seeded surveyor names: ────────────────────────
-- DELETE FROM surveyor_names
-- WHERE name IN (
--   'Captain Andrew Taylor','Paul Taylor','Robert Taylor',
--   'Anil Rawlin','Ryan Rawlin','Jared Persad','Shane Jagoo','Neil Sookram'
-- );
